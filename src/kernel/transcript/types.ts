/**
 * Session types for SOBA Agent.
 *
 * Based on pi-agent session format, adapted for OpenResponses ItemParam model.
 * Sessions are append-only JSONL files with tree structure (id/parentId).
 */

// ─── OpenResponses ItemParam types (simplified for session storage) ───

export interface InputTextContent {
  type: "input_text";
  text: string;
}

export interface OutputTextContent {
  type: "output_text";
  text: string;
}

/**
 * A content block within a message item.
 * In phase 1 we only support text content.
 */
export type MessageContent = InputTextContent | OutputTextContent;

export interface UserMessageItemParam {
  type: "message";
  role: "user";
  content: MessageContent[];
  id?: string | null;
  status?: string | null;
}

export interface AssistantMessageItemParam {
  type: "message";
  role: "assistant";
  content: MessageContent[];
  id?: string | null;
  status?: string | null;
  phase?: "commentary" | "final_answer";
  reasoning_content?: string;
}

export interface SystemMessageItemParam {
  type: "message";
  role: "system";
  content: MessageContent[];
  id?: string | null;
  status?: string | null;
}

export interface FunctionCallItemParam {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
  id?: string | null;
  status?: string | null;
  reasoning_content?: string;
}

export interface FunctionCallOutputItemParam {
  type: "function_call_output";
  call_id: string;
  output: string | MessageContent[];
  id?: string | null;
  status?: string | null;
}

export interface LocalShellCallItemParam {
  type: "local_shell_call";
  call_id: string;
  command: string;
  id?: string | null;
  status?: string | null;
}

export interface LocalShellCallOutputItemParam {
  type: "local_shell_call_output";
  call_id: string;
  output: string;
  exit_code?: number;
  truncated?: boolean;
  id?: string | null;
  status?: string | null;
}

export interface CompactionSummaryItemParam {
  type: "compaction";
  encrypted_content: string;
  id?: string | null;
}

/**
 * Debug entry — loop decision metadata written to session when debug mode is enabled.
 * Not a conversation item; ignored by LLM input building.
 */
export interface DebugEntry {
  type: "debug";
  timestamp: string;
  data: {
    event:
      | "loop/turn-start"
      | "loop/iteration"
      | "loop/response"
      | "loop/auto-continue"
      | "loop/finish-rejected"
      | "loop/explicit-finish"
      | "loop/stop"
      | "loop/turn-end";
    turn: number;
    iteration?: number;
    /** Stop reason when event is "loop/stop" */
    reason?: "completed" | "loop-guard" | "api-error" | "aborted" | "budget-exceeded" | "continuation-exhausted" | "security-denial";
    detail?: string;
    responseId?: string;
    responseStatus?: string;
    toolCalls?: number;
    assistantMessages?: number;
    hasUsedTools?: boolean;
    needsVerification?: boolean;
    autonomousFollowUps?: number;
    autoContinue?: boolean;
    errors?: number;
    activeErrors?: number;
    assistantPhases?: Array<"commentary" | "final_answer" | null>;
    finishCalls?: number;
    /** First 100 chars of assistant text response */
    textPreview?: string;
  };
}

export type FlightRecordKind =
  | "prompt_snapshot"
  | "runtime_event"
  | "tool_call"
  | "tool_result"
  | "approval"
  | "diff_summary"
  | "evidence_bundle"
  | "completion_decision";

export interface FlightRecordData {
  version: 1;
  kind: FlightRecordKind;
  turn?: number;
  iteration?: number;
  payload: unknown;
}

/**
 * Flight recorder entry — redacted turn artifact persisted for manual inspection.
 * Not a conversation item; ignored by LLM input building.
 */
export interface FlightRecordEntry {
  type: "flight_record";
  timestamp: string;
  data: FlightRecordData;
}

/**
 * Union of all OpenResponses item types used in session entries.
 * Phase 1 covers: user_message, assistant_message, system_message,
 * function_call, function_call_output, local_shell_call,
 * local_shell_call_output, compaction_summary.
 */
export type ItemParam =
  | UserMessageItemParam
  | AssistantMessageItemParam
  | SystemMessageItemParam
  | FunctionCallItemParam
  | FunctionCallOutputItemParam
  | LocalShellCallItemParam
  | LocalShellCallOutputItemParam
  | CompactionSummaryItemParam;

// ─── Session File Format ───

/**
 * First line of every session file. Metadata, not part of the tree.
 */
export interface SessionHeader {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
}

/**
 * Base for all tree entries (id/parentId).
 */
export interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

/**
 * Wraps an OpenResponses ItemParam in the session tree.
 */
export interface SessionItemEntry extends SessionEntryBase {
  type: "item";
  item: ItemParam;
}

/**
 * Compaction checkpoint. References an OpenResponses compaction item
 * and marks where kept messages begin (firstKeptEntryId).
 */
export interface CompactionEntry extends SessionEntryBase {
  type: "compaction";
  responseId: string;
  compactionItem: CompactionSummaryItemParam;
  tokensBefore: number;
  firstKeptEntryId: string;
}

import type { ContextCapsuleEntry, SessionCursorEntry, SessionMigrationEntry, SkillActivationEntry } from "./types-v2";

/**
 * All tree entries (excludes SessionHeader and sidecars).
 */
export type SessionEntry = SessionItemEntry | CompactionEntry | ContextCapsuleEntry | SkillActivationEntry;

/**
 * All entries in the file (includes SessionHeader, DebugEntry, and v2 sidecars).
 * Debug entries, migration markers, and cursor entries are sidecar metadata, not part of the conversation tree.
 */
export type FileEntry = SessionHeader | SessionEntry | DebugEntry | FlightRecordEntry | SessionMigrationEntry | SessionCursorEntry;

// ─── Tree view ───

/** Summary info for listing sessions (used by -r). */
export interface SessionInfo {
  id: string;
  timestamp: string;
  cwd: string;
  entries: number;
  filePath: string;
}

/** Tree node for getTree() */
export interface SessionTreeNode {
  entry: SessionEntry;
  children: SessionTreeNode[];
}

// ─── buildInput result ───

/**
 * Assembled input for LLM: list of ItemParam items ready to send
 * as the `input` field in a CreateResponse request.
 */
export interface SessionInput {
  items: ItemParam[];
  /** ID of the previous response (for OpenResponses previous_response_id) */
  previousResponseId?: string;
}

// ─── Utility type guards ───

export function isUserMessageItem(item: ItemParam): item is UserMessageItemParam {
  return item.type === "message" && item.role === "user";
}

export function isAssistantMessageItem(item: ItemParam): item is AssistantMessageItemParam {
  return item.type === "message" && item.role === "assistant";
}
