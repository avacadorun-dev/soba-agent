import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { createToolErrorResult, redactSecrets } from "./errors";
import type { ToolContext, ToolDefinition, ToolResult } from "./types";
import { truncateOutput } from "./types";

export interface SearchFilesArgs {
  query: string;
  path?: string;
  glob?: string;
  caseSensitive?: boolean;
  maxMatches?: number;
}

interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

const DEFAULT_MAX_MATCHES = 50;
const MAX_MATCHES = 200;
const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_CAPTURE_BYTES = 256 * 1024;
const FALLBACK_MAX_FILES = 1000;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".soba-tmp"]);

export const searchFilesTool: ToolDefinition<SearchFilesArgs> = {
  name: "search_files",
  label: "search_files",
  description:
    "Search project files for text or regex matches with bounded output. Prefer this over hand-written grep/find shell pipelines before editing. Returns file, line, column, and compact matching text.",
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
    const targetPath = resolve(context.cwd, args.path ?? ".");

    const rgResult = await runRipgrepSearch({
      cwd: context.cwd,
      targetPath,
      query,
      glob: args.glob,
      caseSensitive: args.caseSensitive === true,
      maxMatches,
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
  signal?: AbortSignal;
}): Promise<
  | { status: "ok"; matches: SearchMatch[]; truncated: boolean }
  | { status: "unavailable" }
  | { status: "invalid_query"; message: string }
> {
  const args = ["--line-number", "--column", "--no-heading", "--color", "never"];
  if (!options.caseSensitive) args.push("-i");
  if (options.glob) args.push("--glob", options.glob);
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
      finish({ status: "ok", matches: parseRgOutput(stdout, options.cwd, options.maxMatches), truncated: true });
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
      const matches = parseRgOutput(stdout, options.cwd, options.maxMatches);
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

      const text = await readFile(filePath, "utf-8").catch(() => "");
      const lines = text.split("\n");
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        pattern.lastIndex = 0;
        const match = pattern.exec(lines[lineIndex]);
        if (!match) continue;
        matches.push({
          path: relative(options.cwd, filePath) || ".",
          line: lineIndex + 1,
          column: match.index + 1,
          text: lines[lineIndex],
        });
        if (matches.length >= options.maxMatches) {
          return { status: "ok", matches, truncated: true };
        }
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

function parseRgOutput(output: string, cwd: string, maxMatches: number): SearchMatch[] {
  const matches: SearchMatch[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const parsed = /^(.*?):(\d+):(\d+):(.*)$/.exec(line);
    if (!parsed) continue;
    matches.push({
      path: relative(cwd, parsed[1]) || parsed[1],
      line: Number(parsed[2]),
      column: Number(parsed[3]),
      text: parsed[4],
    });
    if (matches.length >= maxMatches) break;
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

  const lines = matches.map((match) => `${match.path}:${match.line}:${match.column}: ${redactSecrets(match.text.trim())}`);
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

function matchesSimpleGlob(filePath: string, glob: string | undefined): boolean {
  if (!glob) return true;
  const suffix = glob.startsWith("**/*") ? glob.slice(4) : glob.replace(/^\*/, "");
  return suffix ? filePath.endsWith(suffix) : true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
