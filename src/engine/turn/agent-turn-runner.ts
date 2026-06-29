import type {
  ItemParam,
  ResponseResource,
  Usage,
} from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { ToolContext, ToolResult } from "../../kernel/tools/types";
import type {
  DebugEntry,
  FlightRecordData,
  ItemParam as SessionItemParam,
} from "../../kernel/transcript/types";
import { CompletionController } from "../completion/completion-controller";
import { EvidenceLedger } from "../evidence/evidence-ledger";
import type { RecoveryReflectionDraft } from "../memory/reflection-memory-policy";
import { extractTextFromOutput } from "../model-turn/model-turn-runner";
import { evaluateToolBatch } from "../tool-calls/tool-batch-guard";
import { VerificationController } from "../verification/verification-controller";
import {
  allowsUnverifiedCompletion,
  inferTaskKindFromPrompt,
} from "../verification/verification-policy";
import {
  buildDenialEphemeralMessages as buildDenialEphemeralMessagesForState,
  turnStopDebugData,
  turnStopReasonEvent,
} from "./agent-loop-event-recording";
import type { AgentLoopRuntimeServices } from "./agent-loop-runtime";
import { createAssistantSessionRecorder } from "./assistant-session-recorder";
import { runAutoVerificationOpportunity } from "./auto-verification-opportunity";
import { scheduleCheckpointCompactionForTurn } from "./checkpoint-compaction-scheduler";
import { handleFinishCall } from "./finish-call-handler";
import { LoopGuard } from "./loop-guard";
import { executeModelTurn } from "./model-turn-execution";
import {
  createWorkingNarration,
  createWorkingNarrationGate,
  isNonTrivialPrompt,
  type WorkingNarrationEventType,
} from "./narration";
import { handleRejectedToolBatch } from "./rejected-tool-batch-handler";
import { decideResponseContinuation } from "./response-continuation-decision";
import {
  handleResponseStatus,
  recordResponseUsage,
} from "./response-lifecycle";
import { decideTextOnlyResponse } from "./text-only-response-decision";
import { executeObservedToolBatch } from "./tool-batch-execution";
import type { ToolExecutionObservationState } from "./tool-execution-observer";
import { decideAfterToolIteration } from "./tool-iteration-decision";
import { completeAgentTurn } from "./turn-completion";
import {
  autoVerifierTimeoutSeconds,
  checkpointEventToPlanState,
  createUserItem,
  FINISH_TOOL_NAME,
  wantsFullVerification,
} from "./turn-helpers";
import { prepareTurnPrompt } from "./turn-prompt-preparation";
import { evaluateTurnStopGuards } from "./turn-stop-guards";
import type {
  AgentEvent,
  AgentTurnError,
  AgentTurnResult,
  CheckpointWorkPlanState,
  TurnStopReasonEvent,
} from "./types";
export interface AgentLoopState {
  totalUsage: Usage;
  turnCount: number;
  isProcessing: boolean;
  denialCount: number;
  lastDeniedOperation: string;
}
export interface RunAgentTurnInput {
  userText: string;
  session: SessionPort;
  cwd: string;
  runtime: AgentLoopRuntimeServices;
  state: AgentLoopState;
  setAbortController(controller: AbortController): void;
  clearAbortController(): void;
  createToolContext(): ToolContext;
  emit(event: AgentEvent): void;
  debug(data: DebugEntry["data"]): void;
  flight(data: Omit<FlightRecordData, "version">): void;
}
export async function runAgentTurn(
  input: RunAgentTurnInput,
): Promise<AgentTurnResult> {
  const {
    userText,
    session,
    cwd,
    runtime,
    state,
    setAbortController,
    clearAbortController,
    createToolContext,
    emit,
    debug,
    flight,
  } = input;
  if (state.isProcessing) {
    throw new Error("Agent is already processing a turn");
  }
  // Cancel any background compaction operation when starting a new turn
  runtime.contextController.cancelBackgroundCompaction("new turn started");
  state.isProcessing = true;
  state.turnCount++;
  state.denialCount = 0;
  state.lastDeniedOperation = "";
  const abortController = new AbortController();
  setAbortController(abortController);
  const emitStopReason = (
    turn: number,
    iteration: number,
    reason: TurnStopReasonEvent["reason"],
    detail: string,
    hasUsedTools: boolean,
    autonomousFollowUps: number,
  ): void => {
    const eventInput = {
      turn,
      iteration,
      reason,
      detail,
      hasUsedTools,
      autonomousFollowUps,
    };
    emit(turnStopReasonEvent(eventInput));
    debug(turnStopDebugData(eventInput));
  };
  const turnIndex = state.turnCount;
  const errors: AgentTurnError[] = [];
  const allItems: ItemParam[] = [];
  const evidenceLedger = new EvidenceLedger();
  const taskKind = inferTaskKindFromPrompt(userText);
  const allowUnverifiedCompletion = allowsUnverifiedCompletion(userText);
  const emitNarrationOnce = createWorkingNarrationGate({
    enabled: isNonTrivialPrompt(userText),
    emit: (eventType, message, evidenceIds = []) =>
      emitWorkingNarration(emit, eventType, message, evidenceIds),
  });
  // Emit turn start
  emit({
    type: "turn_start",
    timestamp: Date.now(),
    turnIndex,
    userInput: userText,
  });
  // Create and append user message
  const userItem = createUserItem(userText);
  session.appendItem(userItem as unknown as SessionItemParam);
  allItems.push(userItem as unknown as ItemParam);
  debug({
    event: "loop/turn-start",
    turn: turnIndex,
    detail: userText.slice(0, 200),
  });
  try {
    // Read AGENTS.md if present, then build system prompt
    emitNarrationOnce(
      "context_scan",
      "Checking project instructions, available skills, and memory before choosing the next action.",
    );
    const preparedPrompt = await prepareTurnPrompt({
      cwd: cwd,
      userText,
      selectedTools: runtime.tools.getNames(),
      contextReader: runtime.projectContextReader,
      skillManager: runtime.skillManager,
      projectMemory: runtime.projectMemory,
      modelConfig: runtime.client.getConfig(),
    });
    const {
      contextFiles,
      projectInstructions,
      systemPrompt,
      model,
      maxOutputTokens,
      maxCompletionTokens,
      contextWindow,
      temperature,
    } = preparedPrompt;
    emitNarrationOnce(
      "observation",
      contextFiles.length > 0
        ? `Loaded project instructions from ${contextFiles.map((file) => file.path).join(", ")}.`
        : "No project instruction file was found; using repository structure and targeted reads.",
    );
    flight({
      kind: "prompt_snapshot",
      turn: turnIndex,
      payload: {
        cwd: cwd,
        userInput: userText,
        taskKind,
        model,
        selectedTools: runtime.tools.getNames(),
        contextFiles: contextFiles.map((file) => file.path),
        systemPrompt,
      },
    });
    emitNarrationOnce(
      "plan",
      "Proceeding in small steps: inspect relevant context, act with tools, then verify before completion.",
    );
    // Main loop: continue until no more tool calls
    let currentResponse: ResponseResource | null = null;
    let iteration = 0;
    let continuationAttempts = 0;
    let autonomousFollowUps = 0;
    let hasUsedTools = false;
    let needsVerification = false;
    let hasMutatedFiles = false;
    let checkpointState: CheckpointWorkPlanState | undefined;
    const successfulToolCallIds = new Set<string>();
    const verificationEvidenceCallIds = new Set<string>();
    const includeFullGate =
      wantsFullVerification(userText) || taskKind === "release_task";
    const loopGuard = new LoopGuard(runtime.options);
    const completionController = new CompletionController();
    const verificationController = new VerificationController();
    let recoveryReflectionDraft: RecoveryReflectionDraft | null = null;
    const runAutoVerificationAt = async (
      opportunity: string,
    ): Promise<boolean> => {
      const autoVerification = await runAutoVerificationOpportunity({
        opportunity,
        cwd: cwd,
        turn: turnIndex,
        iteration,
        taskKind,
        ledger: evidenceLedger,
        verificationController,
        tools: runtime.tools,
        createToolContext: () => createToolContext(),
        trustManager: runtime.trustManager,
        projectInstructions,
        projectFiles: runtime.projectCommandFiles,
        includeFullGate,
        includeReleaseGate: taskKind === "release_task",
        timeoutSeconds: autoVerifierTimeoutSeconds(
          runtime.options.bashMaxTimeoutSeconds,
        ),
        signal: abortController.signal,
        session: session,
        allItems,
        errors,
        successfulToolCallIds,
        verificationEvidenceCallIds,
        emit: (event) => emit(event),
        debug: (data) => debug(data),
        narrate: (message, evidenceIds = []) => {
          emitNarrationOnce("verification", message, evidenceIds);
        },
      });
      if (!autoVerification.didExecute) return false;
      hasUsedTools = true;
      needsVerification = autoVerification.needsVerification;
      hasMutatedFiles = autoVerification.hasMutatedFiles;
      return true;
    };
    do {
      debug({
        event: "loop/iteration",
        turn: turnIndex,
        iteration,
        hasUsedTools,
        needsVerification,
        autonomousFollowUps,
      });
      const stopGuardDecision = evaluateTurnStopGuards({
        loopGuard,
        errors,
        turn: turnIndex,
        iteration,
        denialCount: state.denialCount,
        signal: abortController.signal,
        hasUsedTools,
        autonomousFollowUps,
        emit: (event) => emit(event),
        emitStopReason: (reason, detail) => {
          emitStopReason(
            turnIndex,
            iteration,
            reason,
            detail,
            hasUsedTools,
            autonomousFollowUps,
          );
        },
        narrateBlocked: (message) => emitNarrationOnce("blocked", message),
      });
      if (stopGuardDecision === "break") break;
      // Get ephemeral developer messages from active skills + denial warnings
      const ephemeralMessages = [
        ...(runtime.skillManager?.buildEphemeralMessages() ?? []),
        ...buildDenialEphemeralMessages(state),
      ];
      const modelTurnExecution = await executeModelTurn({
        client: runtime.client,
        session: session,
        tools: runtime.tools,
        contextController: runtime.contextController,
        systemPrompt,
        model,
        maxOutputTokens,
        maxCompletionTokens,
        temperature,
        stream: runtime.options.stream,
        ephemeralMessages,
        allowParallelToolCalls: !needsVerification,
        turn: state.turnCount,
        iteration,
        totalUsage: state.totalUsage,
        tokenBudget: runtime.options.tokenBudget,
        contextWindow,
        errors,
        emit: (event) => emit(event),
        emitStopReason: (reason, detail) => {
          emitStopReason(
            turnIndex,
            iteration,
            reason,
            detail,
            hasUsedTools,
            autonomousFollowUps,
          );
        },
        narrateBlocked: (message) => emitNarrationOnce("blocked", message),
      });
      if (modelTurnExecution.action !== "response") {
        if (modelTurnExecution.action === "retry") continue;
        break;
      }
      const {
        response,
        toolCalls,
        assistantMessages,
        systemPromptTokens,
        toolSchemaTokens,
      } = modelTurnExecution;
      currentResponse = response;
      // Record provider usage for context tracking
      runtime.contextController.recordProviderUsage(
        response,
        `turn_${state.turnCount}`,
      );
      debug({
        event: "loop/response",
        turn: turnIndex,
        iteration,
        responseId: response.id,
        responseStatus: response.status,
        toolCalls: toolCalls.length,
        assistantMessages: assistantMessages.length,
        hasUsedTools,
        needsVerification,
        autonomousFollowUps,
        textPreview: assistantMessages
          .map(extractTextFromOutput)
          .join(" ")
          .slice(0, 100),
        assistantPhases: assistantMessages.map(
          (message) => message.phase ?? null,
        ),
        finishCalls: toolCalls.filter(
          (toolCall) => toolCall.name === FINISH_TOOL_NAME,
        ).length,
      });
      const responseStatus = handleResponseStatus({
        response,
        errors,
        iteration,
        emit: (event) => emit(event),
        emitStopReason: (reason, detail) => {
          emitStopReason(
            turnIndex,
            iteration,
            reason,
            detail,
            hasUsedTools,
            autonomousFollowUps,
          );
        },
        narrateBlocked: (message) => emitNarrationOnce("blocked", message),
      });
      if (responseStatus.action === "break") break;
      const { shouldContinue } = responseStatus;
      recordResponseUsage({
        response,
        totalUsage: state.totalUsage,
        budgetTracker: runtime.budgetTracker,
        contextController: runtime.contextController,
        tokenBudget: runtime.options.tokenBudget,
        contextWindow,
        systemPromptTokens,
        toolSchemaTokens,
        turn: turnIndex,
        emit: (event) => emit(event),
      });
      const {
        appendAssistantMessagesToSession,
        appendToolCallGroupToSession,
        supersedeVisibleAssistantMessages,
      } = createAssistantSessionRecorder({
        session: session,
        allItems,
        assistantMessages,
        emit: (event) => emit(event),
      });
      const continuationDecision = decideResponseContinuation({
        shouldContinue,
        toolCallsLength: toolCalls.length,
        continuationAttempts,
        maxContinuationAttempts: runtime.options.maxContinuationAttempts,
        session: session,
        allItems,
        errors,
        iteration,
        appendAssistantMessagesToSession,
        emit: (event) => emit(event),
        emitStopReason: (reason, detail) => {
          emitStopReason(
            turnIndex,
            iteration,
            reason,
            detail,
            hasUsedTools,
            autonomousFollowUps,
          );
        },
        narrate: (eventType, message, evidenceIds = []) => {
          emitNarrationOnce(eventType, message, evidenceIds);
        },
      });
      continuationAttempts = continuationDecision.continuationAttempts;
      iteration = continuationDecision.iteration;
      if (continuationDecision.action === "continue") continue;
      if (continuationDecision.action === "break") break;
      const finishCall =
        toolCalls.length === 1 && toolCalls[0].name === FINISH_TOOL_NAME
          ? toolCalls[0]
          : null;
      if (finishCall) {
        const finishDecision = await handleFinishCall({
          finishCall,
          completionController,
          evidenceLedger,
          errors,
          taskKind,
          allowUnverifiedCompletion,
          runAutoVerification: () => runAutoVerificationAt("finish"),
          appendAssistantMessagesToSession,
          session: session,
          allItems,
          turn: turnIndex,
          iteration,
          hasUsedTools,
          needsVerification,
          autonomousFollowUps,
          verificationEvidenceCallIds,
          successfulToolCallIds,
          emit: (event) => emit(event),
          flight: (data) => flight(data),
          debug: (data) => debug(data),
          emitStopReason: (reason, detail) => {
            emitStopReason(
              turnIndex,
              iteration,
              reason,
              detail,
              hasUsedTools,
              autonomousFollowUps,
            );
          },
          narrate: (eventType, message, evidenceIds = []) => {
            emitNarrationOnce(eventType, message, evidenceIds);
          },
        });
        if (finishDecision === "continue") {
          iteration++;
          continue;
        }
        break;
      }
      if (toolCalls.length === 0) {
        const textOnlyDecision = await decideTextOnlyResponse({
          assistantMessages,
          session: session,
          allItems,
          errors,
          turn: turnIndex,
          taskKind,
          iteration,
          autonomousFollowUps,
          maxAutonomousFollowUps: runtime.options.maxAutonomousFollowUps,
          ledgerNeedsVerification: () =>
            evidenceLedger.getSummary().needsVerification,
          getTurnState: () => ({
            needsVerification,
            hasMutatedFiles,
            hasUsedTools,
          }),
          runAutoVerification: () => runAutoVerificationAt("text-only-stop"),
          appendAssistantMessagesToSession,
          supersedeVisibleAssistantMessages,
          emit: (event) => emit(event),
          debug: (data) => debug(data),
          emitStopReason: (reason, detail) => {
            emitStopReason(
              turnIndex,
              iteration,
              reason,
              detail,
              hasUsedTools,
              autonomousFollowUps,
            );
          },
          narrate: (eventType, message, evidenceIds = []) => {
            emitNarrationOnce(eventType, message, evidenceIds);
          },
        });
        iteration = textOnlyDecision.iteration;
        autonomousFollowUps = textOnlyDecision.autonomousFollowUps;
        if (textOnlyDecision.action === "continue") continue;
        break;
      }
      autonomousFollowUps = 0;
      // Store the complete assistant tool-call group before any tool outputs.
      // OpenAI-compatible APIs require: assistant(tool_calls...) → tool outputs...
      appendToolCallGroupToSession(toolCalls);
      const batchDecision = evaluateToolBatch(toolCalls);
      if (batchDecision.action === "reject") {
        hasUsedTools = true;
        const rejectedBatchResult = handleRejectedToolBatch({
          batchDecision,
          toolCalls,
          session: session,
          allItems,
          errors,
          successfulToolCallIds,
          evidenceLedger,
          loopGuard,
          iteration,
          emit: (event) => emit(event),
          emitToolResultAndEnd: (toolCall, result, startedAt) =>
            emitToolResultAndEnd(emit, toolCall, result, startedAt),
          emitStopReason: (reason, detail) => {
            emitStopReason(
              turnIndex,
              iteration,
              reason,
              detail,
              hasUsedTools,
              autonomousFollowUps,
            );
          },
          narrate: (eventType, message, evidenceIds = []) => {
            emitNarrationOnce(eventType, message, evidenceIds);
          },
        });
        hasUsedTools = hasUsedTools || rejectedBatchResult.usedTools;
        if (rejectedBatchResult.action === "break") {
          break;
        }
        iteration++;
        continue;
      }
      let fixUntilGreenFollowUp: string | null = null;
      let fixUntilGreenStop: string | null = null;
      const toolObservationState: ToolExecutionObservationState = {
        needsVerification,
        hasMutatedFiles,
        mutationSucceededInCurrentBatch: false,
        recoveryReflectionDraft,
        fixUntilGreenFollowUp,
        fixUntilGreenStop,
      };
      const toolBatchExecution = await executeObservedToolBatch({
        toolCalls,
        toolExecutor: runtime.toolExecutor,
        signal: abortController.signal,
        session: session,
        allItems,
        errors,
        successfulToolCallIds,
        verificationEvidenceCallIds,
        evidenceLedger,
        verificationController,
        skillManager: runtime.skillManager,
        projectMemory: runtime.projectMemory,
        taskText: userText,
        iteration,
        state: toolObservationState,
        recordDenial: (description) => {
          state.denialCount++;
          state.lastDeniedOperation = description;
        },
        emit: (event) => emit(event),
        narrate: (eventType, message, evidenceIds = []) => {
          emitNarrationOnce(eventType, message, evidenceIds);
        },
      });
      hasUsedTools = hasUsedTools || toolBatchExecution.usedTools;
      for (const checkpointEvent of toolBatchExecution.checkpointEvents) {
        checkpointState = checkpointEventToPlanState(checkpointEvent);
      }
      needsVerification = toolBatchExecution.state.needsVerification;
      hasMutatedFiles = toolBatchExecution.state.hasMutatedFiles;
      recoveryReflectionDraft =
        toolBatchExecution.state.recoveryReflectionDraft;
      fixUntilGreenFollowUp = toolBatchExecution.state.fixUntilGreenFollowUp;
      fixUntilGreenStop = toolBatchExecution.state.fixUntilGreenStop;
      if (toolBatchExecution.checkpointEvents.length > 0) {
        scheduleCheckpointCompactionForTurn({
          checkpointEvents: toolBatchExecution.checkpointEvents,
          contextController: runtime.contextController,
          tools: runtime.tools,
          turnIndex,
          iteration,
          systemPrompt,
          debug: (data) => debug(data),
        });
      }
      iteration++;
      const afterToolDecision = decideAfterToolIteration({
        fixUntilGreenStop,
        fixUntilGreenFollowUp,
        loopGuard,
        iterationOutcomes: toolBatchExecution.iterationOutcomes,
        session: session,
        allItems,
        errors,
        iteration,
        emit: (event) => emit(event),
        emitStopReason: (reason, detail) => {
          emitStopReason(
            turnIndex,
            iteration,
            reason,
            detail,
            hasUsedTools,
            autonomousFollowUps,
          );
        },
        narrate: (eventType, message, evidenceIds = []) => {
          emitNarrationOnce(eventType, message, evidenceIds);
        },
      });
      if (afterToolDecision === "break") {
        break;
      }
      if (afterToolDecision === "continue") continue;
    } while (true);
    return completeAgentTurn({
      currentResponse,
      turnIndex,
      iteration,
      allItems,
      totalUsage: state.totalUsage,
      errors,
      hasUsedTools,
      needsVerification,
      autonomousFollowUps,
      evidenceSummary: evidenceLedger.getSummary(),
      checkpointState,
      systemPrompt,
      tools: runtime.tools,
      contextController: runtime.contextController,
      emit: (event) => emit(event),
      debug: (data) => debug(data),
    });
  } finally {
    runtime.toolExecutor.clearActiveTool();
    clearAbortController();
    state.isProcessing = false;
  }
}
function emitWorkingNarration(
  emit: (event: AgentEvent) => void,
  eventType: WorkingNarrationEventType,
  message: string,
  evidenceIds: string[] = [],
): void {
  const narration = createWorkingNarration({ eventType, message, evidenceIds });
  emit({
    type: "working_narration",
    timestamp: Date.now(),
    eventType: narration.eventType,
    message: narration.message,
    evidenceIds: narration.evidenceIds,
  });
}
function buildDenialEphemeralMessages(state: AgentLoopState): Array<{
  role: "developer";
  content: string;
}> {
  return buildDenialEphemeralMessagesForState(
    state.denialCount,
    state.lastDeniedOperation,
  );
}
function emitToolResultAndEnd(
  emit: (event: AgentEvent) => void,
  toolCall: {
    call_id: string;
    name: string;
  },
  result: ToolResult,
  startTime: number,
): void {
  const durationMs = Date.now() - startTime;
  emit({
    type: "tool_call_result",
    timestamp: Date.now(),
    toolCallId: toolCall.call_id,
    toolName: toolCall.name,
    result,
  });
  emit({
    type: "tool_call_end",
    timestamp: Date.now(),
    toolCallId: toolCall.call_id,
    toolName: toolCall.name,
    durationMs,
  });
}
