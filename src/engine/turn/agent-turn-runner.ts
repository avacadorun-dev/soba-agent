import type { ResponseResource, Usage } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { ToolContext } from "../../kernel/tools/types";
import type {
  DebugEntry,
  FlightRecordData,
} from "../../kernel/transcript/types";
import { CompletionController } from "../completion/completion-controller";
import type { RecoveryReflectionDraft } from "../memory/reflection-memory-policy";
import { VerificationController } from "../verification/verification-controller";
import type { AgentLoopRuntimeServices } from "./agent-loop-runtime";
import { beginAgentTurn } from "./agent-turn-begin";
import { prepareAgentTurnPromptContext } from "./agent-turn-prompt-context";
import { handleAgentTurnResponseStage } from "./agent-turn-response-stage";
import {
  buildDenialEphemeralMessages,
  createTurnStopEmitter,
} from "./agent-turn-runner-events";
import { handleAgentTurnToolStage } from "./agent-turn-tool-stage";
import { runAutoVerificationOpportunity } from "./auto-verification-opportunity";
import { handleFinishCall } from "./finish-call-handler";
import { LoopGuard } from "./loop-guard";
import { executeModelTurn } from "./model-turn-execution";
import { decideTextOnlyResponse } from "./text-only-response-decision";
import { completeAgentTurn } from "./turn-completion";
import {
  autoVerifierTimeoutSeconds,
  FINISH_TOOL_NAME,
  wantsFullVerification,
} from "./turn-helpers";
import { evaluateTurnStopGuards } from "./turn-stop-guards";
import type {
  AgentEvent,
  AgentTurnResult,
  CheckpointWorkPlanState,
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
  const emitStopReason = createTurnStopEmitter({ emit, debug });
  const {
    abortController,
    turnIndex,
    errors,
    allItems,
    evidenceLedger,
    taskKind,
    allowUnverifiedCompletion,
    emitNarrationOnce,
  } = beginAgentTurn({
    userText,
    session,
    state,
    setAbortController,
    emit,
    debug,
  });
  runtime.contextController.cancelBackgroundCompaction("new turn started");
  try {
    const preparedPrompt = await prepareAgentTurnPromptContext({
      cwd,
      userText,
      turnIndex,
      taskKind,
      runtime,
      narrate: emitNarrationOnce,
      flight,
    });
    const {
      projectInstructions,
      systemPrompt,
      model,
      maxOutputTokens,
      maxCompletionTokens,
      contextWindow,
      temperature,
    } = preparedPrompt;
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
      const responseStage = handleAgentTurnResponseStage({
        execution: modelTurnExecution,
        runtime,
        session: session,
        allItems,
        errors,
        turnIndex,
        turnCount: state.turnCount,
        totalUsage: state.totalUsage,
        iteration,
        continuationAttempts,
        contextWindow,
        hasUsedTools,
        needsVerification,
        autonomousFollowUps,
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
      currentResponse = responseStage.response;
      continuationAttempts = responseStage.continuationAttempts;
      iteration = responseStage.iteration;
      if (responseStage.action !== "ready") {
        if (responseStage.action === "continue") continue;
        break;
      }
      const {
        appendAssistantMessagesToSession,
        appendToolCallGroupToSession,
        supersedeVisibleAssistantMessages,
      } = responseStage.recorder;
      const readyToolCalls = responseStage.toolCalls;
      const readyAssistantMessages = responseStage.assistantMessages;
      const finishCall =
        readyToolCalls.length === 1 && readyToolCalls[0].name === FINISH_TOOL_NAME
          ? readyToolCalls[0]
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
      if (readyToolCalls.length === 0) {
        const textOnlyDecision = await decideTextOnlyResponse({
          assistantMessages: readyAssistantMessages,
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
      const toolStage = await handleAgentTurnToolStage({
        toolCalls: readyToolCalls,
        appendToolCallGroupToSession,
        runtime,
        signal: abortController.signal,
        session: session,
        allItems,
        errors,
        successfulToolCallIds,
        verificationEvidenceCallIds,
        evidenceLedger,
        verificationController,
        loopGuard,
        taskText: userText,
        turnIndex,
        iteration,
        systemPrompt,
        needsVerification,
        hasMutatedFiles,
        recoveryReflectionDraft,
        recordDenial: (description) => {
          state.denialCount++;
          state.lastDeniedOperation = description;
        },
        emit: (event) => emit(event),
        debug: (data) => debug(data),
        emitStopReason: (stopIteration, stageHasUsedTools, reason, detail) => {
          emitStopReason(
            turnIndex,
            stopIteration,
            reason,
            detail,
            stageHasUsedTools,
            autonomousFollowUps,
          );
        },
        narrate: (eventType, message, evidenceIds = []) =>
          emitNarrationOnce(eventType, message, evidenceIds),
      });

      hasUsedTools = hasUsedTools || toolStage.usedTools;
      iteration = toolStage.iteration;
      needsVerification = toolStage.needsVerification;
      hasMutatedFiles = toolStage.hasMutatedFiles;
      recoveryReflectionDraft = toolStage.recoveryReflectionDraft;
      if (toolStage.checkpointState) checkpointState = toolStage.checkpointState;

      if (toolStage.action === "break") {
        break;
      }
      if (toolStage.action === "continue") continue;
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
