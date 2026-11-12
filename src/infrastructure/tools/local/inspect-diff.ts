/**
 * inspect_diff tool.
 *
 * Structured diff inspection without a shell git pipeline: per-file
 * addition/deletion stats plus bounded hunks with line numbers, path or glob
 * filtering, and explicit truncation disclosure. A successful inspect_diff
 * counts as diff-inspection readback evidence for docs-only changes.
 */

import { spawn } from "node:child_process";
import { createToolErrorResult } from "../../../kernel/tools/errors";
import type { ToolContext, ToolDefinition, ToolResult } from "../../../kernel/tools/types";
import { truncateOutput } from "../../../kernel/tools/types";

export interface InspectDiffArgs {
  /** Working tree diff (default), a revision ("HEAD"), or a range ("main..HEAD"). */
  revision?: string;
  /** Diff the staging area instead of the working tree. */
  staged?: boolean;
  /** Restrict the diff to a path (file or directory). */
  path?: string;
  /** Restrict the diff with a glob (for example "*.md"; use "**" path segments for recursion). */
  glob?: string;
  /** Maximum number of hunks to include. Defaults to 60. */
  maxHunks?: number;
}

const DEFAULT_MAX_HUNKS = 60;
const MAX_HUNKS = 500;
const MAX_CAPTURE_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 50 * 1024;

interface DiffFileStat {
  path: string;
  additions: number;
  deletions: number;
}

export const inspectDiffTool: ToolDefinition<InspectDiffArgs> = {
  name: "inspect_diff",
  label: "inspect_diff",
  description:
    "Inspect the working tree or a revision range diff without a shell pipeline. Returns per-file addition/deletion stats and bounded hunks with line numbers, respects the requested path or glob, and discloses truncation. Docs-only diffs satisfy readback inspection evidence.",
  parameters: {
    type: "object",
    properties: {
      revision: {
        type: "string",
        description: 'Optional revision or range to diff against, e.g. "HEAD" or "main..HEAD". Defaults to the working tree.',
      },
      staged: {
        type: "boolean",
        description: "Diff the staging area instead of the working tree.",
      },
      path: {
        type: "string",
        description: "Optional file or directory path to restrict the diff.",
      },
      glob: {
        type: "string",
        description: "Optional glob such as docs/**/*.md to restrict the diff.",
      },
      maxHunks: {
        type: "number",
        description: `Maximum hunks to include. Defaults to ${DEFAULT_MAX_HUNKS}, capped at ${MAX_HUNKS}.`,
      },
    },
  },
  toolType: "function",
  semantics: { effects: ["inspect"], parallelSafe: true, restrictedMode: "allow" },

  async execute(args: InspectDiffArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) {
      return createToolErrorResult({
        code: "inspect_diff_aborted",
        category: "aborted",
        message: "Operation aborted.",
        nextAction: "Retry with a narrower path or glob.",
        fingerprint: "aborted:inspect_diff_aborted",
      });
    }

    const maxHunks = normalizeMaxHunks(args.maxHunks);
    const pathspecs = buildPathspecs(args);

    const [numstat, diff] = await Promise.all([
      runGitDiff(context.cwd, ["--numstat", ...(args.staged === true ? ["--staged"] : []), ...(args.revision ? [args.revision] : []), "--", ...pathspecs], signal),
      runGitDiff(context.cwd, ["--no-color", "--unified=3", ...(args.staged === true ? ["--staged"] : []), ...(args.revision ? [args.revision] : []), "--", ...pathspecs], signal),
    ]);

    if (numstat.status === "error" || diff.status === "error") {
      const message = numstat.status === "error" ? numstat.message : diff.status === "error" ? diff.message : "git diff failed.";
      return createToolErrorResult({
        code: "inspect_diff_failed",
        category: "command",
        message,
        nextAction: "Run inside a git repository and check the revision/path.",
        fingerprint: "command:inspect_diff_failed",
      });
    }

    const stats = parseNumstat(numstat.output);
    if (stats.length === 0) {
      return {
        content: [{ type: "text", text: "No changes." }],
        isError: false,
        details: { fileCount: 0, files: [], hunks: 0, truncated: false },
      };
    }

    const totalAdditions = stats.reduce((sum, file) => sum + file.additions, 0);
    const totalDeletions = stats.reduce((sum, file) => sum + file.deletions, 0);
    const { text: hunkText, hunkCount, truncated } = formatHunks(diff.output, maxHunks);

    const header = `[inspect_diff] ${stats.length} file(s) changed (+${totalAdditions}/-${totalDeletions})`;
    const statLines = stats.map((file) => `  ${file.path}: +${file.additions}/-${file.deletions}`);
    const sections = [header, ...statLines, "", hunkText.trimEnd()];
    if (truncated) {
      sections.push(`[Output truncated: showing ${hunkCount} hunk(s); narrow path/glob or raise maxHunks.]`);
    }
    const output = truncateOutput(sections.join("\n"), 2000, MAX_OUTPUT_BYTES);

    return {
      content: [{ type: "text", text: output.text }],
      isError: false,
      details: {
        fileCount: stats.length,
        files: stats,
        hunks: hunkCount,
        truncated: truncated || output.truncated,
        revision: args.revision ?? null,
        path: args.path ?? null,
        glob: args.glob ?? null,
      },
    };
  },
};

function normalizeMaxHunks(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_HUNKS;
  return Math.max(1, Math.min(MAX_HUNKS, Math.floor(value)));
}

function buildPathspecs(args: InspectDiffArgs): string[] {
  if (args.path) return [args.path];
  if (args.glob) return [`:(glob)${args.glob}`];
  return [];
}

function runGitDiff(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ status: "ok"; output: string } | { status: "error"; message: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("git", ["diff", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let capturedBytes = 0;
    let settled = false;

    const finish = (result: Awaited<ReturnType<typeof runGitDiff>>) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolvePromise(result);
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      finish({ status: "ok", output: stdout });
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (data: Buffer) => {
      if (capturedBytes > MAX_CAPTURE_BYTES) return;
      capturedBytes += data.length;
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.on("error", () => finish({ status: "error", message: "git is not available." }));
    child.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        finish({ status: "error", message: stderr.trim() || `git diff exited with code ${code}.` });
        return;
      }
      finish({ status: "ok", output: stdout });
    });
  });
}

function parseNumstat(output: string): DiffFileStat[] {
  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      const match = /^(\d+|-)\s+(\d+|-)\s+(.+)$/.exec(line);
      if (!match) return [];
      return [{
        path: match[3].trim(),
        additions: match[1] === "-" ? 0 : Number(match[1]),
        deletions: match[2] === "-" ? 0 : Number(match[2]),
      }];
    });
}

function formatHunks(diffOutput: string, maxHunks: number): { text: string; hunkCount: number; truncated: boolean } {
  const lines: string[] = [];
  let hunkCount = 0;
  let truncated = false;

  for (const line of diffOutput.split("\n")) {
    if (line.startsWith("@@")) {
      if (hunkCount >= maxHunks) {
        truncated = true;
        break;
      }
      hunkCount += 1;
      lines.push(line);
      continue;
    }
    if (line.startsWith("diff --git") || line.startsWith("index ")) continue;
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      lines.push(line.replace(/^(--- |\+\+\+ )[ab]\//, "$1"));
      continue;
    }
    if (line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("similarity")) {
      lines.push(line);
      continue;
    }
    if (hunkCount > 0) lines.push(line);
  }

  return { text: lines.join("\n"), hunkCount, truncated };
}
