/**
 * ls tool.
 *
 * Lists directory contents sorted alphabetically with '/' suffix for directories.
 * Provides a structured, consistent output that is more efficient than raw bash.
 */

import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { classifyFileSystemError, createToolErrorResult } from "./errors";
import type { ToolContext, ToolDefinition, ToolResult } from "./types";
import { truncateOutput } from "./types";

// ─── Types ───

export interface LsArgs {
  path?: string;
  limit?: number;
}

// ─── Constants ───

const DEFAULT_LIMIT = 200;
const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024; // 50KB

// ─── Tool Definition ───

export const lsTool: ToolDefinition<LsArgs> = {
  name: "ls",
  label: "ls",
  description:
    "List directory contents for path discovery and directory shape. Not a content search tool; use search_files for text, regex, or symbol matches. Returns entries sorted alphabetically with '/' suffix for directories. Includes dotfiles. Output is truncated to the specified limit (default 200) or 50KB.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory to list (default: current directory)",
      },
      limit: {
        type: "number",
        description: "Maximum number of entries to return (default: 200)",
      },
    },
  },
  toolType: "function",

  async execute(args: LsArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
    const dirPath = resolve(context.cwd, args.path ?? ".");
    const limit = args.limit ?? DEFAULT_LIMIT;

    if (signal?.aborted) {
      return createToolErrorResult({
        code: "list_aborted",
        category: "aborted",
        message: "Operation aborted.",
        nextAction: "Do not retry automatically; narrow the directory listing or ask before restarting.",
        fingerprint: "aborted:list_aborted",
      });
    }

    try {
      let entries: Dirent[];
      try {
        entries = await readdir(dirPath, { withFileTypes: true });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const classification = classifyFileSystemError(error, "list");
        return createToolErrorResult({
          ...classification,
          message: `Error reading directory: ${msg}`,
          fingerprint: `${classification.category}:${classification.code}:${args.path ?? "."}`,
        });
      }

      // Sort alphabetically, case-insensitive
      entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

      // Format with directory indicators
      const results: string[] = [];
      let entryLimitReached = false;

      for (const entry of entries) {
        if (results.length >= limit) {
          entryLimitReached = true;
          break;
        }

        if (signal?.aborted) {
          return createToolErrorResult({
            code: "list_aborted",
            category: "aborted",
            message: "Operation aborted.",
            nextAction: "Do not retry automatically; narrow the directory listing or ask before restarting.",
            fingerprint: "aborted:list_aborted",
          });
        }

        try {
          if (entry.isDirectory()) {
            results.push(`${entry.name}/`);
            continue;
          }
          if (entry.isSymbolicLink()) {
            const fullPath = resolve(dirPath, entry.name);
            const entryStat = await stat(fullPath);
            results.push(entryStat.isDirectory() ? `${entry.name}/` : entry.name);
            continue;
          }
          results.push(entry.name);
        } catch {
          // Skip entries we cannot stat (permission denied, broken symlinks, etc.)
          results.push(entry.name);
        }
      }

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "(empty directory)" }],
          isError: false,
          details: { path: dirPath, entryCount: 0 },
        };
      }

      const rawOutput = results.join("\n");

      // Apply truncation
      const truncated = truncateOutput(rawOutput, MAX_LINES, MAX_BYTES);

      let outputText = truncated.text;

      const notices: string[] = [];
      if (entryLimitReached) {
        notices.push(`${limit} entries limit reached`);
      }
      if (truncated.truncated) {
        notices.push(`${MAX_BYTES / 1024}KB limit reached`);
      }
      if (notices.length > 0) {
        outputText += `\n\n[${notices.join(". ")}]`;
      }

      return {
        content: [{ type: "text", text: outputText }],
        isError: false,
        details: {
          path: dirPath,
          entryCount: results.length,
          truncated: truncated.truncated,
        },
      };
    } catch (error) {
      const classification = classifyFileSystemError(error, "list");
      return createToolErrorResult({
        ...classification,
        message: `Error listing directory: ${error instanceof Error ? error.message : String(error)}`,
        fingerprint: `${classification.category}:${classification.code}:${args.path ?? "."}`,
      });
    }
  },
};
