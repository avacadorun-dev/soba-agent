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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BudgetTracker } from "../budget/budget-tracker";
import type { OpenResponsesClient } from "../client/openresponses-client";
import type {
  AssistantMessageItemParam,
  CreateResponseParams,
  FunctionCallField,
  FunctionCallItemParam,
  FunctionToolParam,
  ItemParam,
  MessageField,
  OutputTextContent,
  ResponseResource,
  Usage,
} from "../client/types";
import type { ContextManager } from "../compaction/context-manager";
import type { BackgroundScheduler } from "../compaction/scheduler";
import { CompletionController } from "../completion/completion-controller";
import { ContextController } from "../context/context-controller";
import { buildEvidenceBundle, formatEvidenceBundleForHandoff } from "../evidence";
import { buildProjectMemorySection, type ProjectMemorySource } from "../memory/memory-injector";
import {
  addRecoveryReflectionFix,
  createRecoveryReflectionDraft,
  type RecoveryReflectionDraft,
  writeRecoveryReflectionLesson,
} from "../memory/reflection-memory-policy";
import { extractTextFromOutput, ModelTurnRunner } from "../model-turn/model-turn-runner";
import {
  createDangerousConfirmationAdapter,
  PermissionBroker,
} from "../permissions/permission-broker";
import { buildSystemPrompt } from "../prompt/system-prompt";
import type { SessionManager } from "../session/session-manager";
import type {
  DebugEntry,
  FlightRecordData,
  ItemParam as SessionItemParam,
  UserMessageItemParam,
} from "../session/types";
import type { SkillManager } from "../skills/skill-manager";
import { ToolCallExecutor } from "../tool-execution/tool-call-executor";
import { type CheckpointArgs, type CheckpointEvent, extractCheckpointEvent } from "../tools/checkpoint";
import { createToolErrorResult } from "../tools/errors";
import type { ToolRegistry } from "../tools/tool-registry";
import type { ToolContext, ToolResult } from "../tools/types";
import { toolResultToOutputItem } from "../tools/types";
import { TrustManager } from "../trust/trust-manager";
import type { AutoVerifierToolCall } from "../verification/auto-verifier";
import { VerificationController } from "../verification/verification-controller";
import {
  acknowledgeErrors,
  recordToolOutcome,
} from "./completion-gate";
import { EvidenceLedger, isVerificationCommand } from "./evidence-ledger";
import { LoopGuard, type ToolOutcome } from "./loop-guard";
import {
  createWorkingNarration,
  isNonTrivialPrompt,
  type WorkingNarrationEventType,
} from "./narration";
import { evaluateToolBatch, isMutationToolName } from "./tool-batch-guard";
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
import { allowsUnverifiedCompletion, inferTaskKindFromPrompt } from "./verification-policy";

// ─── Helpers ───

/**
 * Create a UserMessageItemParam from plain text.
 */
export function createUserItem(text: string): UserMessageItemParam {
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  };
}

function extractToolResultText(result: ToolResult): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}

function safeParseArgs(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function extractCommandArgument(args: Record<string, unknown>): string {
  if (typeof args.command === "string") return args.command;
  return typeof args.input === "string" ? args.input : "";
}

function summarizeMutationToolCall(toolName: string, args: Record<string, unknown>): string {
  const path = typeof args.path === "string" ? args.path : "";
  return path ? `${toolName} changed ${path}` : `${toolName} changed project files`;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toCheckpointArgs(args: Record<string, unknown>): CheckpointArgs | null {
  const kind = args.kind;
  const reason = args.reason;
  if ((kind !== "milestone" && kind !== "plan_pivot") || typeof reason !== "string") {
    return null;
  }

  return {
    kind,
    reason,
    nextDirection: typeof args.nextDirection === "string" ? args.nextDirection : undefined,
    completed: toStringArray(args.completed),
    pending: toStringArray(args.pending),
  };
}

function checkpointEventToPlanState(event: CheckpointEvent): CheckpointWorkPlanState {
  return {
    lastKind: event.kind,
    reason: event.reason,
    nextDirection: event.nextDirection,
    completed: event.completed.slice(),
    pending: event.pending.slice(),
    updatedAt: event.timestamp,
  };
}

/**
 * Check if assistant messages contain any visible (non-empty) output_text.
 */
function hasVisibleAssistantText(assistantMessages: MessageField[]): boolean {
  return assistantMessages.some(
    (msg) =>
      msg.content
        .filter((c): c is OutputTextContent => c.type === "output_text")
        .map((c) => c.text)
        .join(" ")
        .trim().length > 0,
  );
}

function isInvisibleAssistantMessage(message: MessageField): boolean {
  return !hasVisibleAssistantText([message]);
}

function hasFinishIntentReasoning(assistantMessages: MessageField[]): boolean {
  const reasoningText = assistantMessages
    .map((message) => message.reasoning_content ?? "")
    .join("\n")
    .toLowerCase();
  if (!reasoningText.trim()) return false;

  const compactReasoningText = reasoningText.replace(/[\s_-]+/g, "");
  return (
    /\b(?:call|calling|invoke|use)\s+(?:the\s+)?finish\b/.test(reasoningText) ||
    reasoningText.includes("finish tool") ||
    compactReasoningText.includes("callfinish")
  );
}

function wantsFullVerification(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("full gate") ||
    normalized.includes("full verification") ||
    normalized.includes("release") ||
    normalized.includes("перед коммит") ||
    normalized.includes("полный gate") ||
    normalized.includes("полную провер")
  );
}

function autoVerifierTimeoutSeconds(maxTimeoutSeconds: number): number {
  if (!Number.isFinite(maxTimeoutSeconds) || maxTimeoutSeconds <= 0) return 120;
  return Math.min(120, Math.floor(maxTimeoutSeconds));
}

const FINISH_TOOL_NAME = "finish";
const PARALLEL_READ_ONLY_TOOLS = new Set(["read", "inspect_file", "ls", "search_files"]);
const FINISH_TOOL: FunctionToolParam = {
  type: "function",
  name: FINISH_TOOL_NAME,
  description:
    "Finish the current user turn. Call this only when the task is complete, explicitly unverified with permission, or blocked on required user input. Put the final user-facing response in summary.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "The final user-facing response.",
      },
      status: {
        type: "string",
        description:
          "Use completed when verified work is done, completed_with_unverified_changes only when unverified completion is explicitly allowed, or blocked when required work cannot continue.",
        enum: ["completed", "blocked", "completed_with_unverified_changes"],
      },
      criteria: {
        type: "array",
        description:
          "Concrete completion claims. The loop validates them against successful tool execution.",
        items: {
          type: "object",
          properties: {
            criterion: {
              type: "string",
              description: "A concrete completion criterion.",
            },
            evidenceIds: {
              type: "array",
              description: "Optional Evidence Ledger entry IDs supporting this criterion.",
              items: { type: "string" },
            },
          },
          required: ["criterion"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "status", "criteria"],
    additionalProperties: false,
  },
  strict: true,
};

function canExecuteReadOnlyBatchInParallel(toolCalls: FunctionCallField[]): boolean {
  return toolCalls.length > 1 && toolCalls.every((toolCall) => PARALLEL_READ_ONLY_TOOLS.has(toolCall.name));
}

function finishRequestToMessage(
  toolCall: FunctionCallField,
  summary: string,
  status: "completed" | "blocked" | "completed_with_unverified_changes",
  evidenceText?: string,
): MessageField {
  const baseText = status === "completed_with_unverified_changes"
    ? `Completed with unverified changes:\n${summary}`
    : summary;
  const text = evidenceText ? `${baseText}\n${evidenceText}` : baseText;
  return {
    type: "message",
    id: `finish_${toolCall.call_id}`,
    status: "completed",
    role: "assistant",
    phase: "final_answer",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

function createTurnError(
  type: AgentTurnError["type"],
  message: string,
  iteration?: number,
): AgentTurnError {
  return {
    id: `${type}_${crypto.randomUUID().slice(0, 8)}`,
    type,
    status: "active",
    message,
    iteration,
  };
}

/**
 * Decide whether a text-only response is structurally intermediate.
 *
 * Rules:
 *   - If the model has not used any tools yet in this turn, a text-only
 *     response is treated as a direct answer. Forcing the finish tool here
 *     causes models (e.g. Qwen, DeepSeek) to loop on meta-commentary.
 *   - After the model has used tools, text without finish is intermediate:
 *     the follow-up tells the model to either use tools or call finish.
 *   - Some OpenAI-compatible providers fail to emit the finish tool but expose
 *     their intent in reasoning_content. Accept those as final only after the
 *     verification/error gates below have passed.
 *   - A phased final_answer is accepted as final unless files were mutated
 *     and still need verification.
 */
function getAutonomousFollowUpReason(
  assistantMessages: MessageField[],
  needsVerification: boolean,
  activeErrors: AgentTurnError[],
  hasMutatedFiles: boolean,
  hasUsedTools: boolean,
): string | null {
  if (assistantMessages.length === 0) {
    return null;
  }

  // An empty response is never a valid direct answer, even before tool use.
  if (!hasVisibleAssistantText(assistantMessages)) {
    return "You produced no visible text (only thinking). Write your response in plain text now — do not output only reasoning.";
  }

  // Simple Q&A / explanation turns do not require the finish tool.
  if (!hasUsedTools) {
    return null;
  }

  if (needsVerification) {
    return "You changed project files but stopped before verifying the result. Run the project-appropriate verification workflow now; do not call finish until verification evidence exists unless verification is impossible for a concrete external reason.";
  }

  if (activeErrors.length > 0) {
    const errorList = activeErrors
      .map(
        (error) =>
          `${error.id} (${error.toolName ?? error.type}: ${error.message.slice(0, 120)})`,
      )
      .join("\n    ");
    return `Active tool errors must be resolved before finishing. Fix their cause with tools, or use status blocked only if a concrete external blocker makes recovery impossible:\n    ${errorList}`;
  }

  if (hasFinishIntentReasoning(assistantMessages)) {
    return null;
  }

  if (assistantMessages.some((message) => message.phase === "final_answer")) {
    if (hasMutatedFiles) {
      return "You changed project files. Complete through the finish tool with concrete completion criteria after verification evidence exists.";
    }
    return null;
  }

  return "You stopped without calling finish. If the task is done and verified, call finish now with your final response and completion criteria. If not done, continue with tools.";
}

/**
 * Convert agent output items to session ItemParam items.
 */
function outputItemToSessionItem(
  item: MessageField | FunctionCallField,
): ItemParam | null {
  switch (item.type) {
    case "message": {
      const msg: AssistantMessageItemParam = {
        type: "message",
        role: item.role as "assistant",
        content: item.content,
        id: item.id,
        status: item.status,
      };
      if (item.phase) msg.phase = item.phase;
      if (item.reasoning_content)
        msg.reasoning_content = item.reasoning_content;
      return msg;
    }

    case "function_call": {
      const fc: FunctionCallItemParam = {
        type: "function_call",
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments,
        id: item.id,
        status: "completed",
      };
      if (item.reasoning_content) fc.reasoning_content = item.reasoning_content;
      return fc;
    }

    default:
      return null;
  }
}

function autoVerifierCallToSessionItem(call: AutoVerifierToolCall): FunctionCallItemParam {
  return {
    type: "function_call",
    call_id: call.callId,
    name: call.toolName,
    arguments: call.arguments,
    id: `fc_${call.callId}`,
    status: "completed",
  };
}

/**
 * Read AGENTS.md from cwd if it exists, otherwise README.md.
 */
function readProjectContext(
  cwd: string,
): Array<{ path: string; content: string }> {
  const agentsPath = join(cwd, "AGENTS.md");
  if (existsSync(agentsPath)) {
    try {
      const content = readFileSync(agentsPath, "utf-8");
      return [{ path: "AGENTS.md", content }];
    } catch {
      // fall through to README.md
    }
  }

  const readmePath = join(cwd, "README.md");
  if (existsSync(readmePath)) {
    try {
      const content = readFileSync(readmePath, "utf-8");
      return [{ path: "README.md", content }];
    } catch {
      return [];
    }
  }

  return [];
}

/**
 * Build CreateResponseParams from session and system prompt.
 */
function buildRequest(
  session: SessionManager,
  systemPrompt: string,
  tools: ToolRegistry,
  model: string,
  maxOutputTokens: number,
  maxCompletionTokens: number,
  temperature: number,
  ephemeralMessages: Array<{ role: "developer"; content: string }> = [],
  allowParallelToolCalls = true,
): CreateResponseParams {
  const input = session.buildInput();
  const items = input.items as ItemParam[];

  // Inject ephemeral developer messages at the beginning of the input
  if (ephemeralMessages.length > 0) {
    const ephemeralItems = ephemeralMessages.map(
      (msg) => ({
        type: "message" as const,
        role: "developer" as const,
        content: [{ type: "input_text" as const, text: msg.content }],
      }),
    );
    items.unshift(...ephemeralItems);
  }

  return {
    model,
    input: items,
    instructions: systemPrompt,
    tools: [
      ...tools
        .getOpenResponsesTools()
        .filter(
          (tool) => tool.type !== "function" || tool.name !== FINISH_TOOL_NAME,
        ),
      FINISH_TOOL,
    ],
    previous_response_id: input.previousResponseId ?? undefined,
    parallel_tool_calls: allowParallelToolCalls,
    store: false,
    max_output_tokens: maxOutputTokens,
    max_completion_tokens: maxCompletionTokens > 0 ? maxCompletionTokens : null,
    temperature,
  };
}

// ─── AgentLoop ───

export class AgentLoop {
  private client: OpenResponsesClient;
  private session: SessionManager;
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
    session: SessionManager,
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

  private emitContextUsageUpdate(input: {
    systemPromptTokens: number;
    toolSchemaTokens: number;
    requestFingerprint: string;
    contextWindow: number;
  }): void {
    const effectiveContextTokens = this.contextController.getEffectiveContextTokens({
      systemPromptTokens: input.systemPromptTokens,
      toolSchemaTokens: input.toolSchemaTokens,
      requestFingerprint: input.requestFingerprint,
    });
    const used = effectiveContextTokens ?? this.state.totalUsage.total_tokens;
    const percentage = input.contextWindow > 0 ? Math.round((used / input.contextWindow) * 100) : 0;
    this.emit({
      type: "budget_update",
      timestamp: Date.now(),
      usedTokens: this.state.totalUsage.total_tokens,
      totalBudget: this.options.tokenBudget,
      contextWindow: input.contextWindow,
      percentage,
      effectiveContextTokens,
    });
  }

  /** Get context manager (if available) */
  getContextManager(): ContextManager | undefined {
    return this.contextManager;
  }

  getSessionManager(): SessionManager {
    return this.session;
  }

  setSessionManager(session: SessionManager): void {
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
    const turn = "turnIndex" in event
      ? event.turnIndex
      : "turn" in event && typeof event.turn === "number"
        ? event.turn
        : undefined;
    const iteration = "iteration" in event && typeof event.iteration === "number" ? event.iteration : undefined;

    this.flight({
      kind: "runtime_event",
      turn,
      iteration,
      payload: event,
    });

    if (event.type === "tool_call_start") {
      this.flight({
        kind: "tool_call",
        turn,
        iteration,
        payload: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        },
      });
    } else if (event.type === "tool_call_result") {
      this.flight({
        kind: "tool_result",
        turn,
        iteration,
        payload: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
        },
      });
    }
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
    this.emit({
      type: "turn_stop_reason",
      timestamp: Date.now(),
      turn,
      iteration,
      reason,
      detail,
      hasUsedTools,
      autonomousFollowUps,
    });
    this.debug({
      event: "loop/stop",
      turn,
      iteration,
      reason,
      detail,
      hasUsedTools,
      autonomousFollowUps,
    });
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
    if (this.state.denialCount === 0) return [];

    const op = this.state.lastDeniedOperation || "the operation";

    if (this.state.denialCount === 1) {
      return [
        {
          role: "developer",
          content:
            `IMPORTANT: Your previous attempt to perform "${op}" was DENIED by the user through the security dialog. ` +
            "This is a FINAL decision — do NOT attempt to achieve the same result through alternative commands, " +
            "indirect approaches, or workarounds. The denial means the user does not want this operation executed. " +
            "Acknowledge the denial and either continue with unrelated parts of the task or ask the user how to proceed.",
        },
      ];
    }

    return [
      {
        role: "developer",
        content:
          `CRITICAL: You have been denied ${this.state.denialCount} times in this turn (last: "${op}"). ` +
          "These denials are SECURITY DECISIONS by the user, not transient errors. " +
          "STOP searching for workarounds. Do NOT try: different commands, script wrappers (bun -e, node -e, python -c), " +
          "file moves (mv to /tmp), or any indirect method to achieve the denied outcome. " +
          "Explain what was blocked by security and ask the user how they want to proceed.",
      },
    ];
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
      const contextFiles = readProjectContext(this.cwd);
      const projectInstructions = contextFiles.map((file) => file.content);
      emitNarrationOnce(
        "observation",
        contextFiles.length > 0
          ? `Loaded project instructions from ${contextFiles.map((file) => file.path).join(", ")}.`
          : "No project instruction file was found; using repository structure and targeted reads.",
      );
      
      // Get skill catalog for system prompt
      const skills = this.skillManager?.getCatalogForPrompt() ?? [];
      const projectMemorySection = this.projectMemory
        ? buildProjectMemorySection(this.projectMemory, {
            maxTokens: 2_000,
            query: userText,
          })
        : "";
      
      const systemPrompt = buildSystemPrompt({
        cwd: this.cwd,
        selectedTools: this.tools.getNames(),
        contextFiles,
        skills,
        projectMemorySection,
      });

      // Get current model from client config
      const model = this.client.getConfig().model;
      const maxOutputTokens = this.client.getConfig().maxOutputTokens;
      const maxCompletionTokens = this.client.getConfig().maxCompletionTokens ?? 0;
      const contextWindow = this.client.getConfig().contextWindow;
      const temperature = this.client.getConfig().temperature;
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
      const runAutoVerificationOpportunity = async (opportunity: string): Promise<boolean> => {
        const summaryBefore = evidenceLedger.getSummary();
        if (!summaryBefore.needsVerification) return false;

        const bashTool = this.tools.get("bash");
        const autoVerification = await verificationController.runAutoVerification({
          cwd: this.cwd,
          taskKind,
          evidenceSummary: summaryBefore,
          ledger: evidenceLedger,
          bashTool,
          toolContext: this.createToolContext(),
          trustManager: this.trustManager,
          projectInstructions,
          includeFullGate,
          includeReleaseGate: taskKind === "release_task",
          timeoutSeconds: autoVerifierTimeoutSeconds(this.options.bashMaxTimeoutSeconds),
          iteration,
          signal: this._abortController?.signal,
          onToolCallStart: (call) => {
            const fcItem = autoVerifierCallToSessionItem(call);
            this.session.appendItem(fcItem);
            allItems.push(fcItem);
            this.emit({
              type: "tool_call_start",
              timestamp: Date.now(),
              toolCallId: call.callId,
              toolName: call.toolName,
              args: call.args,
            });
          },
          onToolCallResult: (call, toolResult, durationMs) => {
            this.emitToolResultAndEnd(
              {
                call_id: call.callId,
                name: call.toolName,
              },
              toolResult,
              Date.now() - durationMs,
            );
            recordToolOutcome(
              errors,
              successfulToolCallIds,
              { call_id: call.callId, name: call.toolName, arguments: call.arguments },
              toolResult.isError,
              extractToolResultText(toolResult),
              iteration,
            );
            const outputItem = toolResultToOutputItem(toolResult, call.callId, call.toolName);
            this.session.appendItem(outputItem);
            allItems.push(outputItem);
          },
        });
        const { result } = autoVerification;

        if (autoVerification.activityCount > 0) {
          this.debug({
            event: "loop/iteration",
            turn: turnIndex,
            iteration,
            detail: `auto-verifier ${opportunity}: ${result.executions.length} executed, ${result.skipped.length} skipped`,
          });
        }

        if (!autoVerification.didExecute) return false;

        hasUsedTools = true;
        const summaryAfter = evidenceLedger.getSummary();
        needsVerification = summaryAfter.needsVerification;
        hasMutatedFiles = summaryAfter.hasMutatedFiles;
        for (const execution of result.executions) {
          if (!execution.result.isError) verificationEvidenceCallIds.add(execution.call.callId);
        }
        emitNarrationOnce(
          "verification",
          `Auto-verifier ran ${result.executions.length} project verification command(s).`,
          result.executions.map((execution) => execution.call.callId),
        );
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
        const limitDecision = loopGuard.checkLimits(iteration);
        if (limitDecision.action === "stop") {
          const message = limitDecision.message;
          emitNarrationOnce("blocked", message);
          errors.push(createTurnError("timeout", message, iteration));
          this.emit({
            type: "loop_guard",
            timestamp: Date.now(),
            action: "stop",
            iteration,
            message,
          });
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

        // Force-terminate after too many denials in one turn
        const MAX_DENIALS_PER_TURN = 3;
        if (this.state.denialCount >= MAX_DENIALS_PER_TURN) {
          const message = `Turn terminated: ${this.state.denialCount} operations were denied by security policy in this turn. The user has repeatedly blocked these operations — do not continue.`;
          emitNarrationOnce("blocked", message);
          errors.push(createTurnError("security_denial", message, iteration));
          this.emit({
            type: "loop_guard",
            timestamp: Date.now(),
            action: "stop",
            iteration,
            message,
          });
          this.emit({
            type: "turn_error",
            timestamp: Date.now(),
            error: message,
          });
          this._emitStopReason(
            turnIndex,
            iteration,
            "security-denial",
            message,
            hasUsedTools,
            autonomousFollowUps,
          );
          break;
        }

        // Check for user cancellation
        if (this._abortController?.signal.aborted) {
          const cancelMsg = "Operation cancelled by user";
          errors.push(createTurnError("cancelled", cancelMsg, iteration));
          this.emit({
            type: "turn_stop_reason",
            timestamp: Date.now(),
            turn: turnIndex,
            iteration,
            reason: "aborted",
            detail: cancelMsg,
            hasUsedTools,
            autonomousFollowUps,
          });
          break;
        }

        // Emit thinking
        this.emit({ type: "thinking", timestamp: Date.now(), active: true });

        // Get ephemeral developer messages from active skills + denial warnings
        const ephemeralMessages = [
          ...(this.skillManager?.buildEphemeralMessages() ?? []),
          ...this.buildDenialEphemeralMessages(),
        ];

        // Build request with current input
        const request = buildRequest(
          this.session,
          systemPrompt,
          this.tools,
          model,
          maxOutputTokens,
          maxCompletionTokens,
          temperature,
          ephemeralMessages,
          !needsVerification,
        );

        // Pre-inference check: ensure we're within hard limit
        const systemPromptTokens = Math.ceil(systemPrompt.length / 4);
        const toolSchemaTokens = Math.ceil(JSON.stringify(request.tools).length / 4);
        
        const checkResult = await this.contextController.performPreInferenceCheck({
          systemPromptTokens,
          toolSchemaTokens,
          requestFingerprint: `turn_${this.state.turnCount}`,
        });
        this.emitContextUsageUpdate({
          systemPromptTokens,
          toolSchemaTokens,
          requestFingerprint: `turn_${this.state.turnCount}`,
          contextWindow,
        });
        
        if (!checkResult.canProceed) {
          this.emit({ type: "thinking", timestamp: Date.now(), active: false });
          const errorMsg = checkResult.error || "Cannot proceed: context exceeds hard limit even after compaction";
          emitNarrationOnce("blocked", errorMsg);
          errors.push(createTurnError("api_error", errorMsg, iteration));
          this.emit({
            type: "turn_error",
            timestamp: Date.now(),
            error: errorMsg,
          });
          this._emitStopReason(
            turnIndex,
            iteration,
            "api-error",
            errorMsg,
            hasUsedTools,
            autonomousFollowUps,
          );
          break;
        }

        // Send to LLM — use streaming if enabled
        let response: ResponseResource;
        let toolCalls: Array<FunctionCallField> = [];
        let assistantMessages: Array<MessageField> = [];

        try {
          const modelTurn = await new ModelTurnRunner(this.client, {
            stream: this.options.stream,
            emit: (event) => this.emit(event),
          }).run(request);
          response = modelTurn.response;
          toolCalls = modelTurn.toolCalls;
          assistantMessages = modelTurn.assistantMessages;
        } catch (error) {
          this.emit({ type: "thinking", timestamp: Date.now(), active: false });
          
          // Classify error using provider adapter (safely — not all clients have it)
          const errorType = typeof this.client.classifyError === "function"
            ? this.client.classifyError(error)
            : "unknown";
          if (errorType === "context_overflow") {
            const recoveryResult = await this.contextController.recoverContextOverflow({
              systemPromptTokens,
              toolSchemaTokens,
              requestFingerprint: `turn_${this.state.turnCount}_overflow`,
            });
            if (recoveryResult.recovered && recoveryResult.shouldRetry) {
              // Recovery успешен, повторяем запрос
              this.emit({ type: "thinking", timestamp: Date.now(), active: true });
              continue;
            }
          }
          
          errors.push(
            createTurnError(
              "api_error",
              error instanceof Error ? error.message : String(error),
              iteration,
            ),
          );
          emitNarrationOnce("blocked", error instanceof Error ? error.message : String(error));
          this.emit({
            type: "turn_error",
            timestamp: Date.now(),
            error: error instanceof Error ? error.message : String(error),
          });
          this._emitStopReason(
            turnIndex,
            iteration,
            "api-error",
            error instanceof Error ? error.message : String(error),
            hasUsedTools,
            autonomousFollowUps,
          );
          break;
        }

        // Emit thinking done
        this.emit({ type: "thinking", timestamp: Date.now(), active: false });

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

        // Check response status
        if (response.status === "failed") {
          const errorMsg = response.error?.message ?? "Unknown error";
          emitNarrationOnce("blocked", errorMsg);
          errors.push(createTurnError("api_error", errorMsg, iteration));
          this.emit({
            type: "turn_error",
            timestamp: Date.now(),
            error: errorMsg,
            status: "failed",
          });
          this._emitStopReason(
            turnIndex,
            iteration,
            "api-error",
            errorMsg,
            hasUsedTools,
            autonomousFollowUps,
          );
          break;
        }

        const shouldContinue =
          response.status === "incomplete" &&
          response.incomplete_details?.reason === "max_output_tokens";

        if (response.status === "incomplete" && !shouldContinue) {
          const reason = response.incomplete_details?.reason ?? "unknown";
          errors.push(
            createTurnError(
              "api_error",
              `Response incomplete: ${reason}`,
              iteration,
            ),
          );
          emitNarrationOnce("blocked", `Response incomplete: ${reason}`);
          this.emit({
            type: "turn_error",
            timestamp: Date.now(),
            error: `Response incomplete: ${reason}`,
            status: "incomplete",
          });
        }

        // Accumulate usage
        if (response.usage) {
          this.state.totalUsage.input_tokens += response.usage.input_tokens;
          this.state.totalUsage.output_tokens += response.usage.output_tokens;
          this.state.totalUsage.total_tokens += response.usage.total_tokens;
          this.budgetTracker.addUsage(
            response.usage.input_tokens,
            response.usage.output_tokens,
          );

          // Emit budget update (always — sidebar needs token count even with unlimited budget)
          const percentage =
            this.options.tokenBudget > 0
              ? Math.round(
                  (this.state.totalUsage.total_tokens /
                    this.options.tokenBudget) *
                    100,
                )
              : 0;

          // Compute effective context tokens for the sidebar context counter.
          // Uses the context meter to estimate how full the context window is.
          const effectiveContextTokens = this.contextController.getEffectiveContextTokens({
            systemPromptTokens,
            toolSchemaTokens,
            requestFingerprint: `turn_${turnIndex}_ctx`,
          });

          this.emit({
            type: "budget_update",
            timestamp: Date.now(),
            usedTokens: this.state.totalUsage.total_tokens,
            totalBudget: this.options.tokenBudget,
            contextWindow,
            percentage,
            effectiveContextTokens,
          });
        }

        // Store assistant messages in session
        for (const msg of assistantMessages) {
          // Do not feed an invisible response back to the model. Some
          // OpenAI-compatible reasoning models otherwise continue the same
          // unfinished response instead of following the recovery instruction.
          if (isInvisibleAssistantMessage(msg)) {
            continue;
          }
          const sessionItem = outputItemToSessionItem(msg);
          if (sessionItem) {
            this.session.appendItem(sessionItem as unknown as SessionItemParam);
            allItems.push(sessionItem);
          }
        }

        if (shouldContinue && toolCalls.length > 0) {
          if (continuationAttempts < this.options.maxContinuationAttempts) {
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
          let finishEvaluation = completionController.evaluateFinishCall(finishCall, {
            ...evidenceLedger.toCompletionState(errors),
            taskKind,
            allowUnverifiedCompletion,
          });
          if (finishEvaluation.kind === "rejected" && evidenceLedger.getSummary().needsVerification) {
            const didAutoVerify = await runAutoVerificationOpportunity("finish");
            if (didAutoVerify) {
              finishEvaluation = completionController.evaluateFinishCall(finishCall, {
                ...evidenceLedger.toCompletionState(errors),
                taskKind,
                allowUnverifiedCompletion,
              });
            }
          }

          if (finishEvaluation.kind === "rejected" || finishEvaluation.kind === "invalid") {
            evidenceLedger.recordFinishAttempt(
              "rejected",
              finishEvaluation.kind === "invalid"
                ? "Invalid finish arguments"
                : finishEvaluation.reasons.join("; "),
            );
            this.flight({
              kind: "completion_decision",
              turn: turnIndex,
              iteration,
              payload: {
                status: "rejected",
                kind: finishEvaluation.kind,
                toolCallId: finishCall.call_id,
                detail: finishEvaluation.kind === "invalid"
                  ? finishEvaluation.diagnosis.join(" ")
                  : finishEvaluation.reasons.join("; "),
              },
            });
            const fcItem = outputItemToSessionItem(finishCall);
            if (fcItem) {
              this.session.appendItem(fcItem as unknown as SessionItemParam);
              allItems.push(fcItem);
            }
            const rejection = completionController.createRejectionResult(finishEvaluation);
            const outputItem = toolResultToOutputItem(
              rejection,
              finishCall.call_id,
              finishCall.name,
            );
            this.session.appendItem(outputItem);
            allItems.push(outputItem);
            this.debug({
              event: "loop/finish-rejected",
              turn: turnIndex,
              iteration,
              toolCalls: toolCalls.length,
              hasUsedTools,
              needsVerification,
              autonomousFollowUps,
              activeErrors: errors.filter((error) => error.status === "active")
                .length,
              detail: finishEvaluation.kind === "invalid"
                ? finishEvaluation.diagnosis.join(" ")
                : finishEvaluation.reasons.join(" "),
            });
            const rejectionState = completionController.recordRejection(finishEvaluation);
            if (rejectionState.limitExceeded) {
              errors.push(createTurnError("timeout", rejectionState.message, iteration));
              this.emit({
                type: "turn_error",
                timestamp: Date.now(),
                error: rejectionState.message,
              });
              this._emitStopReason(
                turnIndex,
                iteration,
                "loop-guard",
                rejectionState.message,
                hasUsedTools,
                autonomousFollowUps,
              );
              break;
            }
            iteration++;
            continue;
          }

          const finishRequest = finishEvaluation.request;
          acknowledgeErrors(errors, finishRequest.acknowledgedErrorIds);
          evidenceLedger.recordFinishAttempt("accepted", finishRequest.summary);
          const evidenceBundle = buildEvidenceBundle({
            sessionId: this.session.getSessionId(),
            turnId: `turn_${turnIndex}`,
            completionStatus: finishRequest.status,
            summary: finishRequest.summary,
            ledger: evidenceLedger.getSummary(),
          });
          if (evidenceBundle.diff) {
            this.flight({
              kind: "diff_summary",
              turn: turnIndex,
              iteration,
              payload: evidenceBundle.diff,
            });
          }
          this.flight({
            kind: "evidence_bundle",
            turn: turnIndex,
            iteration,
            payload: evidenceBundle,
          });
          this.flight({
            kind: "completion_decision",
            turn: turnIndex,
            iteration,
            payload: {
              status: "accepted",
              completionStatus: finishRequest.status,
              summary: finishRequest.summary,
              criteria: finishRequest.criteria,
              acknowledgedErrorIds: finishRequest.acknowledgedErrorIds,
            },
          });
          const finishMessage = finishRequestToMessage(
            finishCall,
            finishRequest.summary,
            finishRequest.status,
            formatEvidenceBundleForHandoff(evidenceBundle),
          );
          const text = extractTextFromOutput(finishMessage);
          const sessionItem = outputItemToSessionItem(finishMessage);
          if (sessionItem) {
            this.session.appendItem(sessionItem as unknown as SessionItemParam);
            allItems.push(sessionItem);
          }
          this.emit({
            type: "assistant_message",
            timestamp: Date.now(),
            messageId: finishMessage.id,
            text,
          });
          emitNarrationOnce(
            finishRequest.status === "blocked" ? "blocked" : "completion",
            finishRequest.status === "blocked"
              ? "Finishing as blocked with a concrete external blocker."
              : finishRequest.status === "completed_with_unverified_changes"
                ? "Finishing with explicitly visible unverified changes."
              : "Finishing after satisfying the current completion gate.",
            verificationEvidenceCallIds.size > 0 ? [...verificationEvidenceCallIds] : successfulToolCallIds.size > 0 ? [...successfulToolCallIds] : [],
          );
          this.debug({
            event: "loop/explicit-finish",
            turn: turnIndex,
            iteration,
            toolCalls: toolCalls.length,
            hasUsedTools,
            needsVerification,
            autonomousFollowUps,
            textPreview: text.slice(0, 100),
            activeErrors: errors.filter((error) => error.status === "active")
              .length,
          });
          this._emitStopReason(
            turnIndex,
            iteration,
            "completed",
            "Model used the explicit finish control tool",
            hasUsedTools,
            autonomousFollowUps,
          );
          break;
        }

        if (
          shouldContinue &&
          toolCalls.length === 0 &&
          continuationAttempts < this.options.maxContinuationAttempts
        ) {
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
          await runAutoVerificationOpportunity("text-only-stop");
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
        for (const toolCall of toolCalls) {
          const fcItem: FunctionCallItemParam = {
            type: "function_call",
            call_id: toolCall.call_id,
            name: toolCall.name,
            arguments: toolCall.arguments,
            id: toolCall.id,
            status: "completed",
          };
          if (toolCall.reasoning_content)
            fcItem.reasoning_content = toolCall.reasoning_content;
          this.session.appendItem(fcItem);
          allItems.push(fcItem);
        }

        const batchDecision = evaluateToolBatch(toolCalls);
        if (batchDecision.action === "reject") {
          emitNarrationOnce("recovery", batchDecision.message);
          const iterationOutcomes: ToolOutcome[] = [];
          for (const toolCall of toolCalls) {
            hasUsedTools = true;
            const result = createToolErrorResult({
              code: batchDecision.code,
              category: "validation",
              message: batchDecision.message,
              nextAction: "Run only the mutation now; after observing that result, call the verification tool separately.",
              fingerprint: `validation:${batchDecision.code}`,
            });
            this.emit({
              type: "tool_call_start",
              timestamp: Date.now(),
              toolCallId: toolCall.call_id,
              toolName: toolCall.name,
              args: safeParseArgs(toolCall.arguments),
            });
            this.emitToolResultAndEnd(toolCall, result, Date.now());
            recordToolOutcome(
              errors,
              successfulToolCallIds,
              toolCall,
              true,
              extractToolResultText(result),
              iteration,
            );
            evidenceLedger.recordToolOutcome({
              toolCallId: toolCall.call_id,
              toolName: toolCall.name,
              arguments: toolCall.arguments,
              isError: true,
              output: extractToolResultText(result),
              iteration,
            });
            const outputItem = toolResultToOutputItem(result, toolCall.call_id, toolCall.name);
            this.session.appendItem(outputItem);
            allItems.push(outputItem);
            iterationOutcomes.push({
              toolName: toolCall.name,
              arguments: toolCall.arguments,
              result: extractToolResultText(result),
              isError: true,
              error: result.error,
            });
          }

          const progressDecision = loopGuard.observeToolIteration(iterationOutcomes);
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
            iteration++;
            continue;
          }
          if (progressDecision.action === "stop") {
            emitNarrationOnce("blocked", progressDecision.message);
            errors.push(createTurnError("timeout", progressDecision.message, iteration));
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
            !result.isError &&
            needsVerification &&
            !mutationSucceededInCurrentBatch &&
            (toolCall.name === "read" || toolCall.name === "bash")
          ) {
            needsVerification = false;
            verificationEvidenceCallIds.add(toolCall.call_id);
            emitNarrationOnce(
              "verification",
              `Recorded ${toolCall.name} as verification evidence after mutation.`,
              [toolCall.call_id],
            );
          } else if (
            !result.isError &&
            hasMutatedFiles &&
            !mutationSucceededInCurrentBatch &&
            (toolCall.name === "read" || toolCall.name === "bash")
          ) {
            verificationEvidenceCallIds.add(toolCall.call_id);
            emitNarrationOnce(
              "verification",
              `Recorded ${toolCall.name} as verification evidence after mutation.`,
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

      // Emit turn end
      this.emit({
        type: "turn_end",
        timestamp: Date.now(),
        turnIndex,
        response: currentResponse ?? {
          id: "",
          object: "response",
          created_at: 0,
          completed_at: 0,
          status: "failed",
          incomplete_details: null,
          model: "",
          previous_response_id: null,
          instructions: null,
          output: [],
          error: { code: "loop_error", message: "No response received" },
          tools: [],
          tool_choice: "auto",
          truncation: "disabled",
          parallel_tool_calls: true,
          text: {},
          top_p: 1,
          presence_penalty: 0,
          frequency_penalty: 0,
          top_logprobs: 0,
          temperature: 1,
          reasoning: null,
          usage: null,
          max_output_tokens: null,
          max_tool_calls: null,
          store: false,
          background: false,
          service_tier: "default",
          metadata: {},
          safety_identifier: null,
          prompt_cache_key: null,
        },
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
        response: currentResponse ?? {
          id: "",
          object: "response",
          created_at: 0,
          completed_at: 0,
          status: "failed",
          incomplete_details: null,
          model: "",
          previous_response_id: null,
          instructions: null,
          output: [],
          error: { code: "loop_error", message: "No response received" },
          tools: [],
          tool_choice: "auto",
          truncation: "disabled",
          parallel_tool_calls: true,
          text: {},
          top_p: 1,
          presence_penalty: 0,
          frequency_penalty: 0,
          top_logprobs: 0,
          temperature: 1,
          reasoning: null,
          usage: null,
          max_output_tokens: null,
          max_tool_calls: null,
          store: false,
          background: false,
          service_tier: "default",
          metadata: {},
          safety_identifier: null,
          prompt_cache_key: null,
        },
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
