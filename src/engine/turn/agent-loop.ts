/**
 * Agent Loop.
 *
 * The main execution loop of the SOBA agent:
 *   1. Accept user input as UserMessageItemParam
 *   2. Build input from session (history + compaction)
 *   3. Send to OpenResponses client with tools
 *   4. Process response output items:
 *      - assistant messages → append to session, emit events
 *      - function_call → execute tool, append output, loop back
 *      - local_shell_call → execute bash, append output, loop back
 *   5. Handle errors, stop states, budget updates
 */

import type { OpenResponsesClient } from "../../kernel/model/model-gateway";
import type {
  ItemParam,
  ResponseResource,
  Usage,
} from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { ToolRegistry } from "../../kernel/tools/tool-registry";
import type { ToolContext, ToolResult } from "../../kernel/tools/types";
import type {
  DebugEntry,
  FlightRecordData,
  ItemParam as SessionItemParam,
} from "../../kernel/transcript/types";
import { BudgetTracker } from "../budget/budget-tracker";
import type { ContextManager } from "../compaction/context-manager";
import type { BackgroundScheduler } from "../compaction/scheduler";
import { CompletionController } from "../completion/completion-controller";
import { EvidenceLedger } from "../evidence/evidence-ledger";
import type { ProjectMemorySource } from "../memory/memory-injector";
import type { RecoveryReflectionDraft } from "../memory/reflection-memory-policy";
import { extractTextFromOutput } from "../model-turn/model-turn-runner";
import type { TrustController } from "../permissions/trust-controller";
import { evaluateToolBatch } from "../tool-calls/tool-batch-guard";
import type { ProjectCommandFileReader } from "../verification/types";
import { VerificationController } from "../verification/verification-controller";
import { allowsUnverifiedCompletion, inferTaskKindFromPrompt } from "../verification/verification-policy";
import {
  buildDenialEphemeralMessages,
  turnStopDebugData,
  turnStopReasonEvent,
} from "./agent-loop-event-recording";
import {
  type AgentLoopRuntimeServices,
  createAgentLoopRuntime,
} from "./agent-loop-runtime";
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
import { handleResponseStatus, recordResponseUsage } from "./response-lifecycle";
import type { SkillSource } from "./skill-source";
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
import {
  type ProjectContextReader,
  prepareTurnPrompt,
} from "./turn-prompt-preparation";
import { evaluateTurnStopGuards } from "./turn-stop-guards";
import {
  type AgentEvent,
  type AgentLoopOptions,
  type AgentTurnError,
  type AgentTurnResult,
  type CheckpointWorkPlanState,
  type TurnStopReasonEvent,
} from "./types";

export { createUserItem } from "./turn-helpers";
export type { ProjectContextReader } from "./turn-prompt-preparation";

// ─── AgentLoop ───

export class AgentLoop {
  private session: SessionPort;
  private cwd: string;
  private runtime: AgentLoopRuntimeServices;
  private _abortController: AbortController | null = null;
  private state = {
    totalUsage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    } as Usage,
    turnCount: 0,
    isProcessing: false,
    /** Number of trust-dialog denials in the current turn */
    denialCount: 0,
    /** Description of the most recently denied operation */
    lastDeniedOperation: "",
  };

  constructor(
    client: OpenResponsesClient,
    session: SessionPort,
    tools: ToolRegistry,
    cwd: string,
    options: Partial<AgentLoopOptions> = {},
    trustManager?: TrustController,
    budgetTracker?: BudgetTracker,
    contextManager?: ContextManager,
    backgroundScheduler?: BackgroundScheduler,
    skillManager?: SkillSource,
    autoCompactOverride?: { enabled: boolean },
    projectMemory?: ProjectMemorySource,
    projectContextReader?: ProjectContextReader,
    projectCommandFiles?: ProjectCommandFileReader,
  ) {
    this.session = session;
    this.cwd = cwd;
    this.runtime = createAgentLoopRuntime({
      client,
      session,
      tools,
      cwd,
      options,
      trustManager,
      budgetTracker,
      contextManager,
      backgroundScheduler,
      skillManager,
      autoCompactOverride,
      projectMemory,
      projectContextReader,
      projectCommandFiles,
      createToolContext: () => this.createToolContext(),
      flight: (data) => this.flight(data),
    });
  }

  /** Get current total usage */
  getUsage(): Usage {
    return { ...this.state.totalUsage };
  }

  /** Get turn count */
  getTurnCount(): number {
    return this.state.turnCount;
  }

  /** Get the active model from the client config */
  getModel(): string {
    return this.runtime.client.getConfig().model;
  }

  /** Get trust controller (legacy method name kept for host compatibility). */
  getTrustManager(): TrustController {
    return this.runtime.trustManager;
  }

  /** Get budget tracker */
  getBudgetTracker(): BudgetTracker {
    return this.runtime.budgetTracker;
  }

  /** Get context manager (if available) */
  getContextManager(): ContextManager | undefined {
    return this.runtime.contextManager;
  }

  getSessionManager(): SessionPort {
    return this.session;
  }

  setSessionManager(session: SessionPort): void {
    this.session = session;
    this.cwd = session.getCwd();
    this.runtime.trustManager.setRepoRoot(this.cwd);
  }

  private createToolContext(): ToolContext {
    return {
      cwd: this.cwd,
      sessionId: this.session.getSessionId(),
      session: this.session,
      bashMaxTimeoutSeconds: this.runtime.options.bashMaxTimeoutSeconds,
    };
  }

  /** Get background scheduler (if available) */
  getBackgroundScheduler(): BackgroundScheduler | undefined {
    return this.runtime.backgroundScheduler;
  }

  /** Get skill source (legacy method name kept for host compatibility). */
  getSkillManager(): SkillSource | undefined {
    return this.runtime.skillManager;
  }

  /**
   * Set auto-compact override for runtime toggle.
   * When enabled is false, background compaction is skipped.
   */
  setAutoCompactOverride(override: { enabled: boolean }): void {
    this.runtime.setAutoCompactOverride(override);
  }

  /**
   * Get current auto-compact override status.
   */
  getAutoCompactOverride(): { enabled: boolean } | undefined {
    return this.runtime.getAutoCompactOverride();
  }

  /** Subscribe to agent events */
  onEvent(listener: (event: AgentEvent) => void): () => void {
    return this.runtime.eventBus.onEvent(listener);
  }

  /**
   * Write a debug entry to the session when debug mode is enabled.
   */
  private debug(data: DebugEntry["data"]): void {
    if (!this.runtime.options.debug) return;
    this.session.appendDebug(data);
  }

  private flight(data: Omit<FlightRecordData, "version">): void {
    this.session.appendFlightRecord({ version: 1, ...data });
  }

  /** Emit a turn_stop_reason event and debug entry */
  private _emitStopReason(
    turn: number,
    iteration: number,
    reason: TurnStopReasonEvent["reason"],
    detail: string,
    hasUsedTools: boolean,
    autonomousFollowUps: number,
  ): void {
    const input = {
      turn,
      iteration,
      reason,
      detail,
      hasUsedTools,
      autonomousFollowUps,
    };
    this.emit(turnStopReasonEvent(input));
    this.debug(turnStopDebugData(input));
  }

  private emitWorkingNarration(
    eventType: WorkingNarrationEventType,
    message: string,
    evidenceIds: string[] = [],
  ): void {
    const narration = createWorkingNarration({ eventType, message, evidenceIds });
    this.emit({
      type: "working_narration",
      timestamp: Date.now(),
      eventType: narration.eventType,
      message: narration.message,
      evidenceIds: narration.evidenceIds,
    });
  }

  /** Emit an event to all listeners */
  private emit(event: AgentEvent): void {
    this.runtime.eventBus.emit(event);
  }

  /**
   * Build ephemeral developer messages triggered by trust-dialog denials.
   * These are injected at the beginning of the next iteration to give the
   * model a fresh, high-priority instruction to stop looking for workarounds.
   */
  private buildDenialEphemeralMessages(): Array<{ role: "developer"; content: string }> {
    return buildDenialEphemeralMessages(this.state.denialCount, this.state.lastDeniedOperation);
  }

  /**
   * Abort the currently running turn (if any).
   * Cancels in-progress tool execution (e.g., long-running bash commands).
   */
  abort(): void {
    this._abortController?.abort();
  }

  /** Stop only the currently executing tool and allow the agent turn to continue. */
  abortActiveTool(): boolean {
    return this.runtime.toolExecutor.abortActiveTool();
  }

  hasActiveTool(): boolean {
    return this.runtime.toolExecutor.hasActiveTool();
  }

  /**
   * Execute a user-authored shell command without sending it to the model.
   * Explicit user shell commands bypass agent trust checks.
   */
  async runShellCommand(command: string, silent = false): Promise<ToolResult> {
    return this.runtime.toolExecutor.runDirectShellCommand(command, silent);
  }

  /**
   * Run a single turn of the agent loop.
   *
   * A turn processes one user input and continues until
   * the LLM returns a response without tool calls.
   */
  async runTurn(userText: string): Promise<AgentTurnResult> {
    if (this.state.isProcessing) {
      throw new Error("Agent is already processing a turn");
    }

    // Cancel any background compaction operation when starting a new turn
    this.runtime.contextController.cancelBackgroundCompaction("new turn started");

    this.state.isProcessing = true;
    this.state.turnCount++;
    this.state.denialCount = 0;
    this.state.lastDeniedOperation = "";
    this._abortController = new AbortController();
    const turnIndex = this.state.turnCount;
    const errors: AgentTurnError[] = [];
    const allItems: ItemParam[] = [];
    const evidenceLedger = new EvidenceLedger();
    const taskKind = inferTaskKindFromPrompt(userText);
    const allowUnverifiedCompletion = allowsUnverifiedCompletion(userText);
    const emitNarrationOnce = createWorkingNarrationGate({
      enabled: isNonTrivialPrompt(userText),
      emit: (eventType, message, evidenceIds = []) =>
        this.emitWorkingNarration(eventType, message, evidenceIds),
    });

    // Emit turn start
    this.emit({
      type: "turn_start",
      timestamp: Date.now(),
      turnIndex,
      userInput: userText,
    });

    // Create and append user message
    const userItem = createUserItem(userText);
    this.session.appendItem(userItem as unknown as SessionItemParam);
    allItems.push(userItem as unknown as ItemParam);
    this.debug({
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
        cwd: this.cwd,
        userText,
        selectedTools: this.runtime.tools.getNames(),
        contextReader: this.runtime.projectContextReader,
        skillManager: this.runtime.skillManager,
        projectMemory: this.runtime.projectMemory,
        modelConfig: this.runtime.client.getConfig(),
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
      this.flight({
        kind: "prompt_snapshot",
        turn: turnIndex,
        payload: {
          cwd: this.cwd,
          userInput: userText,
          taskKind,
          model,
          selectedTools: this.runtime.tools.getNames(),
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
      const includeFullGate = wantsFullVerification(userText) || taskKind === "release_task";
      const loopGuard = new LoopGuard(this.runtime.options);
      const completionController = new CompletionController();
      const verificationController = new VerificationController();
      let recoveryReflectionDraft: RecoveryReflectionDraft | null = null;
      const runAutoVerificationAt = async (opportunity: string): Promise<boolean> => {
        const autoVerification = await runAutoVerificationOpportunity({
          opportunity,
          cwd: this.cwd,
          turn: turnIndex,
          iteration,
          taskKind,
          ledger: evidenceLedger,
          verificationController,
          tools: this.runtime.tools,
          createToolContext: () => this.createToolContext(),
          trustManager: this.runtime.trustManager,
          projectInstructions,
          projectFiles: this.runtime.projectCommandFiles,
          includeFullGate,
          includeReleaseGate: taskKind === "release_task",
          timeoutSeconds: autoVerifierTimeoutSeconds(this.runtime.options.bashMaxTimeoutSeconds),
          signal: this._abortController?.signal,
          session: this.session,
          allItems,
          errors,
          successfulToolCallIds,
          verificationEvidenceCallIds,
          emit: (event) => this.emit(event),
          debug: (data) => this.debug(data),
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
        this.debug({
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
          denialCount: this.state.denialCount,
          signal: this._abortController?.signal,
          hasUsedTools,
          autonomousFollowUps,
          emit: (event) => this.emit(event),
          emitStopReason: (reason, detail) => {
            this._emitStopReason(
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
          ...(this.runtime.skillManager?.buildEphemeralMessages() ?? []),
          ...this.buildDenialEphemeralMessages(),
        ];

        const modelTurnExecution = await executeModelTurn({
          client: this.runtime.client,
          session: this.session,
          tools: this.runtime.tools,
          contextController: this.runtime.contextController,
          systemPrompt,
          model,
          maxOutputTokens,
          maxCompletionTokens,
          temperature,
          stream: this.runtime.options.stream,
          ephemeralMessages,
          allowParallelToolCalls: !needsVerification,
          turn: this.state.turnCount,
          iteration,
          totalUsage: this.state.totalUsage,
          tokenBudget: this.runtime.options.tokenBudget,
          contextWindow,
          errors,
          emit: (event) => this.emit(event),
          emitStopReason: (reason, detail) => {
            this._emitStopReason(
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
        this.runtime.contextController.recordProviderUsage(response, `turn_${this.state.turnCount}`);
        this.debug({
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
          emit: (event) => this.emit(event),
          emitStopReason: (reason, detail) => {
            this._emitStopReason(
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
          totalUsage: this.state.totalUsage,
          budgetTracker: this.runtime.budgetTracker,
          contextController: this.runtime.contextController,
          tokenBudget: this.runtime.options.tokenBudget,
          contextWindow,
          systemPromptTokens,
          toolSchemaTokens,
          turn: turnIndex,
          emit: (event) => this.emit(event),
        });

        const {
          appendAssistantMessagesToSession,
          appendToolCallGroupToSession,
          supersedeVisibleAssistantMessages,
        } = createAssistantSessionRecorder({
          session: this.session,
          allItems,
          assistantMessages,
          emit: (event) => this.emit(event),
        });

        const continuationDecision = decideResponseContinuation({
          shouldContinue,
          toolCallsLength: toolCalls.length,
          continuationAttempts,
          maxContinuationAttempts: this.runtime.options.maxContinuationAttempts,
          session: this.session,
          allItems,
          errors,
          iteration,
          appendAssistantMessagesToSession,
          emit: (event) => this.emit(event),
          emitStopReason: (reason, detail) => {
            this._emitStopReason(
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
            session: this.session,
            allItems,
            turn: turnIndex,
            iteration,
            hasUsedTools,
            needsVerification,
            autonomousFollowUps,
            verificationEvidenceCallIds,
            successfulToolCallIds,
            emit: (event) => this.emit(event),
            flight: (data) => this.flight(data),
            debug: (data) => this.debug(data),
            emitStopReason: (reason, detail) => {
              this._emitStopReason(
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
            session: this.session,
            allItems,
            errors,
            turn: turnIndex,
            iteration,
            autonomousFollowUps,
            maxAutonomousFollowUps: this.runtime.options.maxAutonomousFollowUps,
            ledgerNeedsVerification: () => evidenceLedger.getSummary().needsVerification,
            getTurnState: () => ({
              needsVerification,
              hasMutatedFiles,
              hasUsedTools,
            }),
            runAutoVerification: () => runAutoVerificationAt("text-only-stop"),
            appendAssistantMessagesToSession,
            supersedeVisibleAssistantMessages,
            emit: (event) => this.emit(event),
            debug: (data) => this.debug(data),
            emitStopReason: (reason, detail) => {
              this._emitStopReason(
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
            session: this.session,
            allItems,
            errors,
            successfulToolCallIds,
            evidenceLedger,
            loopGuard,
            iteration,
            emit: (event) => this.emit(event),
            emitToolResultAndEnd: (toolCall, result, startedAt) =>
              this.emitToolResultAndEnd(toolCall, result, startedAt),
            emitStopReason: (reason, detail) => {
              this._emitStopReason(
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
          toolExecutor: this.runtime.toolExecutor,
          signal: this._abortController?.signal,
          session: this.session,
          allItems,
          errors,
          successfulToolCallIds,
          verificationEvidenceCallIds,
          evidenceLedger,
          verificationController,
          skillManager: this.runtime.skillManager,
          projectMemory: this.runtime.projectMemory,
          taskText: userText,
          iteration,
          state: toolObservationState,
          recordDenial: (description) => {
            this.state.denialCount++;
            this.state.lastDeniedOperation = description;
          },
          emit: (event) => this.emit(event),
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
        recoveryReflectionDraft = toolBatchExecution.state.recoveryReflectionDraft;
        fixUntilGreenFollowUp = toolBatchExecution.state.fixUntilGreenFollowUp;
        fixUntilGreenStop = toolBatchExecution.state.fixUntilGreenStop;

        if (toolBatchExecution.checkpointEvents.length > 0) {
          scheduleCheckpointCompactionForTurn({
            checkpointEvents: toolBatchExecution.checkpointEvents,
            contextController: this.runtime.contextController,
            tools: this.runtime.tools,
            turnIndex,
            iteration,
            systemPrompt,
            debug: (data) => this.debug(data),
          });
        }

        iteration++;
        const afterToolDecision = decideAfterToolIteration({
          fixUntilGreenStop,
          fixUntilGreenFollowUp,
          loopGuard,
          iterationOutcomes: toolBatchExecution.iterationOutcomes,
          session: this.session,
          allItems,
          errors,
          iteration,
          emit: (event) => this.emit(event),
          emitStopReason: (reason, detail) => {
            this._emitStopReason(
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
        totalUsage: this.state.totalUsage,
        errors,
        hasUsedTools,
        needsVerification,
        autonomousFollowUps,
        evidenceSummary: evidenceLedger.getSummary(),
        checkpointState,
        systemPrompt,
        tools: this.runtime.tools,
        contextController: this.runtime.contextController,
        emit: (event) => this.emit(event),
        debug: (data) => this.debug(data),
      });
    } finally {
      this.runtime.toolExecutor.clearActiveTool();
      this._abortController = null;
      this.state.isProcessing = false;
    }
  }

  private emitToolResultAndEnd(
    toolCall: { call_id: string; name: string },
    result: ToolResult,
    startTime: number,
  ): void {
    const durationMs = Date.now() - startTime;

    this.emit({
      type: "tool_call_result",
      timestamp: Date.now(),
      toolCallId: toolCall.call_id,
      toolName: toolCall.name,
      result,
    });

    this.emit({
      type: "tool_call_end",
      timestamp: Date.now(),
      toolCallId: toolCall.call_id,
      toolName: toolCall.name,
      durationMs,
    });
  }
}
