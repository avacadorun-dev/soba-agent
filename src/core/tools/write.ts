/**
 * Write tool.
 *
 * Creates or overwrites a file. Auto-creates parent directories.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { classifyFileSystemError, createToolErrorResult } from "./errors";
import { isProjectMemoryPath, PROJECT_MEMORY_DIRECT_WRITE_NEXT_ACTION } from "./protected-paths";
import type { ToolContext, ToolDefinition, ToolResult } from "./types";

// ─── Types ───

export interface WriteArgs {
  path: string;
  content: string;
}

function validateWriteArgs(args: WriteArgs): ToolResult | null {
  const raw = args as unknown as Record<string, unknown>;
  const invalidFields: string[] = [];

  if (typeof raw.path !== "string" || raw.path.length === 0) {
    invalidFields.push("path");
  }
  if (typeof raw.content !== "string") {
    invalidFields.push("content");
  }

  if (invalidFields.length === 0) return null;

  return createToolErrorResult({
    code: "write_invalid_arguments",
    category: "validation",
    message: `Invalid write arguments: ${invalidFields.join(", ")} must be provided as ${invalidFields.length === 1 ? "a string" : "strings"}.`,
    nextAction: 'This is an invalid tool call, not a tool failure. Retry only with arguments shaped exactly like {"path":"relative/file.txt","content":"..."}; do not retry unchanged.',
    fingerprint: `validation:write_invalid_arguments:${invalidFields.join(",")}`,
  });
}

// ─── Tool Definition ───

export const writeTool: ToolDefinition<WriteArgs> = {
  name: "write",
  label: "write",
  description:
    "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to write (relative or absolute)",
      },
      content: {
        type: "string",
        description: "Content to write to the file",
      },
    },
    required: ["path", "content"],
  },
  toolType: "function",

  async execute(args: WriteArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
    const validationError = validateWriteArgs(args);
    if (validationError) return validationError;

    const absolutePath = resolve(context.cwd, args.path);
    if (isProjectMemoryPath(context.cwd, args.path)) {
      return createToolErrorResult({
        code: "project_memory_direct_write_denied",
        category: "validation",
        message: `Direct writes to project memory store files are not allowed: ${args.path}`,
        nextAction: PROJECT_MEMORY_DIRECT_WRITE_NEXT_ACTION,
        fingerprint: "validation:project_memory_direct_write_denied",
      });
    }

    if (signal?.aborted) {
      return createToolErrorResult({
        code: "write_aborted",
        category: "aborted",
        message: "Operation aborted.",
        nextAction: "Do not retry automatically; inspect the target path before writing again.",
        fingerprint: "aborted:write_aborted",
      });
    }

    try {
      const oldText = await readFile(absolutePath, "utf-8").catch((error: unknown) => {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
        throw error;
      });

      // Ensure parent directory exists
      const dir = dirname(absolutePath);
      await mkdir(dir, { recursive: true });

      // Write file
      await writeFile(absolutePath, args.content, "utf-8");

      const size = Buffer.byteLength(args.content, "utf-8");
      const lines = args.content.split("\n").length;

      return {
        content: [
          {
            type: "text",
            text: `Successfully wrote ${args.path} (${size} bytes, ${lines} lines).`,
          },
        ],
        isError: false,
        details: {
          path: absolutePath,
          bytes: size,
          lines,
          oldText,
          newText: args.content,
        },
      };
    } catch (error) {
      const classification = classifyFileSystemError(error, "write");
      return createToolErrorResult({
        ...classification,
        message: `Error writing file "${args.path}": ${error instanceof Error ? error.message : String(error)}`,
        fingerprint: `${classification.category}:${classification.code}:${args.path}`,
      });
    }
  },
};
