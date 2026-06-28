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
import { type CheckpointEvent, extractCheckpointEvent } from "../../kernel/tools/checkpoint";
import type { ToolRegistry } from "../../kernel/tools/tool-registry";
import type { ToolContext, ToolResult } from "../../kernel/tools/types";
import { toolResultToOutputItem } from "../../kernel/tools/types";
import type {
  DebugEntry,
  FlightRecordData,
  ItemParam as SessionItemParam,
} from "../../kernel/transcript/types";
import { BudgetTracker } from "../budget/budget-tracker";
import type { ContextManager } from "../compaction/context-manager";
import type { BackgroundScheduler } from "../compaction/scheduler";
import { CompletionController } from "../completion/completion-controller";
import { recordToolOutcome } from "../completion/completion-gate";
import { ContextController } from "../context/context-controller";
import { EvidenceLedger, isVerificationCommand } from "../evidence/evidence-ledger";
import type { ProjectMemorySource } from "../memory/memory-injector";
import {
  addRecoveryReflectionFix,
  createRecoveryReflectionDraft,
  type RecoveryReflectionDraft,
  writeRecoveryReflectionLesson,
} from "../memory/reflection-memory-policy";
import { extractTextFromOutput } from "../model-turn/model-turn-runner";
import {
  createDangerousConfirmationAdapter,
  PermissionBroker,
} from "../permissions/permission-broker";
import { evaluateToolBatch, isMutationToolName } from "../tool-calls/tool-batch-guard";
import { ToolCallExecutor } from "../tool-calls/tool-call-executor";
import type { ProjectCommandFileReader } from "../verification/types";
import { VerificationController } from "../verification/verification-controller";
import { allowsUnverifiedCompletion, inferTaskKindFromPrompt } from "../verification/verification-policy";
import {
  buildDenialEphemeralMessages,
  runtimeFlightRecords,
  turnStopDebugData,
  turnStopReasonEvent,
} from "./agent-loop-event-recording";
import { createAssistantSessionRecorder } from "./assistant-session-recorder";
import { runAutoVerificationOpportunity } from "./auto-verification-opportunity";
import { handleFinishCall } from "./finish-call-handler";
import { LoopGuard, type ToolOutcome } from "./loop-guard";
import { executeModelTurn } from "./model-turn-execution";
import {
  createWorkingNarration,
  isNonTrivialPrompt,
  type WorkingNarrationEventType,
} from "./narration";
import { handleRejectedToolBatch } from "./rejected-tool-batch-handler";
import { handleResponseStatus, recordResponseUsage } from "./response-lifecycle";
import {
  autoVerifierTimeoutSeconds,
  canExecuteReadOnlyBatchInParallel,
  checkpointEventToPlanState,
  createLoopErrorResponse,
  createTurnError,
  createUserItem,
  extractCommandArgument,
  extractToolResultText,
  FINISH_TOOL_NAME,
  getAutonomousFollowUpReason,
  hasVisibleAssistantText,
  isInvisibleAssistantMessage,
  safeParseArgs,
  summarizeMutationToolCall,
  toCheckpointArgs,
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
  type DangerousConfirmationEvent,
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

  // Event listeners
  private listeners: Array<(event: AgentEvent) => void> = [];

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
    this.contextController = new ContextController({
      contextManager: this.contextManager,
      backgroundScheduler: this.backgroundScheduler,
      autoCompactEnabled: () => this.autoCompactOverride?.enabled ?? true,
      emit: (event) => this.emit(event),
    });
    const permissionBroker = new PermissionBroker({
      trustManager: this.trustManager,
      requestPermission: createDangerousConfirmationAdapter({
        hasListeners: () => this.listeners.length > 0,
        dispatch: (event) => this.dispatchDangerousConfirmationEvent(event),
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
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
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

  private recordRuntimeFlight(event: AgentEvent): void {
    for (const record of runtimeFlightRecords(event)) this.flight(record);
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
    this.recordRuntimeFlight(event);
    if (!this.options.emitEvents) return;
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors crash the loop
      }
    }
  }

  private dispatchDangerousConfirmationEvent(event: DangerousConfirmationEvent): void {
    this.flight({
      kind: "approval",
      payload: {
        status: "requested",
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        description: event.description,
        level: event.level,
        reason: event.reason,
      },
    });
    const recordingEvent: DangerousConfirmationEvent = {
      ...event,
      resolve: (decision) => {
        this.flight({
          kind: "approval",
          payload: {
            status: "decided",
            decision,
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            description: event.description,
            level: event.level,
            reason: event.reason,
          },
        });
        event.resolve(decision);
      },
    };
    // Emit directly to listeners without going through the normal emit path
    // to bypass the emitEvents flag. Permission prompts must remain available
    // even when ordinary event emission is disabled.
    for (const listener of this.listeners) {
      try {
        listener(recordingEvent);
      } catch {
        // Don't let listener errors crash the loop.
      }
    }
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
      const scheduleCheckpointCompaction = (checkpointEvents: CheckpointEvent[]): void => {
        const checkpointFingerprint = `turn_${turnIndex}_checkpoint_${iteration}`;
        const systemPromptTokens = Math.ceil(systemPrompt.length / 4);
        const toolSchemaTokens = Math.ceil(JSON.stringify(this.tools.getOpenAITools()).length / 4);
        const decision = this.contextController.scheduleLatestMilestone({
          checkpointEvents,
          metrics: {
            systemPromptTokens,
            toolSchemaTokens,
            requestFingerprint: checkpointFingerprint,
          },
        });
        if (!decision.evaluated) return;

        this.debug({
          event: "loop/iteration",
          turn: turnIndex,
          iteration,
          detail: decision.shouldCompact
            ? `milestone scheduled for capsule candidate: ${decision.reason ?? ""}`
            : `milestone recorded without compaction: ${decision.reason ?? ""}`,
        });
      };
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
        } = createAssistantSessionRecorder({
          session: this.session,
          allItems,
          assistantMessages,
        });

        const supersedeVisibleAssistantMessages = () => {
          for (const msg of assistantMessages) {
            if (isInvisibleAssistantMessage(msg)) continue;
            this.emit({
              type: "assistant_message_superseded",
              timestamp: Date.now(),
              messageId: msg.id,
              reason: "autonomous_followup",
            });
          }
        };

        if (shouldContinue && toolCalls.length > 0) {
          if (continuationAttempts < this.options.maxContinuationAttempts) {
            appendAssistantMessagesToSession();
            continuationAttempts++;
            const continuationItem = createUserItem(
              "Your previous response was cut off while generating a tool call. " +
                "Discard the incomplete tool call and re-issue the intended tool call from scratch with complete valid JSON arguments.",
            );
            this.session.appendItem(continuationItem as unknown as SessionItemParam);
            allItems.push(continuationItem as unknown as ItemParam);
            iteration++;
            continue;
          }

          const message =
            `Response remained incomplete while generating tool calls after ${this.options.maxContinuationAttempts} automatic continuations`;
          emitNarrationOnce("blocked", message);
          errors.push(createTurnError("api_error", message, iteration));
          this.emit({
            type: "turn_error",
            timestamp: Date.now(),
            error: message,
            status: "incomplete",
          });
          this._emitStopReason(
            turnIndex,
            iteration,
            "continuation-exhausted",
            message,
            hasUsedTools,
            autonomousFollowUps,
          );
          break;
        }

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

        if (
          shouldContinue &&
          toolCalls.length === 0 &&
          continuationAttempts < this.options.maxContinuationAttempts
        ) {
          appendAssistantMessagesToSession();
          continuationAttempts++;
          const continuationItem = createUserItem(
            "Continue exactly where you stopped. Do not repeat completed text. Keep working until the task is complete.",
          );
          this.session.appendItem(
            continuationItem as unknown as SessionItemParam,
          );
          allItems.push(continuationItem as unknown as ItemParam);
          iteration++;
          continue;
        }

        if (
          shouldContinue &&
          continuationAttempts >= this.options.maxContinuationAttempts
        ) {
          const message = `Response remained incomplete after ${this.options.maxContinuationAttempts} automatic continuations`;
          emitNarrationOnce("blocked", message);
          errors.push(createTurnError("api_error", message, iteration));
          this.emit({
            type: "turn_error",
            timestamp: Date.now(),
            error: message,
            status: "incomplete",
          });
          this._emitStopReason(
            turnIndex,
            iteration,
            "continuation-exhausted",
            message,
            hasUsedTools,
            autonomousFollowUps,
          );
          break;
        }

        if (toolCalls.length === 0 && !shouldContinue && evidenceLedger.getSummary().needsVerification) {
          await runAutoVerificationAt("text-only-stop");
        }

        const autonomousReason =
          toolCalls.length === 0 && !shouldContinue
            ? getAutonomousFollowUpReason(
                assistantMessages,
                needsVerification,
                errors.filter((error) => error.status === "active"),
                hasMutatedFiles,
                hasUsedTools,
              )
            : null;

        // After a security denial, the model has already received
        // "Do NOT attempt alternative approaches". Don't inject a
        // follow-up message that could be interpreted as "continue".
        const hadSecurityDenialThisTurn = errors.some(
          (error) => error.type === "security_denial",
        );
        if (hadSecurityDenialThisTurn && autonomousReason) {
          appendAssistantMessagesToSession();
          this._emitStopReason(
            turnIndex,
            iteration,
            "security-denial",
            "Turn stopped after security denial. The model has been instructed not to continue.",
            hasUsedTools,
            autonomousFollowUps,
          );
          break;
        }

        if (
          autonomousReason &&
          autonomousFollowUps < this.options.maxAutonomousFollowUps
        ) {
          supersedeVisibleAssistantMessages();
          autonomousFollowUps++;
          this.debug({
            event: "loop/auto-continue",
            turn: turnIndex,
            iteration,
            toolCalls: toolCalls.length,
            hasUsedTools,
            needsVerification,
            autonomousFollowUps,
            autoContinue: true,
            textPreview: assistantMessages
              .map(extractTextFromOutput)
              .join(" ")
              .slice(0, 100),
          });
          // Directive injected as a user message — the model must act, not discuss
          const hasActiveErrors = errors.some(
            (error) => error.status === "active",
          );
          const requiredAction = hasActiveErrors
            ? "Call a different available tool or command now to resolve or bypass the error. Do not call finish while the error is active."
            : "Either call a tool to make progress, or call finish with your final response and completion criteria.";
          const followUpItem = createUserItem(
            `${autonomousReason} Do not output commentary about the situation. ${requiredAction}`,
          );
          this.session.appendItem(followUpItem as unknown as SessionItemParam);
          allItems.push(followUpItem as unknown as ItemParam);
          iteration++;
          continue;
        }

        if (autonomousReason) {
          const activeErrors = errors.filter(
            (error) => error.status === "active",
          );

          // If there are active unresolved errors, stop with a loop-guard error.
          if (activeErrors.length > 0) {
            appendAssistantMessagesToSession();
            const actualCount = autonomousFollowUps + 1;
            const message = `No tool calls or finish after ${actualCount} attempts. Active errors remain unresolved.`;
            emitNarrationOnce("blocked", message);
            errors.push(createTurnError("timeout", message, iteration));
            this.emit({
              type: "turn_error",
              timestamp: Date.now(),
              error: message,
            });
            this._emitStopReason(
              turnIndex,
              iteration,
              "loop-guard",
              message,
              hasUsedTools,
              autonomousFollowUps,
            );
            break;
          }

          // If visible text is still empty after all follow-up attempts, stop with an error.
          if (!hasVisibleAssistantText(assistantMessages)) {
            appendAssistantMessagesToSession();
            const actualCount = autonomousFollowUps + 1;
            const message = `No visible response after ${actualCount} attempts. The model kept producing only thinking without substantive output.`;
            emitNarrationOnce("blocked", message);
            errors.push(createTurnError("timeout", message, iteration));
            this.emit({
              type: "turn_error",
              timestamp: Date.now(),
              error: message,
            });
            this._emitStopReason(
              turnIndex,
              iteration,
              "loop-guard",
              message,
              hasUsedTools,
              autonomousFollowUps,
            );
            break;
          }

          // No active errors — accept text-only response as final answer.
          // This covers both non-mutation turns and mutation turns where the model
          // completed work but didn't call finish (model-dependent compliance).
          appendAssistantMessagesToSession();
          this._emitStopReason(
            turnIndex,
            iteration,
            "completed",
            "Model returned a text-only response; accepting as final answer",
            hasUsedTools,
            autonomousFollowUps,
          );
          emitNarrationOnce("completion", "Finishing with a visible final response.");
          break;
        }

        // Reset counter when tool calls are present (model is actively working)
        if (toolCalls.length > 0) {
          autonomousFollowUps = 0;
        }

        // A phased final answer is the only text-only completion signal.
        if (toolCalls.length === 0) {
          appendAssistantMessagesToSession();
          this._emitStopReason(
            turnIndex,
            iteration,
            "completed",
            "Model returned a final response",
            hasUsedTools,
            autonomousFollowUps,
          );
          emitNarrationOnce("completion", "Finishing with a visible final response.");
          break;
        }

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

        // Execute tool calls
        const iterationOutcomes: ToolOutcome[] = [];
        const checkpointEvents: CheckpointEvent[] = [];
        let fixUntilGreenFollowUp: string | null = null;
        let fixUntilGreenStop: string | null = null;
        let mutationSucceededInCurrentBatch = false;
        const parallelReadOnlyExecutions = canExecuteReadOnlyBatchInParallel(toolCalls)
          ? await Promise.all(
              toolCalls.map((toolCall) => {
                hasUsedTools = true;
                return this.toolExecutor.executeToolCall(toolCall, this._abortController?.signal);
              }),
            )
          : null;
        for (let toolCallIndex = 0; toolCallIndex < toolCalls.length; toolCallIndex += 1) {
          const toolCall = toolCalls[toolCallIndex];
          if (!toolCall) continue;
          hasUsedTools = true;

          const narrationArgs = safeParseArgs(toolCall.arguments);

          if (toolCall.name === "edit" || toolCall.name === "write") {
            emitNarrationOnce(
              "edit_intent",
              `Preparing a scoped ${toolCall.name} change before running verification.`,
            );
          } else if (toolCall.name === "bash" && typeof narrationArgs.command === "string") {
            const command = narrationArgs.command.toLowerCase();
            if (isVerificationCommand(command)) {
              emitNarrationOnce("verification", "Running a project verification command.", [toolCall.call_id]);
            }
          }

          const execution = parallelReadOnlyExecutions
            ? parallelReadOnlyExecutions[toolCallIndex]
            : await this.toolExecutor.executeToolCall(toolCall, this._abortController?.signal);
          if (!execution) continue;
          const { parsedArgs, result } = execution;
          if (execution.denied) {
            this.state.denialCount++;
            this.state.lastDeniedOperation = execution.denied.description;
            recordToolOutcome(
              errors,
              successfulToolCallIds,
              toolCall,
              true,
              extractToolResultText(result),
              iteration,
              "security_denial",
            );
            evidenceLedger.recordToolOutcome({
              toolCallId: toolCall.call_id,
              toolName: toolCall.name,
              arguments: toolCall.arguments,
              isError: true,
              output: extractToolResultText(result),
              iteration,
            });
            const outputItem = toolResultToOutputItem(
              result,
              toolCall.call_id,
              toolCall.name,
            );
            this.session.appendItem(outputItem);
            allItems.push(outputItem);
            iterationOutcomes.push({
              toolName: toolCall.name,
              arguments: toolCall.arguments,
              result: extractToolResultText(result),
              isError: result.isError,
              error: result.error,
            });
            continue;
          }

          recordToolOutcome(
            errors,
            successfulToolCallIds,
            toolCall,
            result.isError,
            extractToolResultText(result),
            iteration,
          );
          evidenceLedger.recordToolOutcome({
            toolCallId: toolCall.call_id,
            toolName: toolCall.name,
            arguments: toolCall.arguments,
            isError: result.isError,
            output: extractToolResultText(result),
            iteration,
          });

          if (!result.isError && toolCall.name === "checkpoint") {
            const checkpointArgs = toCheckpointArgs(parsedArgs);
            if (checkpointArgs) {
              const checkpointEvent = extractCheckpointEvent(checkpointArgs);
              checkpointEvents.push(checkpointEvent);
              checkpointState = checkpointEventToPlanState(checkpointEvent);
              evidenceLedger.recordCheckpoint({
                kind: checkpointEvent.kind,
                reason: checkpointEvent.reason,
                nextDirection: checkpointEvent.nextDirection,
                completed: checkpointEvent.completed,
                pending: checkpointEvent.pending,
                toolCallId: toolCall.call_id,
                iteration,
              });
            }
          }

          // Handle activate_skill tool: emit skill_activated event
          if (!result.isError && toolCall.name === "activate_skill") {
            let skillName: string | null = null;
            try {
              const parsed = JSON.parse(toolCall.arguments);
              skillName = typeof parsed?.name === "string" ? parsed.name : null;
            } catch {
              // Ignore parse errors
            }
            if (skillName) {
              const skill = this.skillManager?.getSkill(skillName);
              if (skill) {
                this.emit({
                  type: "skill_activated",
                  timestamp: Date.now(),
                  skillName: skill.name,
                  skillRevision: skill.revision ?? "unknown",
                  skillScope: skill.scope,
                });
              }
            }
          }

          const producedVerificationEvidence = !result.isError &&
            !mutationSucceededInCurrentBatch &&
            (toolCall.name === "read" ||
              (toolCall.name === "bash" && isVerificationCommand(extractCommandArgument(parsedArgs))));

          if (
            !result.isError &&
            isMutationToolName(toolCall.name)
          ) {
            hasMutatedFiles = true;
            needsVerification = true;
            mutationSucceededInCurrentBatch = true;
            verificationEvidenceCallIds.clear();
            verificationController.recordMutationProgress(toolCall.call_id);
            if (recoveryReflectionDraft) {
              recoveryReflectionDraft = addRecoveryReflectionFix(
                recoveryReflectionDraft,
                summarizeMutationToolCall(toolCall.name, parsedArgs),
              );
            }
          } else if (
            needsVerification &&
            producedVerificationEvidence
          ) {
            needsVerification = false;
            verificationEvidenceCallIds.add(toolCall.call_id);
            emitNarrationOnce(
              "verification",
              `Recorded ${toolCall.name} as accepted verification evidence after mutation.`,
              [toolCall.call_id],
            );
          } else if (
            hasMutatedFiles &&
            producedVerificationEvidence
          ) {
            verificationEvidenceCallIds.add(toolCall.call_id);
            emitNarrationOnce(
              "verification",
              `Recorded ${toolCall.name} as accepted verification evidence after mutation.`,
              [toolCall.call_id],
            );
          }

          if (toolCall.name === "bash") {
            const command = extractCommandArgument(parsedArgs);
            const verificationOutcome = verificationController.observeVerificationToolResult({
              toolName: toolCall.name,
              command,
              isError: result.isError,
              output: extractToolResultText(result),
              ledger: evidenceLedger,
            });
            if (verificationOutcome.kind === "recover") {
              recoveryReflectionDraft = createRecoveryReflectionDraft(verificationOutcome.decision.diagnostic);
              fixUntilGreenFollowUp = verificationOutcome.message;
            } else if (verificationOutcome.kind === "stop") {
              recoveryReflectionDraft = null;
              fixUntilGreenStop = verificationOutcome.message;
            } else if (verificationOutcome.kind === "passed" && recoveryReflectionDraft) {
              const reflectionResult = writeRecoveryReflectionLesson(this.projectMemory, {
                task: userText,
                sessionId: this.session.getSessionId(),
                draft: recoveryReflectionDraft,
                verification: verificationOutcome.decision.message,
                observableSuccess: true,
              });
              if (reflectionResult.status === "written") {
                evidenceLedger.recordReflection(`Stored recovery lesson: ${reflectionResult.capsule.summary}`);
              } else if (reflectionResult.reason !== "no_memory") {
                evidenceLedger.recordReflection(`Skipped recovery lesson: ${reflectionResult.reason}`);
              }
              recoveryReflectionDraft = null;
            }
          }

          // Store output in session
          const outputItem = toolResultToOutputItem(
            result,
            toolCall.call_id,
            toolCall.name,
          );
          this.session.appendItem(outputItem);
          allItems.push(outputItem);
          iterationOutcomes.push({
            toolName: toolCall.name,
            arguments: toolCall.arguments,
            result: extractToolResultText(result),
            isError: result.isError,
            error: result.error,
          });
        }

        if (checkpointEvents.length > 0) {
          scheduleCheckpointCompaction(checkpointEvents);
        }

        iteration++;
        if (fixUntilGreenStop) {
          emitNarrationOnce("blocked", fixUntilGreenStop);
          errors.push(createTurnError("timeout", fixUntilGreenStop, iteration));
          this.emit({
            type: "turn_error",
            timestamp: Date.now(),
            error: fixUntilGreenStop,
          });
          this._emitStopReason(
            turnIndex,
            iteration,
            "loop-guard",
            fixUntilGreenStop,
            hasUsedTools,
            autonomousFollowUps,
          );
          break;
        }
        if (fixUntilGreenFollowUp) {
          emitNarrationOnce("recovery", fixUntilGreenFollowUp);
          const recoveryItem = createUserItem(fixUntilGreenFollowUp);
          this.session.appendItem(recoveryItem as unknown as SessionItemParam);
          allItems.push(recoveryItem as unknown as ItemParam);
          continue;
        }
        const progressDecision =
          loopGuard.observeToolIteration(iterationOutcomes);
        if (progressDecision.action === "recover") {
          emitNarrationOnce("recovery", progressDecision.message);
          this.emit({
            type: "loop_guard",
            timestamp: Date.now(),
            action: "recover",
            iteration,
            message: progressDecision.message,
          });
          const recoveryItem = createUserItem(progressDecision.message);
          this.session.appendItem(recoveryItem as unknown as SessionItemParam);
          allItems.push(recoveryItem as unknown as ItemParam);
          continue;
        }
        if (progressDecision.action === "stop") {
          emitNarrationOnce("blocked", progressDecision.message);
          errors.push(
            createTurnError("timeout", progressDecision.message, iteration),
          );
          this.emit({
            type: "loop_guard",
            timestamp: Date.now(),
            action: "stop",
            iteration,
            message: progressDecision.message,
          });
          this.emit({
            type: "turn_error",
            timestamp: Date.now(),
            error: progressDecision.message,
          });
          this._emitStopReason(
            turnIndex,
            iteration,
            "loop-guard",
            progressDecision.message,
            hasUsedTools,
            autonomousFollowUps,
          );
          break;
        }
      } while (true);

      const finalResponse = currentResponse ?? createLoopErrorResponse();

      // Emit turn end
      this.emit({
        type: "turn_end",
        timestamp: Date.now(),
        turnIndex,
        response: finalResponse,
        totalUsage: { ...this.state.totalUsage },
      });
      this.debug({
        event: "loop/turn-end",
        turn: turnIndex,
        iteration,
        responseId: currentResponse?.id,
        responseStatus: currentResponse?.status ?? "failed",
        hasUsedTools,
        needsVerification,
        autonomousFollowUps,
        errors: errors.length,
        activeErrors: errors.filter((error) => error.status === "active")
          .length,
      });

      const turnCompleteSystemPromptTokens = Math.ceil(systemPrompt.length / 4);
      const turnCompleteToolSchemaTokens = Math.ceil(JSON.stringify(this.tools.getOpenAITools()).length / 4);
      this.contextController.scheduleTurnComplete({
        responseStatus: currentResponse?.status,
        errorCount: errors.length,
        metrics: {
          systemPromptTokens: turnCompleteSystemPromptTokens,
          toolSchemaTokens: turnCompleteToolSchemaTokens,
          requestFingerprint: `turn_${turnIndex}_complete`,
        },
      });

      return {
        items: allItems,
        response: finalResponse,
        usage: { ...this.state.totalUsage },
        errors,
        activeErrors: errors.filter((error) => error.status === "active"),
        evidenceSummary: evidenceLedger.getSummary(),
        checkpointState,
      };
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
