/**
 * Agent Loop types.
 *
 * Events and state for the main agent loop.
 */

import type { ItemParam, ResponseResource, Usage } from "../../kernel/model/openresponses-types";
import type { ToolResult } from "../../kernel/tools/types";
import type { EvidenceLedgerSummary } from "../evidence/evidence-ledger";
import type { WorkingNarrationEventType } from "./narration";

// ─── Agent State ───

/**
 * The current state of the agent loop during execution.
 */
export interface AgentState {
  /** Current model */
  model: string;
  /** Accumulated usage across all turns */
  totalUsage: Usage;
  /** Whether the agent is currently processing a turn */
  isProcessing: boolean;
  /** Number of turns in the current session */
  turnCount: number;
}

// ─── Agent Events ───

export type AgentEventType =
  | "turn_start"
  | "thinking"
  | "assistant_message"
  | "assistant_message_superseded"
  | "assistant_message_start"
  | "assistant_text_delta"
  | "assistant_reasoning_delta"
  | "assistant_text_done"
  | "function_call_delta"
  | "function_call_done"
  | "tool_call_start"
  | "tool_call_result"
  | "tool_call_end"
  | "turn_end"
  | "turn_error"
  | "loop_guard"
  | "budget_update"
  | "dangerous_confirmation"
  | "turn_stop_reason"
  | "compaction_start"
  | "compaction_done"
  | "context_error"
  | "working_narration"
  | "skill_activated"
  | "skill_deactivated";

export interface BaseAgentEvent {
  type: AgentEventType;
  timestamp: number;
}

export interface TurnStartEvent extends BaseAgentEvent {
  type: "turn_start";
  turnIndex: number;
  userInput: string;
}

export interface ThinkingEvent extends BaseAgentEvent {
  type: "thinking";
  /** Set to true when thinking starts, false when it ends */
  active: boolean;
}

export interface AssistantMessageEvent extends BaseAgentEvent {
  type: "assistant_message";
  messageId: string;
  text: string;
  reasoningContent?: string;
}

export interface AssistantMessageSupersededEvent extends BaseAgentEvent {
  type: "assistant_message_superseded";
  messageId: string;
  reason: "autonomous_followup";
}

export interface ToolCallStartEvent extends BaseAgentEvent {
  type: "tool_call_start";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolCallResultEvent extends BaseAgentEvent {
  type: "tool_call_result";
  toolCallId: string;
  toolName: string;
  result: ToolResult;
}

export interface ToolCallEndEvent extends BaseAgentEvent {
  type: "tool_call_end";
  toolCallId: string;
  toolName: string;
  durationMs: number;
}

export interface TurnEndEvent extends BaseAgentEvent {
  type: "turn_end";
  turnIndex: number;
  response: ResponseResource;
  totalUsage: Usage;
}

export interface TurnErrorEvent extends BaseAgentEvent {
  type: "turn_error";
  error: string;
  status?: string;
}

export interface LoopGuardEvent extends BaseAgentEvent {
  type: "loop_guard";
  action: "recover" | "stop";
  iteration: number;
  message: string;
}

export interface BudgetUpdateEvent extends BaseAgentEvent {
  type: "budget_update";
  usedTokens: number;
  totalBudget: number;
  contextWindow?: number;
  percentage: number;
  /** Effective context tokens currently in the request (system prompt + conversation + trailing). -1 if not available. */
  effectiveContextTokens?: number;
}

export interface DangerousConfirmationEvent extends BaseAgentEvent {
  type: "dangerous_confirmation";
  toolName: string;
  toolCallId: string;
  /** Command text for bash, or tool arguments for other tools */
  description: string;
  /** Trust level that triggered the confirmation */
  level: "dangerous";
  /** Human-readable reason */
  reason: string;
  /** Resolve with the selected approval scope. */
  resolve: (decision: ApprovalDecision) => void;
}

export type ApprovalDecision = "deny" | "once" | "session" | "repo" | "full";

/**
 * Emitted when the agent loop decides to stop a turn.
 * Contains structured reason for display and debug logging.
 */
export interface TurnStopReasonEvent extends BaseAgentEvent {
  type: "turn_stop_reason";
  turn: number;
  iteration: number;
  reason: "completed" | "loop-guard" | "api-error" | "aborted" | "budget-exceeded" | "continuation-exhausted" | "security-denial";
  detail: string;
  hasUsedTools: boolean;
  autonomousFollowUps: number;
}

export interface AssistantMessageStartEvent extends BaseAgentEvent {
  type: "assistant_message_start";
  messageId: string;
}

export interface AssistantTextDeltaEvent extends BaseAgentEvent {
  type: "assistant_text_delta";
  messageId: string;
  delta: string;
}

export interface AssistantReasoningDeltaEvent extends BaseAgentEvent {
  type: "assistant_reasoning_delta";
  messageId: string;
  delta: string;
}

export interface AssistantTextDoneEvent extends BaseAgentEvent {
  type: "assistant_text_done";
  messageId: string;
  fullText: string;
  reasoningContent?: string;
}

export interface FunctionCallDeltaEvent extends BaseAgentEvent {
  type: "function_call_delta";
  toolCallId: string;
  toolName: string;
  delta: string;
}

export interface FunctionCallDoneEvent extends BaseAgentEvent {
  type: "function_call_done";
  toolCallId: string;
  toolName: string;
  arguments: string;
}

export interface CompactionStartEvent extends BaseAgentEvent {
  type: "compaction_start";
  reason: "pre_inference" | "overflow_recovery" | "manual";
  effectiveTokens: number;
  hardLimit: number;
}

export interface CompactionDoneEvent extends BaseAgentEvent {
  type: "compaction_done";
  reason: "pre_inference" | "overflow_recovery" | "manual";
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  strategy: string;
}

export interface ContextErrorEvent extends BaseAgentEvent {
  type: "context_error";
  error: string;
  effectiveTokens: number;
  hardLimit: number;
  recoveryAttempted: boolean;
}

export interface WorkingNarrationEvent extends BaseAgentEvent {
  type: "working_narration";
  eventType: WorkingNarrationEventType;
  message: string;
  evidenceIds: string[];
}

export interface SkillActivatedEvent extends BaseAgentEvent {
  type: "skill_activated";
  skillName: string;
  skillRevision: string;
  skillScope: string;
}

export interface SkillDeactivatedEvent extends BaseAgentEvent {
  type: "skill_deactivated";
  skillName: string;
  reason: string;
}

export type AgentEvent =
  | TurnStartEvent
  | ThinkingEvent
  | AssistantMessageEvent
  | AssistantMessageSupersededEvent
  | AssistantMessageStartEvent
  | AssistantTextDeltaEvent
  | AssistantReasoningDeltaEvent
  | AssistantTextDoneEvent
  | FunctionCallDeltaEvent
  | FunctionCallDoneEvent
  | ToolCallStartEvent
  | ToolCallResultEvent
  | ToolCallEndEvent
  | TurnEndEvent
  | TurnErrorEvent
  | LoopGuardEvent
  | BudgetUpdateEvent
  | DangerousConfirmationEvent
  | TurnStopReasonEvent
  | CompactionStartEvent
  | CompactionDoneEvent
  | ContextErrorEvent
  | WorkingNarrationEvent
  | SkillActivatedEvent
  | SkillDeactivatedEvent;

// ─── Turn Result ───

/**
 * Result of a single agent turn (one complete prompt→response→tools cycle).
 */
export interface AgentTurnResult {
  /** All items from this turn (user message + response output + tool outputs) */
  items: ItemParam[];
  /** The final response from the LLM */
  response: ResponseResource;
  /** Token usage for this turn */
  usage: Usage;
  /** Errors that occurred during the turn */
  errors: AgentTurnError[];
  /** Errors that remain unresolved at the end of the turn */
  activeErrors: AgentTurnError[];
  /** Compact runtime evidence summary for completion and debug use */
  evidenceSummary?: EvidenceLedgerSummary;
  /** Last checkpoint-derived work plan state for continuation/debug UI */
  checkpointState?: CheckpointWorkPlanState;
}

export interface CheckpointWorkPlanState {
  lastKind: "milestone" | "plan_pivot";
  reason: string;
  nextDirection?: string;
  completed: string[];
  pending: string[];
  updatedAt: string;
}

export interface AgentTurnError {
  id: string;
  type: "tool_error" | "api_error" | "timeout" | "cancelled" | "security_denial";
  status: "active" | "resolved" | "acknowledged";
  message: string;
  toolName?: string;
  toolCallId?: string;
  operationKey?: string;
  iteration?: number;
  resolvedByToolCallId?: string;
}

// ─── Agent Loop Options ───

export interface AgentLoopOptions {
  /** Emergency ceiling for model invocations per turn (0 = unlimited) */
  maxAgentIterations: number;
  /** Consecutive no-progress tool iterations before attempting recovery (0 = disabled) */
  maxStalledIterations: number;
  /** Number of strategy-change recovery attempts before stopping */
  maxStallRecoveryAttempts: number;
  /** Maximum wall-clock duration of one turn in milliseconds (0 = unlimited) */
  maxRunDurationMs: number;
  /** Maximum timeout any bash tool call may request, in seconds */
  bashMaxTimeoutSeconds: number;
  /** Token budget (0 = unlimited) */
  tokenBudget: number;
  /** Whether to emit events during execution */
  emitEvents: boolean;
  /** Whether to use streaming for LLM responses */
  stream: boolean;
  /** Maximum number of automatic continuations after output truncation */
  maxContinuationAttempts: number;
  /** Maximum text-only responses without a structural completion signal before stopping with an error */
  maxAutonomousFollowUps: number;
  /** Enable debug mode — writes loop decision entries to session JSONL */
  debug: boolean;
}

export const DEFAULT_LOOP_OPTIONS: AgentLoopOptions = {
  maxAgentIterations: 0,
  maxStalledIterations: 4,
  maxStallRecoveryAttempts: 2,
  maxRunDurationMs: 0,
  bashMaxTimeoutSeconds: 300,
  tokenBudget: 0,
  emitEvents: false,
  stream: false,
  maxContinuationAttempts: 3,
  maxAutonomousFollowUps: 3,
  debug: false,
};
