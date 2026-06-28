/**
 * Item serializer for compaction.
 *
 * Serializes OpenResponses ItemParam items to human-readable text
 * for use as compaction input. Tool outputs are truncated.
 */

import type { ItemParam } from "../../kernel/transcript/types";

// ─── Constants ───

/** Maximum characters per tool output in serialized form */
const MAX_TOOL_OUTPUT_CHARS = 2000;

// ─── Serialization ───

/**
 * Serialize a single item to a text line.
 */
export function serializeItemForCompaction(item: ItemParam): string {
  switch (item.type) {
    case "message": {
      const prefix = item.role === "user" ? "[User]" : item.role === "assistant" ? "[Assistant]" : `[${item.role}]`;
      if (Array.isArray(item.content)) {
        const text = item.content.map((b) => ("text" in b ? b.text : "[non-text content]")).join("\n");
        return `${prefix}: ${text}`;
      }
      return `${prefix}: ${String(item.content)}`;
    }

    case "function_call":
      return `[Tool: ${item.name}]: args=${item.arguments}`;

    case "function_call_output": {
      const output =
        typeof item.output === "string" ? item.output : item.output.map((b) => ("text" in b ? b.text : "")).join("\n");
      const truncated =
        output.length > MAX_TOOL_OUTPUT_CHARS ? `${output.slice(0, MAX_TOOL_OUTPUT_CHARS)}... [truncated]` : output;
      return `[Tool Result: ${item.call_id}]: ${truncated}`;
    }

    case "local_shell_call":
      return `[Shell: ${item.command}]`;

    case "local_shell_call_output": {
      const truncated =
        item.output.length > MAX_TOOL_OUTPUT_CHARS
          ? `${item.output.slice(0, MAX_TOOL_OUTPUT_CHARS)}... [truncated]`
          : item.output;
      return `[Shell Output]: ${truncated}`;
    }

    case "compaction":
      return `[Compaction Summary]: ${item.encrypted_content}`;

    default:
      return "[unknown]";
  }
}

/**
 * Serialize an array of items to a single text block for compaction.
 *
 * Each item is on its own line. Tool outputs exceeding MAX_TOOL_OUTPUT_CHARS
 * are truncated with a note.
 *
 * Example output:
 * ```
 * [User]: List all TypeScript files in the project
 * [Assistant]: I'll use bash to find them.
 * [Tool: bash]: args={"command":"find . -name '*.ts'"}
 * [Tool Result: bash]: ./src/index.ts
 * ./src/utils.ts
 * ...
 * ```
 */
export function serializeItemsForCompaction(items: ItemParam[]): string {
  return items.map((item) => serializeItemForCompaction(item)).join("\n");
}
