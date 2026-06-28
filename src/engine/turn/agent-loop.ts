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

import type { SkillManager } from "../../application/skills/skill-manager";
import { TrustManager } from "../../application/trust/trust-manager";
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
import { ContextController } from "../context/context-controller";
import { EvidenceLedger } from "../evidence/evidence-ledger";
import type { ProjectMemorySource } from "../memory/memory-injector";
import type { RecoveryReflectionDraft } from "../memory/reflection-memory-policy";
import { extractTextFromOutput } from "../model-turn/model-turn-runner";
import {
  createDangerousConfirmationAdapter,
  PermissionBroker,
} from "../permissions/permission-broker";
import { evaluateToolBatch } from "../tool-calls/tool-batch-guard";
import { ToolCallExecutor } from "../tool-calls/tool-call-executor";
import type { ProjectCommandFileReader } from "../verification/types";
import { VerificationController } from "../verification/verification-controller";
import { allowsUnverifiedCompletion, inferTaskKindFromPrompt } from "../verification/verification-policy";
import { AgentLoopEventBus } from "./agent-loop-event-bus";
import {
  buildDenialEphemeralMessages,
  turnStopDebugData,
  turnStopReasonEvent,
} from "./agent-loop-event-recording";
import { createAssistantSessionRecorder } from "./assistant-session-recorder";
import { runAutoVerificationOpportunity } from "./auto-verification-opportunity";
import { scheduleCheckpointCompactionForTurn } from "./checkpoint-compaction-scheduler";
import { handleFinishCall } from "./finish-call-handler";
import { LoopGuard } from "./loop-guard";
import { executeModelTurn } from "./model-turn-execution";
import {
  createWorkingNarration,
  isNonTrivialPrompt,
  type WorkingNarrationEventType,
} from "./narration";
import { handleRejectedToolBatch } from "./rejected-tool-batch-handler";
import { decideResponseContinuation } from "./response-continuation-decision";
import { handleResponseStatus, recordResponseUsage } from "./response-lifecycle";
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
  DEFAULT_LOOP_OPTIONS,
  type TurnStopReasonEvent,
} from "./types";

export { createUserItem } from "./turn-helpers";
export type { ProjectContextReader } from "./turn-prompt-preparation";

// ─── AgentLoop ───

export class AgentLoop {
  private client: OpenResponsesClient;
  private session: SessionPort;
  private tools: ToolRegistry;
  private options: AgentLoopOptions;
  private cwd: string;
  private trustManager: TrustManager;
  private budgetTracker: BudgetTracker;
  private contextManager: ContextManager | undefined;
  private backgroundScheduler: BackgroundScheduler | undefined;
  private contextController: ContextController;
  private skillManager: SkillManager | undefined;
  private autoCompactOverride: { enabled: boolean } | undefined;
  private projectMemory: ProjectMemorySource | undefined;
  private projectContextReader: ProjectContextReader | undefined;
  private projectCommandFiles: ProjectCommandFileReader | undefined;
  private _abortController: AbortController | null = null;
  private eventBus: AgentLoopEventBus;
  private toolExecutor: ToolCallExecutor;
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
    trustManager?: TrustManager,
    budgetTracker?: BudgetTracker,
    contextManager?: ContextManager,
    backgroundScheduler?: BackgroundScheduler,
    skillManager?: SkillManager,
    autoCompactOverride?: { enabled: boolean },
    projectMemory?: ProjectMemorySource,
    projectContextReader?: ProjectContextReader,
    projectCommandFiles?: ProjectCommandFileReader,
  ) {
    this.client = client;
    this.session = session;
    this.tools = tools;
    this.cwd = cwd;
    this.options = { ...DEFAULT_LOOP_OPTIONS, ...options };
    this.trustManager = trustManager ?? new TrustManager({ repoRoot: cwd });
    this.trustManager.setRepoRoot(cwd);
    this.budgetTracker =
      budgetTracker ??
      new BudgetTracker({ totalBudget: this.options.tokenBudget });
    this.contextManager = contextManager;
    this.backgroundScheduler = backgroundScheduler;
    this.skillManager = skillManager;
    this.autoCompactOverride = autoCompactOverride;
    this.projectMemory = projectMemory;
    this.projectContextReader = projectContextReader;
    this.projectCommandFiles = projectCommandFiles;
    this.eventBus = new AgentLoopEventBus({
      shouldEmit: () => this.options.emitEvents,
      flight: (data) => this.flight(data),
    });
    this.contextController = new ContextController({
      contextManager: this.contextManager,
      backgroundScheduler: this.backgroundScheduler,
      autoCompactEnabled: () => this.autoCompactOverride?.enabled ?? true,
      emit: (event) => this.emit(event),
    });
    const permissionBroker = new PermissionBroker({
      trustManager: this.trustManager,
      requestPermission: createDangerousConfirmationAdapter({
        hasListeners: () => this.eventBus.hasListeners(),
        dispatch: (event) => this.eventBus.dispatchDangerousConfirmationEvent(event),
      }),
    });
    this.toolExecutor = new ToolCallExecutor({
      registry: this.tools,
      permissionBroker,
      toolContext: () => this.createToolContext(),
      emit: (event) => this.emit(event),
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
    return this.client.getConfig().model;
  }

  /** Get trust manager (for adding custom rules) */
  getTrustManager(): TrustManager {
    return this.trustManager;
  }

  /** Get budget tracker */
  getBudgetTracker(): BudgetTracker {
    return this.budgetTracker;
  }

  /** Get context manager (if available) */
  getContextManager(): ContextManager | undefined {
    return this.contextManager;
  }

  getSessionManager(): SessionPort {
    return this.session;
  }

  setSessionManager(session: SessionPort): void {
    this.session = session;
    this.cwd = session.getCwd();
    this.trustManager.setRepoRoot(this.cwd);
  }

  private createToolContext(): ToolContext {
    return {
      cwd: this.cwd,
      sessionId: this.session.getSessionId(),
      session: this.session,
      bashMaxTimeoutSeconds: this.options.bashMaxTimeoutSeconds,
    };
  }

  /** Get background scheduler (if available) */
  getBackgroundScheduler(): BackgroundScheduler | undefined {
    return this.backgroundScheduler;
  }

  /** Get skill manager (if available) */
  getSkillManager(): SkillManager | undefined {
    return this.skillManager;
  }

  /**
   * Set auto-compact override for runtime toggle.
   * When enabled is false, background compaction is skipped.
   */
  setAutoCompactOverride(override: { enabled: boolean }): void {
    this.autoCompactOverride = override;
  }

  /**
   * Get current auto-compact override status.
   */
  getAutoCompactOverride(): { enabled: boolean } | undefined {
    return this.autoCompactOverride;
  }

  /** Subscribe to agent events */
  onEvent(listener: (event: AgentEvent) => void): () => void {
    return this.eventBus.onEvent(listener);
  }

  /**
   * Write a debug entry to the session when debug mode is enabled.
   */
  private debug(data: DebugEntry["data"]): void {
    if (!this.options.debug) return;
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
    this.eventBus.emit(event);
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
    return this.toolExecutor.abortActiveTool();
  }

  hasActiveTool(): boolean {
    return this.toolExecutor.hasActiveTool();
  }

  /**
   * Execute a user-authored shell command without sending it to the model.
   * Explicit user shell commands bypass agent trust checks.
   */
  async runShellCommand(command: string, silent = false): Promise<ToolResult> {
    return this.toolExecutor.runDirectShellCommand(command, silent);
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
    this.contextController.cancelBackgroundCompaction("new turn started");

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
    const shouldNarrate = isNonTrivialPrompt(userText);
    const emittedNarrationTypes = new Set<WorkingNarrationEventType>();
    const emitNarrationOnce = (
      eventType: WorkingNarrationEventType,
      message: string,
      evidenceIds: string[] = [],
    ) => {
      if (!shouldNarrate || emittedNarrationTypes.has(eventType)) return;
      emittedNarrationTypes.add(eventType);
      this.emitWorkingNarration(eventType, message, evidenceIds);
    };

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
        selectedTools: this.tools.getNames(),
        contextReader: this.projectContextReader,
        skillManager: this.skillManager,
        projectMemory: this.projectMemory,
        modelConfig: this.client.getConfig(),
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
          selectedTools: this.tools.getNames(),
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
      const loopGuard = new LoopGuard(this.options);
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
          tools: this.tools,
          createToolContext: () => this.createToolContext(),
          trustManager: this.trustManager,
          projectInstructions,
          projectFiles: this.projectCommandFiles,
          includeFullGate,
          includeReleaseGate: taskKind === "release_task",
          timeoutSeconds: autoVerifierTimeoutSeconds(this.options.bashMaxTimeoutSeconds),
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
          ...(this.skillManager?.buildEphemeralMessages() ?? []),
          ...this.buildDenialEphemeralMessages(),
        ];

        const modelTurnExecution = await executeModelTurn({
          client: this.client,
          session: this.session,
          tools: this.tools,
          contextController: this.contextController,
          systemPrompt,
          model,
          maxOutputTokens,
          maxCompletionTokens,
          temperature,
          stream: this.options.stream,
          ephemeralMessages,
          allowParallelToolCalls: !needsVerification,
          turn: this.state.turnCount,
          iteration,
          totalUsage: this.state.totalUsage,
          tokenBudget: this.options.tokenBudget,
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
        this.contextController.recordProviderUsage(response, `turn_${this.state.turnCount}`);
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
          budgetTracker: this.budgetTracker,
          contextController: this.contextController,
          tokenBudget: this.options.tokenBudget,
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
          maxContinuationAttempts: this.options.maxContinuationAttempts,
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
            maxAutonomousFollowUps: this.options.maxAutonomousFollowUps,
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
          toolExecutor: this.toolExecutor,
          signal: this._abortController?.signal,
          session: this.session,
          allItems,
          errors,
          successfulToolCallIds,
          verificationEvidenceCallIds,
          evidenceLedger,
          verificationController,
          skillManager: this.skillManager,
          projectMemory: this.projectMemory,
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
            contextController: this.contextController,
            tools: this.tools,
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
        tools: this.tools,
        contextController: this.contextController,
        emit: (event) => this.emit(event),
        debug: (data) => this.debug(data),
      });
    } finally {
      this.toolExecutor.clearActiveTool();
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
