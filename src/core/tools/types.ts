/**
 * Core Tools types.
 *
 * Each tool is defined as a ToolDefinition with a name, JSON Schema parameters,
 * and an execute function that returns a ToolResult.
 */

import type { FunctionCallOutputItemParam, LocalShellCallOutputItemParam } from "../client/types";

// ─── Tool Definition ───

/**
 * JSON Schema for tool parameters (simplified subset).
 */
export interface JsonSchemaProperty {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Output content block from a tool.
 */
export interface ToolOutputContent {
  type: "text";
  text: string;
}

export type ToolErrorCategory =
  | "aborted"
  | "command"
  | "filesystem"
  | "permission"
  | "timeout"
  | "trust"
  | "validation"
  | "unknown";

export interface ToolErrorInfo {
  /** Stable machine-readable code, e.g. command_not_found or edit_old_text_not_found. */
  code: string;
  /** Broad class used by recovery policies and UI grouping. */
  category: ToolErrorCategory;
  /** Whether retrying the same call may reasonably succeed without changing inputs. */
  retryable: boolean;
  /** Short action-oriented hint for the next step. */
  nextAction: string;
  /** Stable fingerprint used by loop guards; excludes volatile paths/output snippets where possible. */
  fingerprint: string;
}

/**
 * Result returned by tool execute().
 */
export interface ToolResult {
  /** Content to return to the model */
  content: ToolOutputContent[];
  /** Whether this result indicates an error */
  isError: boolean;
  /** Machine-readable error metadata for recovery and loop guards. */
  error?: ToolErrorInfo;
  /** Optional details (for logging / UI) */
  details?: Record<string, unknown>;
}

/**
 * Context passed to tool execute().
 */
export interface ToolContext {
  /** Current working directory (project root) */
  cwd: string;
  /** Current runtime session id, when tool execution is scoped to a session */
  sessionId?: string;
  /** Session manager reference (for in-memory sessions) */
  session?: unknown;
  /** Maximum timeout any bash tool call may request, in seconds */
  bashMaxTimeoutSeconds?: number;
}

/**
 * A tool that can be registered in the ToolRegistry.
 */
export interface ToolDefinition<TArgs = Record<string, unknown>> {
  /** Unique tool name (matches the name in function_call items) */
  name: string;
  /** Human-readable label */
  label: string;
  /** Description for the LLM */
  description: string;
  /** JSON Schema for the tool parameters */
  parameters: JsonSchema;
  /** OpenResponses tool type */
  toolType: "function" | "local_shell";
  /** Execute the tool with given arguments */
  execute(args: TArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult>;
  /** Prepare/re-normalize arguments before validation (e.g., parse JSON strings) */
  prepareArgs?(raw: Record<string, unknown>): TArgs;
}

/**
 * Tool that accepts untyped args (used in registry).
 */
export type AnyToolDefinition = ToolDefinition<Record<string, unknown>>;

/**
 * Convert ToolResult to the appropriate OpenResponses output item.
 */
export function toolResultToOutputItem(
  toolResult: ToolResult,
  callId: string,
  toolName: string,
): FunctionCallOutputItemParam | LocalShellCallOutputItemParam {
  const output = toolResult.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  if (toolName === "bash") {
    return {
      type: "local_shell_call_output",
      call_id: callId,
      output,
    };
  }

  return {
    type: "function_call_output",
    call_id: callId,
    output,
  };
}

/**
 * Truncate text to the last N lines and/or max KB.
 * Returns truncated text and a note if truncation happened.
 */
export function truncateOutput(
  text: string,
  maxLines = 2000,
  maxBytes = 50 * 1024,
): { text: string; truncated: boolean; note?: string } {
  const lines = text.split("\n");

  // Truncate lines first
  let truncated = false;
  let resultLines = lines;
  if (lines.length > maxLines) {
    resultLines = lines.slice(-maxLines);
    truncated = true;
  }

  let result = resultLines.join("\n");

  // Then truncate bytes
  const buf = Buffer.from(result, "utf-8");
  if (buf.length > maxBytes) {
    const truncatedBuf = buf.subarray(0, maxBytes);
    result = new TextDecoder().decode(truncatedBuf);
    truncated = true;
  }

  const note = truncated
    ? `\n[Output truncated to ${resultLines.length} lines / ${(maxBytes / 1024).toFixed(0)}KB. Full output saved to temp file.]`
    : undefined;

  return { text: truncated ? result + (note ?? "") : result, truncated, note };
}
