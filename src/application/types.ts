import type { ItemParam, ResponseResource, Usage } from "../kernel/model/openresponses-types";
import type { PermissionAlternative } from "../kernel/permissions/trust";
import type { AskUserArgs, ClarificationOutcome } from "../kernel/tools/ask-user";
import type { ToolResult } from "../kernel/tools/types";
import type { SessionInfo } from "../kernel/transcript/types";
import type { CommandResult, ListCommandsInput, RuntimeCommandMetadata } from "./command-service";

export type { CommandResult, ListCommandsInput, RuntimeCommandMetadata } from "./command-service";

export type RuntimeSource = "print" | "tui" | "acp";

export type RuntimeEventType =
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
  | "tool_call_output"
  | "tool_call_result"
  | "tool_call_end"
  | "turn_end"
  | "turn_error"
  | "loop_guard"
  | "budget_update"
  | "dangerous_confirmation"
  | "clarification_request"
  | "turn_stop_reason"
  | "compaction_start"
  | "compaction_done"
  | "context_error"
  | "working_narration"
  | "plan_update"
  | "skill_activated"
  | "skill_deactivated";

export interface BaseRuntimeEvent {
  type: RuntimeEventType;
  timestamp: number;
}

export interface RuntimeTurnStartEvent extends BaseRuntimeEvent {
  type: "turn_start";
  turnIndex: number;
  userInput: string;
}

export interface RuntimeThinkingEvent extends BaseRuntimeEvent {
  type: "thinking";
  active: boolean;
}

export interface RuntimeAssistantMessageEvent extends BaseRuntimeEvent {
  type: "assistant_message";
  messageId: string;
  text: string;
  reasoningContent?: string;
}

export interface RuntimeAssistantMessageSupersededEvent extends BaseRuntimeEvent {
  type: "assistant_message_superseded";
  messageId: string;
  reason: "autonomous_followup";
}

export interface RuntimeToolCallStartEvent extends BaseRuntimeEvent {
  type: "tool_call_start";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  userInitiated?: boolean;
  silent?: boolean;
}

export interface RuntimeToolCallOutputEvent extends BaseRuntimeEvent {
  type: "tool_call_output";
  toolCallId: string;
  toolName: string;
  chunk: string;
}

export interface RuntimeToolCallResultEvent extends BaseRuntimeEvent {
  type: "tool_call_result";
  toolCallId: string;
  toolName: string;
  result: ToolResult;
}

export interface RuntimeToolCallEndEvent extends BaseRuntimeEvent {
  type: "tool_call_end";
  toolCallId: string;
  toolName: string;
  durationMs: number;
}

export interface RuntimeTurnEndEvent extends BaseRuntimeEvent {
  type: "turn_end";
  turnIndex: number;
  response: ResponseResource;
  totalUsage: Usage;
}

export interface RuntimeTurnErrorEvent extends BaseRuntimeEvent {
  type: "turn_error";
  error: string;
  status?: string;
}

export interface RuntimeLoopGuardEvent extends BaseRuntimeEvent {
  type: "loop_guard";
  action: "recover" | "stop";
  iteration: number;
  message: string;
}

export interface RuntimeBudgetUpdateEvent extends BaseRuntimeEvent {
  type: "budget_update";
  usedTokens: number;
  totalBudget: number;
  contextWindow?: number;
  percentage: number;
  effectiveContextTokens?: number;
}

export type RuntimeApprovalDecision = "deny" | "once" | "session" | "repo" | "full";

export interface RuntimeDangerousConfirmationEvent extends BaseRuntimeEvent {
  type: "dangerous_confirmation";
  toolName: string;
  toolCallId: string;
  description: string;
  level: "dangerous";
  reason: string;
  alternatives?: PermissionAlternative[];
  resolve: (decision: RuntimeApprovalDecision) => void;
}

export interface RuntimeClarificationRequestEvent extends BaseRuntimeEvent {
  type: "clarification_request";
  request: AskUserArgs;
  claim(): void;
  resolve(outcome: ClarificationOutcome): void;
}

export interface RuntimeTurnStopReasonEvent extends BaseRuntimeEvent {
  type: "turn_stop_reason";
  turn: number;
  iteration: number;
  reason: "completed" | "loop-guard" | "api-error" | "aborted" | "budget-exceeded" | "continuation-exhausted" | "security-denial";
  detail: string;
  hasUsedTools: boolean;
  autonomousFollowUps: number;
}

export interface RuntimeAssistantMessageStartEvent extends BaseRuntimeEvent {
  type: "assistant_message_start";
  messageId: string;
}

export interface RuntimeAssistantTextDeltaEvent extends BaseRuntimeEvent {
  type: "assistant_text_delta";
  messageId: string;
  delta: string;
}

export interface RuntimeAssistantReasoningDeltaEvent extends BaseRuntimeEvent {
  type: "assistant_reasoning_delta";
  messageId: string;
  delta: string;
}

export interface RuntimeAssistantTextDoneEvent extends BaseRuntimeEvent {
  type: "assistant_text_done";
  messageId: string;
  fullText: string;
  reasoningContent?: string;
}

export interface RuntimeFunctionCallDeltaEvent extends BaseRuntimeEvent {
  type: "function_call_delta";
  toolCallId: string;
  toolName: string;
  delta: string;
}

export interface RuntimeFunctionCallDoneEvent extends BaseRuntimeEvent {
  type: "function_call_done";
  toolCallId: string;
  toolName: string;
  arguments: string;
}

export interface RuntimeCompactionStartEvent extends BaseRuntimeEvent {
  type: "compaction_start";
  reason: "pre_inference" | "overflow_recovery" | "manual";
  effectiveTokens: number;
  hardLimit: number;
}

export interface RuntimeCompactionDoneEvent extends BaseRuntimeEvent {
  type: "compaction_done";
  reason: "pre_inference" | "overflow_recovery" | "manual";
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  strategy: string;
}

export interface RuntimeContextErrorEvent extends BaseRuntimeEvent {
  type: "context_error";
  error: string;
  effectiveTokens: number;
  hardLimit: number;
  recoveryAttempted: boolean;
}

export type RuntimeWorkingNarrationEventType =
  | "acknowledgement"
  | "context_scan"
  | "observation"
  | "plan"
  | "edit_intent"
  | "verification"
  | "recovery"
  | "blocked"
  | "completion";

export interface RuntimeWorkingNarrationEvent extends BaseRuntimeEvent {
  type: "working_narration";
  eventType: RuntimeWorkingNarrationEventType;
  message: string;
  evidenceIds: string[];
}

export interface RuntimePlanUpdateEvent extends BaseRuntimeEvent {
  type: "plan_update";
  entries: Array<{
    content: string;
    priority: "high" | "medium" | "low";
    status: "pending" | "in_progress" | "completed";
  }>;
}

export interface RuntimeSkillActivatedEvent extends BaseRuntimeEvent {
  type: "skill_activated";
  skillName: string;
  skillRevision: string;
  skillScope: string;
}

export interface RuntimeSkillDeactivatedEvent extends BaseRuntimeEvent {
  type: "skill_deactivated";
  skillName: string;
  reason: string;
}

export type RuntimeEvent =
  | RuntimeTurnStartEvent
  | RuntimeThinkingEvent
  | RuntimeAssistantMessageEvent
  | RuntimeAssistantMessageSupersededEvent
  | RuntimeAssistantMessageStartEvent
  | RuntimeAssistantTextDeltaEvent
  | RuntimeAssistantReasoningDeltaEvent
  | RuntimeAssistantTextDoneEvent
  | RuntimeFunctionCallDeltaEvent
  | RuntimeFunctionCallDoneEvent
  | RuntimeToolCallStartEvent
  | RuntimeToolCallOutputEvent
  | RuntimeToolCallResultEvent
  | RuntimeToolCallEndEvent
  | RuntimeTurnEndEvent
  | RuntimeTurnErrorEvent
  | RuntimeLoopGuardEvent
  | RuntimeBudgetUpdateEvent
  | RuntimeDangerousConfirmationEvent
  | RuntimeClarificationRequestEvent
  | RuntimeTurnStopReasonEvent
  | RuntimeCompactionStartEvent
  | RuntimeCompactionDoneEvent
  | RuntimeContextErrorEvent
  | RuntimeWorkingNarrationEvent
  | RuntimePlanUpdateEvent
  | RuntimeSkillActivatedEvent
  | RuntimeSkillDeactivatedEvent;

export interface RuntimeTurnError {
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

export interface RuntimeCheckpointWorkPlanState {
  lastKind: "milestone" | "plan_pivot";
  reason: string;
  nextDirection?: string;
  completed: string[];
  pending: string[];
  updatedAt: string;
}

export interface TurnResult {
  items: ItemParam[];
  response: ResponseResource;
  usage: Usage;
  errors: RuntimeTurnError[];
  activeErrors: RuntimeTurnError[];
  evidenceSummary?: unknown;
  checkpointState?: RuntimeCheckpointWorkPlanState;
}

export type RuntimeContentBlock =
  | { type: "text"; text: string }
  | { type: "resource"; uri: string; text: string; mimeType?: string }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "audio"; mimeType: string; data: string };

export interface RuntimeCommandInput {
  name: string;
  args: string[];
}

export interface UserTurnInput {
  sessionId: string;
  content: RuntimeContentBlock[];
  source: RuntimeSource;
  command?: RuntimeCommandInput;
  /** Host advertises support for a structured clarification form in this turn. */
  clarificationAvailable?: boolean;
}

export type RuntimeEventListener = (event: RuntimeEvent) => void;
export type Unsubscribe = () => void;

export interface RuntimeCommandExecutionInput {
  command: string;
  source: RuntimeSource;
  emit: (event: RuntimeEvent) => void;
}

export type RuntimeCommandExecutor = (input: RuntimeCommandExecutionInput) => CommandResult | Promise<CommandResult>;

export interface CreateSessionInput {
  cwd: string;
  mcpServers?: unknown[];
  additionalDirectories?: string[];
}

export interface OpenSessionInput {
  cwd: string;
  sessionId: string;
}

export interface LoadSessionInput {
  sessionId: string;
  cwd?: string;
  mcpServers?: unknown[];
  additionalDirectories?: string[];
}

export interface ResumeSessionInput {
  sessionId: string;
  cwd?: string;
  mcpServers?: unknown[];
  additionalDirectories?: string[];
}

export interface ListSessionsInput {
  cwd: string;
  cursor?: string | null;
}

export interface SetSessionConfigInput {
  sessionId: string;
  key: string;
  value: unknown;
}

export interface SetSessionModeInput {
  sessionId: string;
  mode: string;
  enabled: boolean;
}

export type RuntimeSessionConfigOption = RuntimeSessionSelectConfigOption | RuntimeSessionBooleanConfigOption;

export interface RuntimeSessionSelectConfigOption {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  type: "select";
  currentValue: string;
  options: Array<{
    value: string;
    name: string;
    description?: string | null;
  }>;
}

export interface RuntimeSessionBooleanConfigOption {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  type: "boolean";
  currentValue: boolean;
}

export interface RuntimeSessionInfo {
  id: string;
  cwd: string;
  additionalDirectories?: string[];
  title?: string;
  updatedAt?: string;
  entries?: number;
}

export interface RuntimeSessionSnapshot {
  info: RuntimeSessionInfo;
  entries: unknown[];
}

export interface SobaRuntime {
  createSession(input: CreateSessionInput): Promise<RuntimeSessionInfo>;
  openSession(input: OpenSessionInput): Promise<RuntimeSessionInfo>;
  loadSession(input: LoadSessionInput): Promise<RuntimeSessionSnapshot>;
  resumeSession(input: ResumeSessionInput): Promise<RuntimeSessionInfo>;
  listSessions(input: ListSessionsInput): Promise<RuntimeSessionInfo[]>;
  listCommands(input?: ListCommandsInput): RuntimeCommandMetadata[];
  listSessionConfigOptions?(sessionId: string): Promise<RuntimeSessionConfigOption[]>;
  closeSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  setSessionConfig(input: SetSessionConfigInput): Promise<RuntimeSessionInfo>;
  setSessionMode(input: SetSessionModeInput): Promise<RuntimeSessionInfo>;
  runTurn(input: UserTurnInput): Promise<TurnResult>;
  cancelTurn(sessionId: string): void;
  onEvent(listener: RuntimeEventListener): Unsubscribe;
}

export function sessionInfoToRuntime(info: SessionInfo): RuntimeSessionInfo {
  return {
    id: info.id,
    cwd: info.cwd,
    updatedAt: info.timestamp,
    entries: info.entries,
  };
}

export function runtimeBlocksToText(blocks: RuntimeContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "resource") return `\n\n[Resource: ${block.uri}]\n${block.text}`;
      if (block.type === "resource_link") return `\n\n[Resource link: ${block.name}](${block.uri})`;
      if (block.type === "image") return `\n\n[Image: ${block.mimeType}]`;
      return `\n\n[Audio: ${block.mimeType}]`;
    })
    .join("")
    .trim();
}
