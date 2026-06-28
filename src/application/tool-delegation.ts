import { Buffer } from "node:buffer";
import { type BashArgs, bashTool } from "../infrastructure/tools/local/bash";
import { type InspectFileArgs, inspectFileTool } from "../infrastructure/tools/local/inspect-file";
import { type LsArgs, lsTool } from "../infrastructure/tools/local/ls";
import { isProjectMemoryPath, PROJECT_MEMORY_DIRECT_WRITE_NEXT_ACTION } from "../infrastructure/tools/local/protected-paths";
import { type ReadArgs, readTool } from "../infrastructure/tools/local/read";
import { type SearchFilesArgs, searchFilesTool } from "../infrastructure/tools/local/search-files";
import { type WriteArgs, writeTool } from "../infrastructure/tools/local/write";
import { createToolErrorResult, redactSecrets } from "../kernel/tools/errors";
import type { ToolContext, ToolDefinition, ToolResult } from "../kernel/tools/types";
import { truncateOutput } from "../kernel/tools/types";

const READ_MAX_LINES = 2000;
const READ_MAX_BYTES = 50 * 1024;

export interface DelegatedReadTextFileInput {
  cwd: string;
  sessionId?: string;
  path: string;
  signal?: AbortSignal;
}

export interface DelegatedWriteTextFileInput {
  cwd: string;
  sessionId?: string;
  path: string;
  content: string;
  signal?: AbortSignal;
}

export interface DelegatedTerminalInput {
  cwd: string;
  sessionId?: string;
  command: string;
  timeout?: number;
  signal?: AbortSignal;
}

export interface DelegatedListDirectoryInput {
  cwd: string;
  sessionId?: string;
  path?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface DelegatedInspectTextFileInput extends InspectFileArgs {
  cwd: string;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface DelegatedSearchFilesInput extends SearchFilesArgs {
  cwd: string;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface DelegatedTerminalResult {
  stdout?: string;
  stderr?: string;
  output?: string;
  exitCode?: number | null;
  signalCode?: string | null;
  timedOut?: boolean;
  terminalId?: string;
}

export interface RuntimeToolDelegation {
  readTextFile?(input: DelegatedReadTextFileInput): Promise<string | { text: string } | undefined>;
  writeTextFile?(input: DelegatedWriteTextFileInput): Promise<{ bytes?: number; lines?: number } | undefined>;
  runTerminal?(input: DelegatedTerminalInput): Promise<DelegatedTerminalResult | undefined>;
  listDirectory?(input: DelegatedListDirectoryInput): Promise<string | { text?: string; entries?: string[]; entryCount?: number; truncated?: boolean } | undefined>;
  inspectTextFile?(input: DelegatedInspectTextFileInput): Promise<string | { text: string; totalLines?: number; startLine?: number; endLine?: number; truncated?: boolean } | undefined>;
  searchFiles?(input: DelegatedSearchFilesInput): Promise<string | { text: string; matchCount?: number; truncated?: boolean } | undefined>;
}

export function createDelegatedReadTool(delegation: RuntimeToolDelegation): ToolDefinition<ReadArgs> {
  return {
    ...readTool,
    async execute(args: ReadArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
      const delegated = await delegation.readTextFile?.({ cwd: context.cwd, sessionId: context.sessionId, path: args.path, signal });
      if (!delegated) return readTool.execute(args, context, signal);

      const text = typeof delegated === "string" ? delegated : delegated.text;
      return formatDelegatedReadResult(args, text);
    },
  };
}

export function createDelegatedWriteTool(delegation: RuntimeToolDelegation): ToolDefinition<WriteArgs> {
  return {
    ...writeTool,
    async execute(args: WriteArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
      const validationError = validateWriteArgs(args);
      if (validationError) return validationError;
      if (isProjectMemoryPath(context.cwd, args.path)) {
        return createToolErrorResult({
          code: "project_memory_direct_write_denied",
          category: "validation",
          message: `Direct writes to project memory store files are not allowed: ${args.path}`,
          nextAction: PROJECT_MEMORY_DIRECT_WRITE_NEXT_ACTION,
          fingerprint: "validation:project_memory_direct_write_denied",
        });
      }

      const delegated = await delegation.writeTextFile?.({ cwd: context.cwd, sessionId: context.sessionId, path: args.path, content: args.content, signal });
      if (!delegated) return writeTool.execute(args, context, signal);

      const bytes = delegated.bytes ?? Buffer.byteLength(args.content, "utf-8");
      const lines = delegated.lines ?? args.content.split("\n").length;
      return {
        content: [{ type: "text", text: `Successfully wrote ${args.path} (${bytes} bytes, ${lines} lines).` }],
        isError: false,
        details: { path: args.path, bytes, lines, delegated: true },
      };
    },
  };
}

export function createDelegatedBashTool(delegation: RuntimeToolDelegation): ToolDefinition<BashArgs> {
  return {
    ...bashTool,
    async execute(args: BashArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
      const delegated = await delegation.runTerminal?.({
        cwd: context.cwd,
        sessionId: context.sessionId,
        command: args.command,
        timeout: args.timeout,
        signal,
      });
      if (!delegated) return bashTool.execute(args, context, signal);

      return formatDelegatedTerminalResult(args, delegated);
    },
  };
}

export function createDelegatedLsTool(delegation: RuntimeToolDelegation): ToolDefinition<LsArgs> {
  return {
    ...lsTool,
    async execute(args: LsArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
      const delegated = await delegation.listDirectory?.({
        cwd: context.cwd,
        sessionId: context.sessionId,
        path: args.path,
        limit: args.limit,
        signal,
      });
      if (!delegated) return lsTool.execute(args, context, signal);
      return formatDelegatedListResult(args, delegated);
    },
  };
}

export function createDelegatedInspectFileTool(delegation: RuntimeToolDelegation): ToolDefinition<InspectFileArgs> {
  return {
    ...inspectFileTool,
    async execute(args: InspectFileArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
      const delegated = await delegation.inspectTextFile?.({
        ...args,
        cwd: context.cwd,
        sessionId: context.sessionId,
        signal,
      });
      if (!delegated) return inspectFileTool.execute(args, context, signal);
      return formatDelegatedInspectResult(args, delegated);
    },
  };
}

export function createDelegatedSearchFilesTool(delegation: RuntimeToolDelegation): ToolDefinition<SearchFilesArgs> {
  return {
    ...searchFilesTool,
    async execute(args: SearchFilesArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
      const delegated = await delegation.searchFiles?.({
        ...args,
        cwd: context.cwd,
        sessionId: context.sessionId,
        signal,
      });
      if (!delegated) return searchFilesTool.execute(args, context, signal);
      return formatDelegatedSearchResult(args, delegated);
    },
  };
}

function validateWriteArgs(args: WriteArgs): ToolResult | null {
  const raw = args as unknown as Record<string, unknown>;
  const invalidFields: string[] = [];
  if (typeof raw.path !== "string" || raw.path.length === 0) invalidFields.push("path");
  if (typeof raw.content !== "string") invalidFields.push("content");
  if (invalidFields.length === 0) return null;

  return createToolErrorResult({
    code: "write_invalid_arguments",
    category: "validation",
    message: `Invalid write arguments: ${invalidFields.join(", ")} must be provided as ${invalidFields.length === 1 ? "a string" : "strings"}.`,
    nextAction: 'This is an invalid tool call, not a tool failure. Retry only with arguments shaped exactly like {"path":"relative/file.txt","content":"..."}; do not retry unchanged.',
    fingerprint: `validation:write_invalid_arguments:${invalidFields.join(",")}`,
  });
}

function formatDelegatedReadResult(args: ReadArgs, text: string): ToolResult {
  const allLines = text.split("\n");
  const totalLines = allLines.length;
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

  const endLine = args.limit === undefined ? allLines.length : Math.min(startLine + args.limit, allLines.length);
  const selectedContent = allLines.slice(startLine, endLine).join("\n");
  const selectedLineCount = endLine - startLine;
  const truncated = truncateOutput(selectedContent, READ_MAX_LINES, READ_MAX_BYTES);
  let outputText = truncated.text;
  const startDisplay = startLine + 1;
  const endDisplay = startDisplay + selectedLineCount - 1;
  if (truncated.truncated) {
    outputText += `\n\n[Showing lines ${startDisplay}-${endDisplay} of ${totalLines}. Use offset=${endDisplay + 1} to continue.]`;
  } else if (args.limit !== undefined && startLine + args.limit < allLines.length) {
    outputText += `\n\n[${allLines.length - (startLine + args.limit)} more lines in file. Use offset=${startLine + args.limit + 1} to continue.]`;
  }

  return {
    content: [{ type: "text", text: redactSecrets(outputText) }],
    isError: false,
    details: {
      path: args.path,
      totalLines,
      readLines: selectedLineCount,
      truncated: truncated.truncated,
      delegated: true,
    },
  };
}

function formatDelegatedTerminalResult(args: BashArgs, result: DelegatedTerminalResult): ToolResult {
  const output = result.output ?? [result.stdout, result.stderr].filter(Boolean).join("\n");
  const exitCode = result.exitCode ?? 0;
  const isError = result.timedOut === true || exitCode !== 0;
  return {
    content: [{ type: "text", text: redactSecrets(output) }],
    isError,
    details: {
      command: args.command,
      terminalId: result.terminalId,
      exitCode,
      signalCode: result.signalCode ?? null,
      timedOut: result.timedOut ?? false,
      delegated: true,
    },
  };
}

function formatDelegatedListResult(
  args: LsArgs,
  result: string | { text?: string; entries?: string[]; entryCount?: number; truncated?: boolean },
): ToolResult {
  const text = typeof result === "string" ? result : result.text ?? result.entries?.join("\n") ?? "";
  return {
    content: [{ type: "text", text: redactSecrets(text || "(empty directory)") }],
    isError: false,
    details: {
      path: args.path ?? ".",
      entryCount: typeof result === "string" ? undefined : result.entryCount ?? result.entries?.length,
      truncated: typeof result === "string" ? undefined : result.truncated,
      delegated: true,
    },
  };
}

function formatDelegatedInspectResult(
  args: InspectFileArgs,
  result: string | { text: string; totalLines?: number; startLine?: number; endLine?: number; truncated?: boolean },
): ToolResult {
  const text = typeof result === "string" ? result : result.text;
  return {
    content: [{ type: "text", text: redactSecrets(text) }],
    isError: false,
    details: {
      path: args.path,
      totalLines: typeof result === "string" ? undefined : result.totalLines,
      startLine: typeof result === "string" ? args.startLine : result.startLine,
      endLine: typeof result === "string" ? args.endLine : result.endLine,
      truncated: typeof result === "string" ? undefined : result.truncated,
      delegated: true,
    },
  };
}

function formatDelegatedSearchResult(
  args: SearchFilesArgs,
  result: string | { text: string; matchCount?: number; truncated?: boolean },
): ToolResult {
  const text = typeof result === "string" ? result : result.text;
  return {
    content: [{ type: "text", text: redactSecrets(text) }],
    isError: false,
    details: {
      path: args.path ?? ".",
      query: args.query,
      matchCount: typeof result === "string" ? undefined : result.matchCount,
      truncated: typeof result === "string" ? undefined : result.truncated,
      delegated: true,
    },
  };
}
