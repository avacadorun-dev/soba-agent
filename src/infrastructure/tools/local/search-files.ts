import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createToolErrorResult, redactSecrets } from "../../../kernel/tools/errors";
import type { ToolContext, ToolDefinition, ToolResult } from "../../../kernel/tools/types";
import { truncateOutput } from "../../../kernel/tools/types";

export interface SearchFilesArgs {
  query: string;
  path?: string;
  glob?: string;
  caseSensitive?: boolean;
  maxMatches?: number;
  /** Lines of surrounding context to include before and after each match. Bounded by the same output limits. */
  contextLines?: number;
}

interface SearchMatchContext {
  line: number;
  text: string;
}

interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
  context?: SearchMatchContext[];
}

const DEFAULT_MAX_MATCHES = 50;
const MAX_MATCHES = 200;
const MAX_CONTEXT_LINES = 5;
const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_CAPTURE_BYTES = 256 * 1024;
const FALLBACK_MAX_FILES = 1000;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".soba-tmp"]);

export const searchFilesTool: ToolDefinition<SearchFilesArgs> = {
  name: "search_files",
  label: "search_files",
  description:
    "Search file contents for text, regex, or symbol matches with bounded output. Prefer this over hand-written grep/find shell pipelines when looking for code or prose. Not a directory listing tool; use ls for path discovery. Returns file, line, column, and compact matching text.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Text or regex pattern to search for.",
      },
      path: {
        type: "string",
        description: "Directory or file to search, relative to cwd. Defaults to current directory.",
      },
      glob: {
        type: "string",
        description: "Optional file glob filter such as **/*.ts or docs/**/*.md.",
      },
      caseSensitive: {
        type: "boolean",
        description: "Whether matching is case-sensitive. Defaults to false.",
      },
      maxMatches: {
        type: "number",
        description: `Maximum total matches to return. Defaults to ${DEFAULT_MAX_MATCHES}, capped at ${MAX_MATCHES}.`,
      },
      contextLines: {
        type: "number",
        description: `Optional lines of context before and after each match (0-${MAX_CONTEXT_LINES}). Bounded by the same output limits.`,
      },
    },
    required: ["query"],
  },
  toolType: "function",

  async execute(args: SearchFilesArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) {
      return createToolErrorResult({
        code: "search_aborted",
        category: "aborted",
        message: "Operation aborted.",
        nextAction: "Narrow the query or path before retrying.",
        fingerprint: "aborted:search_aborted",
      });
    }

    const query = args.query.trim();
    if (!query) {
      return createToolErrorResult({
        code: "search_empty_query",
        category: "validation",
        message: "search_files query cannot be empty.",
        nextAction: "Provide a concrete text or regex pattern.",
        fingerprint: "validation:search_empty_query",
      });
    }

    const maxMatches = normalizeMaxMatches(args.maxMatches);
    const contextLines = normalizeContextLines(args.contextLines);
    const targetPath = resolve(context.cwd, args.path ?? ".");

    const rgResult = await runRipgrepSearch({
      cwd: context.cwd,
      targetPath,
      query,
      glob: args.glob,
      caseSensitive: args.caseSensitive === true,
      maxMatches,
      contextLines,
      signal,
    });

    if (rgResult.status === "ok") {
      return formatSearchResult(rgResult.matches, {
        path: args.path ?? ".",
        query,
        maxMatches,
        truncated: rgResult.truncated,
        engine: "rg",
      });
    }

    if (rgResult.status === "invalid_query") {
      return createToolErrorResult({
        code: "search_invalid_query",
        category: "validation",
        message: rgResult.message,
        nextAction: "Escape regex metacharacters or use a simpler literal query.",
        fingerprint: "validation:search_invalid_query",
      });
    }

    const fallback = await runFallbackSearch({
      cwd: context.cwd,
      targetPath,
      query,
      glob: args.glob,
      caseSensitive: args.caseSensitive === true,
      maxMatches,
      contextLines,
      signal,
    });

    if (fallback.status === "error") {
      return createToolErrorResult({
        code: "search_failed",
        category: "filesystem",
        message: fallback.message,
        nextAction: "Inspect the search path and retry with a valid file or directory.",
        fingerprint: `filesystem:search_failed:${args.path ?? "."}`,
      });
    }

    return formatSearchResult(fallback.matches, {
      path: args.path ?? ".",
      query,
      maxMatches,
      truncated: fallback.truncated,
      engine: "fallback",
    });
  },
};

async function runRipgrepSearch(options: {
  cwd: string;
  targetPath: string;
  query: string;
  glob?: string;
  caseSensitive: boolean;
  maxMatches: number;
  contextLines: number;
  signal?: AbortSignal;
}): Promise<
  | { status: "ok"; matches: SearchMatch[]; truncated: boolean }
  | { status: "unavailable" }
  | { status: "invalid_query"; message: string }
> {
  const args = ["--line-number", "--column", "--no-heading", "--color", "never"];
  if (!options.caseSensitive) args.push("-i");
  if (options.glob) args.push("--glob", options.glob);
  if (options.contextLines > 0) args.push("--context", String(options.contextLines));
  args.push("--", options.query, options.targetPath);

  return new Promise((resolvePromise) => {
    const child = spawn("rg", args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let capturedBytes = 0;
    let truncated = false;
    let settled = false;

    const finish = (result: Awaited<ReturnType<typeof runRipgrepSearch>>) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      resolvePromise(result);
    };

    const onAbort = () => {
      child.kill("SIGTERM");
      finish({ status: "ok", matches: parseRgOutput(stdout, options.cwd, options.maxMatches, options.contextLines), truncated: true });
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (data: Buffer) => {
      if (truncated) return;
      capturedBytes += data.length;
      stdout += data.toString();
      if (capturedBytes > MAX_CAPTURE_BYTES) {
        truncated = true;
        child.kill("SIGTERM");
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", () => finish({ status: "unavailable" }));

    child.on("close", (code) => {
      if (settled) return;
      if (code === 2) {
        finish({ status: "invalid_query", message: redactSecrets(stderr.trim() || "Search query is invalid.") });
        return;
      }
      const matches = parseRgOutput(stdout, options.cwd, options.maxMatches, options.contextLines);
      finish({ status: "ok", matches, truncated: truncated || matches.length >= options.maxMatches });
    });
  });
}

async function runFallbackSearch(options: {
  cwd: string;
  targetPath: string;
  query: string;
  glob?: string;
  caseSensitive: boolean;
  maxMatches: number;
  contextLines: number;
  signal?: AbortSignal;
}): Promise<{ status: "ok"; matches: SearchMatch[]; truncated: boolean } | { status: "error"; message: string }> {
  let pattern: RegExp;
  try {
    pattern = new RegExp(options.query, options.caseSensitive ? "g" : "gi");
  } catch {
    pattern = new RegExp(escapeRegExp(options.query), options.caseSensitive ? "g" : "gi");
  }

  try {
    const files = await collectSearchFiles(options.targetPath, options.glob, options.signal);
    const matches: SearchMatch[] = [];
    let scannedFiles = 0;

    for (const filePath of files) {
      if (options.signal?.aborted) break;
      scannedFiles += 1;
      if (scannedFiles > FALLBACK_MAX_FILES) break;

      const fileMatches = options.contextLines > 0
        ? await scanFileForMatchesWithContext({
            cwd: options.cwd,
            filePath,
            pattern,
            contextLines: options.contextLines,
            remaining: options.maxMatches - matches.length,
            signal: options.signal,
          })
        : await scanFileForMatches({
            cwd: options.cwd,
            filePath,
            pattern,
            remaining: options.maxMatches - matches.length,
            signal: options.signal,
          });
      matches.push(...fileMatches);
      if (matches.length >= options.maxMatches) {
        return { status: "ok", matches, truncated: true };
      }
    }

    return { status: "ok", matches, truncated: scannedFiles > FALLBACK_MAX_FILES };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

const CONTEXT_FILE_MAX_BYTES = 1024 * 1024;

async function scanFileForMatchesWithContext(options: {
  cwd: string;
  filePath: string;
  pattern: RegExp;
  contextLines: number;
  remaining: number;
  signal?: AbortSignal;
}): Promise<SearchMatch[]> {
  try {
    const statResult = await stat(options.filePath);
    if (statResult.size > CONTEXT_FILE_MAX_BYTES) {
      // Very large files fall back to match-only scanning to bound memory.
      return scanFileForMatches({
        cwd: options.cwd,
        filePath: options.filePath,
        pattern: options.pattern,
        remaining: options.remaining,
        signal: options.signal,
      });
    }
    const content = await readFile(options.filePath, "utf-8");
    const lines = content.split("\n");
    const matches: SearchMatch[] = [];

    lines.forEach((line, index) => {
      if (matches.length >= options.remaining) return;
      options.pattern.lastIndex = 0;
      const match = options.pattern.exec(line);
      if (!match) return;
      const context: SearchMatchContext[] = [];
      for (let offset = -options.contextLines; offset <= options.contextLines; offset += 1) {
        if (offset === 0) continue;
        const contextLine = lines[index + offset];
        if (contextLine === undefined) continue;
        context.push({ line: index + offset + 1, text: contextLine });
      }
      matches.push({
        path: relative(options.cwd, options.filePath) || ".",
        line: index + 1,
        column: match.index + 1,
        text: line,
        ...(context.length > 0 ? { context } : {}),
      });
    });

    return matches;
  } catch {
    return [];
  }
}

async function scanFileForMatches(options: {
  cwd: string;
  filePath: string;
  pattern: RegExp;
  remaining: number;
  signal?: AbortSignal;
}): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];
  const stream = createReadStream(options.filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  let aborted = false;
  const abort = () => {
    aborted = true;
    rl.close();
    stream.destroy();
  };
  options.signal?.addEventListener("abort", abort, { once: true });

  try {
    for await (const line of rl) {
      if (options.signal?.aborted) break;
      lineNumber += 1;
      options.pattern.lastIndex = 0;
      const match = options.pattern.exec(line);
      if (!match) continue;
      matches.push({
        path: relative(options.cwd, options.filePath) || ".",
        line: lineNumber,
        column: match.index + 1,
        text: line,
      });
      if (matches.length >= options.remaining) break;
    }
  } catch {
    if (!aborted) return [];
  } finally {
    options.signal?.removeEventListener("abort", abort);
    rl.close();
    stream.destroy();
  }

  return matches;
}

async function collectSearchFiles(root: string, glob: string | undefined, signal?: AbortSignal): Promise<string[]> {
  const rootStat = await stat(root);
  if (rootStat.isFile()) return [root];

  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0 && files.length < FALLBACK_MAX_FILES && !signal?.aborted) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(entryPath);
      } else if (entry.isFile() && matchesSimpleGlob(entryPath, glob)) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

function parseRgOutput(output: string, cwd: string, maxMatches: number, contextLines: number): SearchMatch[] {
  const matches: SearchMatch[] = [];
  let current: SearchMatch | null = null;
  let pendingLeading: SearchMatchContext[] = [];
  const matchLine = /^(.*?):(\d+):(\d+):(.*)$/;
  const contextLine = /^(.*?)-(\d+)-(.*)$/;

  const attachContext = (target: SearchMatch, entry: SearchMatchContext) => {
    target.context = [...(target.context ?? []), entry];
  };

  for (const line of output.split("\n")) {
    if (!line || line === "--") continue;
    if (matches.length >= maxMatches) break;

    const asMatch = matchLine.exec(line);
    if (asMatch) {
      current = {
        path: relative(cwd, asMatch[1]) || asMatch[1],
        line: Number(asMatch[2]),
        column: Number(asMatch[3]),
        text: asMatch[4],
      };
      matches.push(current);
      if (contextLines > 0) {
        for (const entry of pendingLeading) attachContext(current, entry);
      }
      pendingLeading = [];
      continue;
    }

    const asContext = contextLine.exec(line);
    if (asContext && contextLines > 0) {
      const entry = { line: Number(asContext[2]), text: asContext[3] };
      if (current) {
        attachContext(current, entry);
      } else {
        pendingLeading.push(entry);
      }
    }
  }
  return matches;
}

function formatSearchResult(
  matches: SearchMatch[],
  options: { path: string; query: string; maxMatches: number; truncated: boolean; engine: string },
): ToolResult {
  if (matches.length === 0) {
    return {
      content: [{ type: "text", text: `No matches found. [engine=${options.engine}]` }],
      isError: false,
      details: { path: options.path, query: options.query, matchCount: 0, engine: options.engine, matches: [] },
    };
  }

  const lines: string[] = [];
  for (const match of matches) {
    lines.push(`${match.path}:${match.line}:${match.column}: ${redactSecrets(match.text.trim())}`);
    for (const context of match.context ?? []) {
      lines.push(`  ${context.line}: ${redactSecrets(context.text.trim())}`);
    }
  }
  if (options.truncated || matches.length >= options.maxMatches) {
    lines.push(`[Output truncated: returned ${matches.length} match(es); narrow query/path or raise maxMatches.]`);
  }

  const truncated = truncateOutput(lines.join("\n"), 1000, MAX_OUTPUT_BYTES);
  return {
    content: [{ type: "text", text: truncated.text }],
    isError: false,
    details: {
      path: options.path,
      query: options.query,
      matchCount: matches.length,
      matches,
      truncated: options.truncated || truncated.truncated,
      engine: options.engine,
    },
  };
}

function normalizeMaxMatches(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_MATCHES;
  return Math.max(1, Math.min(MAX_MATCHES, Math.floor(value)));
}

function normalizeContextLines(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_CONTEXT_LINES, Math.floor(value)));
}

function matchesSimpleGlob(filePath: string, glob: string | undefined): boolean {
  if (!glob) return true;
  const suffix = glob.startsWith("**/*") ? glob.slice(4) : glob.replace(/^\*/, "");
  return suffix ? filePath.endsWith(suffix) : true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
