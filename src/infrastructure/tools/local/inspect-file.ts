import { constants, createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { classifyFileSystemError, createToolErrorResult, redactSecrets } from "../../../kernel/tools/errors";
import type { ToolContext, ToolDefinition, ToolResult } from "../../../kernel/tools/types";
import { truncateOutput } from "../../../kernel/tools/types";

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
const EXACT_TOTAL_EXTRA_SCAN_LIMIT = 1000;

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
      return await inspectFileRange(absolutePath, args, signal);
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

async function inspectFileRange(
  absolutePath: string,
  args: InspectFileArgs,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const maxLines = normalizeMaxLines(args.maxLines);
  const requestedRange = normalizeRequestedRange(args, maxLines);
  if (requestedRange.status === "error") {
    return createToolErrorResult({
      code: "inspect_range_invalid",
      category: "validation",
      message: requestedRange.message,
      nextAction: "Choose a line range within the reported file length.",
      fingerprint: `validation:inspect_range_invalid:${args.path}`,
    });
  }

  const selected: string[] = [];
  let lineNumber = 0;
  let stoppedEarly = false;
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
      if (lineNumber < requestedRange.startLine) continue;
      if (lineNumber <= requestedRange.endLine) {
        selected.push(line);
        continue;
      }
      if (lineNumber - requestedRange.endLine > EXACT_TOTAL_EXTRA_SCAN_LIMIT) {
        stoppedEarly = true;
        break;
      }
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
      code: "inspect_aborted",
      category: "aborted",
      message: "Operation aborted.",
      nextAction: "Retry with a narrower line range if the file is large.",
      fingerprint: "aborted:inspect_aborted",
    });
  }

  if (lineNumber === 0 && requestedRange.startLine === 1) {
    selected.push("");
    lineNumber = 1;
  }

  if (selected.length === 0) {
    return createToolErrorResult({
      code: "inspect_range_invalid",
      category: "validation",
      message: `startLine ${requestedRange.startLine} is outside file length (${lineNumber} lines).`,
      nextAction: "Choose a line range within the reported file length.",
      fingerprint: `validation:inspect_range_invalid:${args.path}`,
    });
  }

  const actualEndLine = requestedRange.startLine + selected.length - 1;
  const lineNumberWidth = String(actualEndLine).length;
  const body = selected
    .map((line, index) => {
      const currentLine = requestedRange.startLine + index;
      return `${String(currentLine).padStart(lineNumberWidth, " ")} | ${redactSecrets(line)}`;
    })
    .join("\n");
  const totalLabel = stoppedEarly ? `at least ${lineNumber}` : String(lineNumber);
  const notices: string[] = [];
  if (requestedRange.truncatedByMaxLines) {
    notices.push(`Output truncated to ${maxLines} lines; continue with startLine=${actualEndLine + 1}`);
  } else if (stoppedEarly) {
    notices.push(`More line(s) remain; continue with startLine=${actualEndLine + 1}`);
  } else if (actualEndLine < lineNumber) {
    notices.push(`${lineNumber - actualEndLine} more line(s); continue with startLine=${actualEndLine + 1}`);
  }

  const output = [
    `[inspect_file] ${args.path} lines ${requestedRange.startLine}-${actualEndLine} of ${totalLabel}`,
    body,
  ]
    .concat(notices.map((notice) => `[${notice}]`))
    .join("\n");
  const truncated = truncateOutput(output, maxLines + 5, MAX_BYTES);

  return {
    content: [{ type: "text", text: truncated.text }],
    isError: false,
    details: {
      path: absolutePath,
      totalLines: stoppedEarly ? undefined : lineNumber,
      startLine: requestedRange.startLine,
      endLine: actualEndLine,
      truncated: requestedRange.truncatedByMaxLines || stoppedEarly || truncated.truncated,
    },
  };
}

function normalizeRequestedRange(
  args: InspectFileArgs,
  maxLines: number,
): { status: "ok"; startLine: number; endLine: number; truncatedByMaxLines: boolean } | { status: "error"; message: string } {
  let startLine: number;
  let endLine: number;

  if (args.aroundLine !== undefined) {
    const aroundLine = Math.floor(args.aroundLine);
    const contextLines = normalizeContextLines(args.contextLines);
    startLine = Math.max(1, aroundLine - contextLines);
    endLine = aroundLine + contextLines;
  } else {
    startLine = args.startLine === undefined ? 1 : Math.floor(args.startLine);
    endLine = args.endLine === undefined ? startLine + maxLines - 1 : Math.floor(args.endLine);
  }

  if (startLine < 1) {
    return { status: "error", message: `startLine ${startLine} is outside file length.` };
  }
  if (endLine < startLine) {
    return { status: "error", message: `endLine ${endLine} is before startLine ${startLine}.` };
  }

  const boundedEndLine = Math.min(endLine, startLine + maxLines - 1);
  return {
    status: "ok",
    startLine,
    endLine: boundedEndLine,
    truncatedByMaxLines: boundedEndLine < endLine,
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
