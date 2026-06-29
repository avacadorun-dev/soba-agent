/**
 * Read tool.
 *
 * Reads file contents (text and images). Supports offset/limit for large files.
 * Limits: 2000 lines / 50KB per read.
 */

import { constants, createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import { classifyFileSystemError, createToolErrorResult, redactSecrets } from "../../../kernel/tools/errors";
import type { ToolContext, ToolDefinition, ToolResult } from "../../../kernel/tools/types";
import { truncateOutput } from "../../../kernel/tools/types";

// ─── Types ───

export interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

// ─── Image detection ───

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);

function isImagePath(filePath: string): boolean {
  const ext = basename(filePath).toLowerCase();
  for (const imgExt of IMAGE_EXTENSIONS) {
    if (ext.endsWith(imgExt)) return true;
  }
  return false;
}

// ─── Constants ───

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024; // 50KB

// ─── Tool Definition ───

export const readTool: ToolDefinition<ReadArgs> = {
  name: "read",
  label: "read",
  description:
    "Read a whole file or image. Supports text files and images (png, jpg, gif, webp). Prefer inspect_file for exact line-numbered text ranges before edit/write. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to read (relative or absolute)",
      },
      offset: {
        type: "number",
        description: "Line number to start reading from (1-indexed)",
      },
      limit: {
        type: "number",
        description: "Maximum number of lines to read",
      },
    },
    required: ["path"],
  },
  toolType: "function",

  async execute(args: ReadArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
    const absolutePath = resolve(context.cwd, args.path);

    try {
      // Check if file exists and is readable
      await access(absolutePath, constants.R_OK);
    } catch (error) {
      const classification = classifyFileSystemError(error, "read");
      return createToolErrorResult({
        ...classification,
        message: `Cannot read file "${args.path}" — file does not exist or is not readable.`,
        fingerprint: `${classification.category}:${classification.code}:${args.path}`,
      });
    }

    if (signal?.aborted) {
      return createToolErrorResult({
        code: "read_aborted",
        category: "aborted",
        message: "Operation aborted.",
        nextAction: "Do not retry automatically; narrow the read or ask before restarting.",
        fingerprint: "aborted:read_aborted",
      });
    }

    // Handle images
    if (isImagePath(absolutePath)) {
      try {
        const buffer = await readFile(absolutePath);
        const mimeType = `image/${basename(absolutePath).split(".").pop()?.replace("jpg", "jpeg") ?? "png"}`;
        const base64 = buffer.toString("base64");

        return {
          content: [
            {
              type: "text",
              text: `Read image file [${mimeType}] (${buffer.length} bytes)`,
            },
          ],
          isError: false,
          details: {
            path: absolutePath,
            image: { data: base64, mimeType },
          },
        };
      } catch (error) {
        const classification = classifyFileSystemError(error, "read");
        return createToolErrorResult({
          ...classification,
          message: `Error reading image: ${error instanceof Error ? error.message : String(error)}`,
          fingerprint: `${classification.category}:${classification.code}:${args.path}`,
        });
      }
    }

    if (args.limit !== undefined) {
      return readLimitedTextRange(absolutePath, args, signal);
    }

    // Read text content
    try {
      const buffer = await readFile(absolutePath);
      const textContent = buffer.toString("utf-8");
      const allLines = textContent.split("\n");
      const totalLines = allLines.length;

      // Apply offset (1-indexed → 0-indexed)
      const startLine = args.offset ? Math.max(0, args.offset - 1) : 0;

      if (startLine >= allLines.length) {
        return createToolErrorResult({
          code: "read_offset_out_of_range",
          category: "validation",
          message: `Offset ${args.offset} is beyond end of file (${allLines.length} lines total).`,
          nextAction: "Retry with an offset within the reported line count or read the file from the start.",
          fingerprint: `validation:read_offset_out_of_range:${args.path}`,
        });
      }

      let selectedContent: string;
      let selectedLineCount: number;

      if (args.limit !== undefined) {
        const endLine = Math.min(startLine + args.limit, allLines.length);
        selectedContent = allLines.slice(startLine, endLine).join("\n");
        selectedLineCount = endLine - startLine;
      } else {
        selectedContent = allLines.slice(startLine).join("\n");
        selectedLineCount = allLines.length - startLine;
      }

      // Apply truncation
      const truncated = truncateOutput(selectedContent, MAX_LINES, MAX_BYTES);

      // Build useful continuation note
      let outputText = truncated.text;
      const startDisplay = startLine + 1;
      const endDisplay = startDisplay + selectedLineCount - 1;

      if (truncated.truncated) {
        outputText += `\n\n[Showing lines ${startDisplay}-${endDisplay} of ${totalLines}. Use offset=${endDisplay + 1} to continue.]`;
      } else if (args.limit !== undefined && startLine + args.limit < allLines.length) {
        const nextOffset = startLine + args.limit + 1;
        outputText += `\n\n[${allLines.length - (startLine + args.limit)} more lines in file. Use offset=${nextOffset} to continue.]`;
      }

      return {
        content: [{ type: "text", text: redactSecrets(outputText) }],
        isError: false,
        details: {
          path: absolutePath,
          totalLines,
          readLines: selectedLineCount,
          startLine: startDisplay,
          endLine: endDisplay,
          truncated: truncated.truncated,
        },
      };
    } catch (error) {
      const classification = classifyFileSystemError(error, "read");
      return createToolErrorResult({
        ...classification,
        message: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        fingerprint: `${classification.category}:${classification.code}:${args.path}`,
      });
    }
  },
};

async function readLimitedTextRange(
  absolutePath: string,
  args: ReadArgs,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const requestedLimit = normalizeLimit(args.limit);
  if (requestedLimit.status === "error") {
    return createToolErrorResult({
      code: "read_invalid_limit",
      category: "validation",
      message: requestedLimit.message,
      nextAction: "Retry with a positive integer line limit.",
      fingerprint: `validation:read_invalid_limit:${args.path}`,
    });
  }

  const startLine = args.offset ? Math.max(1, Math.floor(args.offset)) : 1;
  const endLine = startLine + requestedLimit.value - 1;
  const selected: string[] = [];
  let lineNumber = 0;
  let hasMore = false;
  let aborted = false;
  const stream = createReadStream(absolutePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const abort = () => {
    aborted = true;
    rl.close();
    stream.destroy();
  };
  signal?.addEventListener("abort", abort, { once: true });

  try {
    for await (const line of rl) {
      lineNumber += 1;
      if (lineNumber < startLine) continue;
      if (lineNumber <= endLine) {
        selected.push(line);
        continue;
      }
      hasMore = true;
      break;
    }
  } catch (error) {
    if (!aborted) throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    rl.close();
    stream.destroy();
  }

  if (aborted || signal?.aborted) {
    return createToolErrorResult({
      code: "read_aborted",
      category: "aborted",
      message: "Operation aborted.",
      nextAction: "Do not retry automatically; narrow the read or ask before restarting.",
      fingerprint: "aborted:read_aborted",
    });
  }

  if (selected.length === 0 && startLine > Math.max(1, lineNumber)) {
    return createToolErrorResult({
      code: "read_offset_out_of_range",
      category: "validation",
      message: `Offset ${args.offset} is beyond end of file (${Math.max(1, lineNumber)} lines total).`,
      nextAction: "Retry with an offset within the reported line count or read the file from the start.",
      fingerprint: `validation:read_offset_out_of_range:${args.path}`,
    });
  }

  const selectedContent = selected.join("\n");
  const truncated = truncateOutput(selectedContent, MAX_LINES, MAX_BYTES);
  let outputText = truncated.text;
  const startDisplay = startLine;
  const endDisplay = startLine + selected.length - 1;

  if (truncated.truncated) {
    outputText += `\n\n[Showing lines ${startDisplay}-${endDisplay}. Use offset=${endDisplay + 1} to continue.]`;
  } else if (hasMore) {
    outputText += `\n\n[More lines in file. Use offset=${endDisplay + 1} to continue.]`;
  }

  return {
    content: [{ type: "text", text: redactSecrets(outputText) }],
    isError: false,
    details: {
      path: absolutePath,
      totalLines: hasMore ? undefined : Math.max(1, lineNumber),
      readLines: selected.length,
      startLine: startDisplay,
      endLine: endDisplay,
      truncated: truncated.truncated || hasMore,
    },
  };
}

function normalizeLimit(limit: number | undefined): { status: "ok"; value: number } | { status: "error"; message: string } {
  if (limit === undefined || !Number.isFinite(limit)) {
    return { status: "error", message: "limit must be a finite number." };
  }
  const normalized = Math.floor(limit);
  if (normalized < 1) {
    return { status: "error", message: "limit must be greater than zero." };
  }
  return { status: "ok", value: normalized };
}
