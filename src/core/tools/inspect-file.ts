import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { classifyFileSystemError, createToolErrorResult, redactSecrets } from "./errors";
import type { ToolContext, ToolDefinition, ToolResult } from "./types";
import { truncateOutput } from "./types";

export interface InspectFileArgs {
  path: string;
  startLine?: number;
  endLine?: number;
  aroundLine?: number;
  contextLines?: number;
  maxLines?: number;
}

const DEFAULT_MAX_LINES = 120;
const MAX_LINES = 400;
const MAX_BYTES = 50 * 1024;

export const inspectFileTool: ToolDefinition<InspectFileArgs> = {
  name: "inspect_file",
  label: "inspect_file",
  description:
    "Inspect a stable, line-numbered range of a text file. Prefer this before edit/write when you need exact current context or readback evidence. Output is bounded and includes continuation hints.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path to inspect, relative or absolute.",
      },
      startLine: {
        type: "number",
        description: "1-indexed first line to include. Defaults to 1.",
      },
      endLine: {
        type: "number",
        description: "1-indexed last line to include.",
      },
      aroundLine: {
        type: "number",
        description: "Optional center line. When provided, start/end are computed from contextLines.",
      },
      contextLines: {
        type: "number",
        description: "Lines before and after aroundLine. Defaults to 20.",
      },
      maxLines: {
        type: "number",
        description: `Maximum lines to return. Defaults to ${DEFAULT_MAX_LINES}, capped at ${MAX_LINES}.`,
      },
    },
    required: ["path"],
  },
  toolType: "function",

  async execute(args: InspectFileArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) {
      return createToolErrorResult({
        code: "inspect_aborted",
        category: "aborted",
        message: "Operation aborted.",
        nextAction: "Retry with a narrower line range if the file is large.",
        fingerprint: "aborted:inspect_aborted",
      });
    }

    const absolutePath = resolve(context.cwd, args.path);
    try {
      await access(absolutePath, constants.R_OK);
    } catch (error) {
      const classification = classifyFileSystemError(error, "read");
      return createToolErrorResult({
        ...classification,
        message: `Cannot inspect file "${args.path}" — file does not exist or is not readable.`,
        fingerprint: `${classification.category}:${classification.code}:${args.path}`,
      });
    }

    try {
      const text = await readFile(absolutePath, "utf-8");
      const lines = text.split("\n");
      const maxLines = normalizeMaxLines(args.maxLines);
      const range = normalizeRange(args, lines.length, maxLines);
      if (range.status === "error") {
        return createToolErrorResult({
          code: "inspect_range_invalid",
          category: "validation",
          message: range.message,
          nextAction: "Choose a line range within the reported file length.",
          fingerprint: `validation:inspect_range_invalid:${args.path}`,
        });
      }

      const selected = lines.slice(range.startLine - 1, range.endLine);
      const lineNumberWidth = String(range.endLine).length;
      const body = selected
        .map((line, index) => {
          const lineNumber = String(range.startLine + index).padStart(lineNumberWidth, " ");
          return `${lineNumber} | ${redactSecrets(line)}`;
        })
        .join("\n");

      const notices: string[] = [];
      if (range.truncated) {
        notices.push(`Output truncated to ${maxLines} lines; continue with startLine=${range.endLine + 1}`);
      } else if (range.endLine < lines.length) {
        notices.push(`${lines.length - range.endLine} more line(s); continue with startLine=${range.endLine + 1}`);
      }

      const output = [`[inspect_file] ${args.path} lines ${range.startLine}-${range.endLine} of ${lines.length}`, body]
        .concat(notices.map((notice) => `[${notice}]`))
        .join("\n");
      const truncated = truncateOutput(output, maxLines + 5, MAX_BYTES);

      return {
        content: [{ type: "text", text: truncated.text }],
        isError: false,
        details: {
          path: absolutePath,
          totalLines: lines.length,
          startLine: range.startLine,
          endLine: range.endLine,
          truncated: range.truncated || truncated.truncated,
        },
      };
    } catch (error) {
      const classification = classifyFileSystemError(error, "read");
      return createToolErrorResult({
        ...classification,
        message: `Error inspecting file "${args.path}": ${error instanceof Error ? error.message : String(error)}`,
        fingerprint: `${classification.category}:${classification.code}:${args.path}`,
      });
    }
  },
};

function normalizeRange(
  args: InspectFileArgs,
  totalLines: number,
  maxLines: number,
):
  | { status: "ok"; startLine: number; endLine: number; truncated: boolean }
  | { status: "error"; message: string } {
  if (totalLines === 0) {
    return { status: "ok", startLine: 1, endLine: 1, truncated: false };
  }

  let startLine: number;
  let endLine: number;

  if (args.aroundLine !== undefined) {
    const aroundLine = Math.floor(args.aroundLine);
    const contextLines = normalizeContextLines(args.contextLines);
    startLine = Math.max(1, aroundLine - contextLines);
    endLine = Math.min(totalLines, aroundLine + contextLines);
  } else {
    startLine = args.startLine === undefined ? 1 : Math.floor(args.startLine);
    endLine = args.endLine === undefined ? startLine + maxLines - 1 : Math.floor(args.endLine);
  }

  if (startLine < 1 || startLine > totalLines) {
    return { status: "error", message: `startLine ${startLine} is outside file length (${totalLines} lines).` };
  }
  if (endLine < startLine) {
    return { status: "error", message: `endLine ${endLine} is before startLine ${startLine}.` };
  }

  const boundedEndLine = Math.min(endLine, totalLines, startLine + maxLines - 1);
  return {
    status: "ok",
    startLine,
    endLine: boundedEndLine,
    truncated: boundedEndLine < Math.min(endLine, totalLines),
  };
}

function normalizeMaxLines(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_LINES;
  return Math.max(1, Math.min(MAX_LINES, Math.floor(value)));
}

function normalizeContextLines(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 20;
  return Math.max(0, Math.min(100, Math.floor(value)));
}
