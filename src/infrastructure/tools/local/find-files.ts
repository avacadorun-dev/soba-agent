/**
 * find_files tool.
 *
 * Recursive, deterministic file discovery with glob filters, ignore rules,
 * and a depth limit. Complements `ls` (single directory) and `search_files`
 * (content search) so recursive discovery does not need shell pipelines.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { createToolErrorResult } from "../../../kernel/tools/errors";
import type { ToolContext, ToolDefinition, ToolResult } from "../../../kernel/tools/types";
import { truncateOutput } from "../../../kernel/tools/types";

export interface FindFilesArgs {
  path?: string;
  glob?: string;
  maxResults?: number;
  maxDepth?: number;
}

const DEFAULT_MAX_RESULTS = 200;
const MAX_RESULTS = 2000;
const DEFAULT_MAX_DEPTH = 8;
const MAX_DEPTH = 20;
const MAX_OUTPUT_BYTES = 50 * 1024;
const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".soba",
  ".soba-tmp",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);

export const findFilesTool: ToolDefinition<FindFilesArgs> = {
  name: "find_files",
  label: "find_files",
  description:
    "Discover files recursively with a glob filter. Returns a deterministically sorted path list, respects ignore rules (.gitignore names and built-in skip directories), and bounds depth and result count. Use ls for a single directory listing and search_files for content search.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory to search, relative to cwd. Defaults to current directory.",
      },
      glob: {
        type: "string",
        description: "Optional glob such as **/*.ts, src/**/*.md, or *.json. Defaults to all files.",
      },
      maxResults: {
        type: "number",
        description: `Maximum results to return. Defaults to ${DEFAULT_MAX_RESULTS}, capped at ${MAX_RESULTS}.`,
      },
      maxDepth: {
        type: "number",
        description: `Maximum directory depth below the search root. Defaults to ${DEFAULT_MAX_DEPTH}, capped at ${MAX_DEPTH}.`,
      },
    },
  },
  toolType: "function",
  semantics: { effects: ["search"], parallelSafe: true, restrictedMode: "allow" },

  async execute(args: FindFilesArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) {
      return createToolErrorResult({
        code: "find_aborted",
        category: "aborted",
        message: "Operation aborted.",
        nextAction: "Narrow the glob or path before retrying.",
        fingerprint: "aborted:find_aborted",
      });
    }

    const maxResults = normalizeMaxResults(args.maxResults);
    const maxDepth = normalizeMaxDepth(args.maxDepth);
    const root = resolve(context.cwd, args.path ?? ".");
    const globPattern = args.glob?.trim() ? args.glob.trim() : undefined;
    const globRegex = globPattern ? globToRegExp(globPattern) : null;
    if (globPattern && !globRegex) {
      return createToolErrorResult({
        code: "find_invalid_glob",
        category: "validation",
        message: `find_files glob is invalid: ${globPattern}`,
        nextAction: "Use a simple glob like **/*.ts or src/**/*.md.",
        fingerprint: "validation:find_invalid_glob",
      });
    }

    let ignorePatterns: string[] = [];
    try {
      ignorePatterns = parseIgnoreFile(await readFile(resolve(context.cwd, ".gitignore"), "utf-8"));
    } catch {
      // No readable .gitignore; built-in skip dirs still apply.
    }

    try {
      const rootStat = await stat(root);
      if (!rootStat.isDirectory()) {
        return createToolErrorResult({
          code: "find_invalid_path",
          category: "validation",
          message: `find_files path is not a directory: ${args.path ?? "."}`,
          nextAction: "Point path at an existing directory relative to cwd.",
          fingerprint: "validation:find_invalid_path",
        });
      }
    } catch {
      return createToolErrorResult({
        code: "find_invalid_path",
        category: "validation",
        message: `find_files path does not exist: ${args.path ?? "."}`,
        nextAction: "Point path at an existing directory relative to cwd.",
        fingerprint: "validation:find_invalid_path",
      });
    }

    const results: string[] = [];
    let truncated = false;

    const visit = async (absoluteDir: string, depth: number): Promise<void> => {
      if (depth > maxDepth || results.length >= maxResults || signal?.aborted) return;
      let entries;
      try {
        entries = await readdir(absoluteDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= maxResults) {
          truncated = true;
          return;
        }
        const absolutePath = resolve(absoluteDir, entry.name);
        const relativePath = relative(context.cwd, absolutePath).split(sep).join("/");
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          if (isIgnored(relativePath, ignorePatterns)) continue;
          await visit(absolutePath, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        if (isIgnored(relativePath, ignorePatterns)) continue;
        if (globRegex && !globRegex.test(relativePath)) continue;
        results.push(relativePath);
      }
    };

    await visit(root, 0);
    results.sort();

    if (results.length === 0) {
      return {
        content: [{ type: "text", text: "No files found." }],
        isError: false,
        details: { path: args.path ?? ".", glob: globPattern ?? null, matchCount: 0, files: [] },
      };
    }

    const header = `${results.length} file(s)${truncated ? " (truncated)" : ""}${globPattern ? ` matching ${globPattern}` : ""}:`;
    const lines = [header, ...results.map((path) => `  ${path}`)];
    if (truncated || results.length >= maxResults) {
      lines.push(`[Output truncated: returned ${results.length} path(s); narrow the glob/path or raise maxResults.]`);
    }
    const output = truncateOutput(lines.join("\n"), 2000, MAX_OUTPUT_BYTES);
    return {
      content: [{ type: "text", text: output.text }],
      isError: false,
      details: {
        path: args.path ?? ".",
        glob: globPattern ?? null,
        matchCount: results.length,
        files: results,
        truncated: truncated || output.truncated,
      },
    };
  },
};

function normalizeMaxResults(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_RESULTS;
  return Math.max(1, Math.min(MAX_RESULTS, Math.floor(value)));
}

function normalizeMaxDepth(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_DEPTH;
  return Math.max(1, Math.min(MAX_DEPTH, Math.floor(value)));
}

function parseIgnoreFile(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!"))
    .map((line) => line.replace(/^\//, "").replace(/\/$/, ""));
}

function isIgnored(relativePath: string, patterns: string[]): boolean {
  const segments = relativePath.split("/");
  return patterns.some((pattern) => {
    const normalized = pattern.replace(/^\//, "").replace(/\/$/, "");
    if (!normalized) return false;
    if (normalized.includes("*")) return false; // complex patterns are not interpreted
    if (normalized.includes("/")) return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
    return segments.includes(normalized);
  });
}

/** Converts a practical subset of globs (** , *) to an anchored RegExp. */
export function globToRegExp(glob: string): RegExp | null {
  if (glob.length === 0 || glob.includes("(") || glob.includes("[")) return null;
  let regex = "";
  let index = 0;
  while (index < glob.length) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      const followedBySlash = glob[index + 2] === "/";
      if (followedBySlash) {
        regex += "(?:[^/]+/)*";
        index += 3;
      } else {
        regex += ".*";
        index += 2;
      }
      continue;
    }
    if (char === "*") {
      regex += "[^/]*";
      index += 1;
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      index += 1;
      continue;
    }
    if (".+^${}\\|".includes(char)) {
      regex += `\\${char}`;
      index += 1;
      continue;
    }
    regex += char;
    index += 1;
  }
  try {
    return new RegExp(`^${regex}$`);
  } catch {
    return null;
  }
}
