/**
 * Bash tool.
 *
 * Executes shell commands in the project working directory.
 * - 30s default timeout, capped to prevent silent long-running hangs
 * - Output truncated to last 2000 lines / 50KB
 * - Full output saved to temp file when truncated
 * - Sandbox: cwd restricted to project workspace
 */

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commandErrorInfo, createToolErrorResult, redactSecrets } from "./errors";
import type { ToolContext, ToolDefinition, ToolResult } from "./types";
import { truncateOutput } from "./types";

// ─── Types ───

export interface BashArgs {
  command: string;
  timeout?: number;
}

function validateBashArgs(args: BashArgs): ToolResult | null {
  const raw = args as unknown as Record<string, unknown>;

  if (typeof raw.command === "string" && raw.command.trim().length > 0) {
    return null;
  }

  return createToolErrorResult({
    code: "bash_invalid_arguments",
    category: "validation",
    message: "Invalid bash arguments: command must be provided as a non-empty string.",
    nextAction:
      'This is an invalid tool call, not a shell failure. Retry only with arguments shaped exactly like {"command":"..."}; do not retry unchanged.',
    fingerprint: "validation:bash_invalid_arguments:command",
  });
}

// ─── Constants ───

const DEFAULT_TIMEOUT = 30; // seconds
const MIN_TIMEOUT = 1; // seconds
const DEFAULT_MAX_TIMEOUT = 300; // seconds
const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024; // 50KB

// ─── Helpers ───

/**
 * Execute a command and collect stdout/stderr.
 * Returns { stdout, stderr, exitCode, signalCode, timedOut, truncated }.
 */
async function execCommand(
  command: string,
  cwd: string,
  timeoutSec: number,
  signal?: AbortSignal,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];

    const child = spawn(shell, shellArgs, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

    const killProcessTree = (killSignal: NodeJS.Signals) => {
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, killSignal);
          return;
        } catch {
          // The process group may already be gone; fall back to the shell process.
        }
      }
      child.kill(killSignal);
    };

    const terminate = (forceAfterMs: number) => {
      killProcessTree("SIGTERM");
      forceKillTimer = setTimeout(() => killProcessTree("SIGKILL"), forceAfterMs);
      forceKillTimer.unref();
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate(5000);
    }, timeoutSec * 1000);

    const onAbort = () => {
      aborted = true;
      terminate(1000);
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", onAbort);
      rejectPromise(err);
    });

    child.on("close", (code, signalCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", onAbort);

      resolvePromise({
        stdout,
        stderr,
        exitCode: code,
        signalCode,
        timedOut,
        aborted,
        truncated: false,
      });
    });
  });
}

function normalizeMaxTimeout(maxTimeout: number | undefined): number {
  if (maxTimeout === undefined || !Number.isFinite(maxTimeout)) {
    return DEFAULT_MAX_TIMEOUT;
  }
  return Math.max(MIN_TIMEOUT, Math.floor(maxTimeout));
}

function normalizeTimeout(
  timeout: number | undefined,
  maxTimeout: number | undefined,
): { seconds: number; maxSeconds: number; note?: string } {
  const maxSeconds = normalizeMaxTimeout(maxTimeout);
  if (timeout === undefined) {
    return { seconds: Math.min(DEFAULT_TIMEOUT, maxSeconds), maxSeconds };
  }

  if (!Number.isFinite(timeout)) {
    return {
      seconds: Math.min(DEFAULT_TIMEOUT, maxSeconds),
      maxSeconds,
      note: `[Requested timeout ${String(timeout)}s is invalid; using default ${Math.min(DEFAULT_TIMEOUT, maxSeconds)}s]`,
    };
  }

  const rounded = Math.floor(timeout);
  const seconds = Math.min(maxSeconds, Math.max(MIN_TIMEOUT, rounded));
  if (seconds === rounded) {
    return { seconds, maxSeconds };
  }

  return {
    seconds,
    maxSeconds,
    note: `[Requested timeout ${timeout}s adjusted to ${seconds}s; allowed range is ${MIN_TIMEOUT}-${maxSeconds}s]`,
  };
}

// ─── Tool Definition ───

export const bashTool: ToolDefinition<BashArgs> = {
  name: "bash",
  label: "bash",
  description:
    "Execute a bash command in the current working directory. Default timeout is 30s and requested timeouts are capped by the runtime bashMaxTimeoutSeconds setting (default 300s). Output is truncated to the last 2000 lines or 50KB (whichever is hit first). When truncated, full output is saved to a temp file.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Bash command to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in seconds (optional, default 30s, capped by runtime config)",
      },
    },
    required: ["command"],
  },
  toolType: "local_shell",

  async execute(args: BashArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
    const validationError = validateBashArgs(args);
    if (validationError) return validationError;

    if (signal?.aborted) {
      return createToolErrorResult({
        code: "command_aborted",
        category: "aborted",
        message: "Operation aborted.",
        nextAction: "Do not restart the same command automatically; choose a shorter command or ask before retrying.",
        fingerprint: "aborted:command_aborted",
      });
    }

    const timeout = normalizeTimeout(args.timeout, context.bashMaxTimeoutSeconds);

    try {
      const result = await execCommand(args.command, context.cwd, timeout.seconds, signal);

      let output = timeout.note ? `${timeout.note}\n` : "";
      if (result.stdout) output += result.stdout;
      if (result.stderr) {
        if (output) output += "\n";
        output += result.stderr;
      }

      if (result.timedOut) {
        output += `\n[Command timed out after ${timeout.seconds}s]`;
      }
      if (result.aborted) {
        output += "\n[Command stopped by user. Continue with another approach or ask before restarting it.]";
      }
      if (result.signalCode && !result.aborted && !result.timedOut) {
        output += `\n[Command terminated by signal: ${result.signalCode}]`;
      }

      output = redactSecrets(output);

      // Apply truncation
      const truncated = truncateOutput(output, MAX_LINES, MAX_BYTES);

      // If truncated, save full output to temp file
      let tempPath: string | undefined;
      if (truncated.truncated) {
        try {
          const tempDir = mkdtempSync(join(join(context.cwd, ".soba-tmp"), "bash-"));
          tempPath = join(tempDir, "output.txt");
          writeFileSync(tempPath, output);
        } catch {
          // Failed to write temp file — not critical
        }
      }

      let outputText = truncated.text;
      if (tempPath) {
        outputText += `\n[Full output saved to ${tempPath}]`;
      }

      if (result.exitCode !== null && result.exitCode !== 0) {
        outputText += `\n[Exit code: ${result.exitCode}]`;
      }
      const error = commandErrorInfo(result);
      if (error) {
        outputText += `\n[${error.code}: ${error.nextAction}]`;
      }

      return {
        content: [{ type: "text", text: outputText || "(no output)" }],
        isError: result.exitCode !== 0 || result.signalCode !== null || result.aborted,
        error,
        details: {
          exitCode: result.exitCode,
          signalCode: result.signalCode ?? undefined,
          timedOut: result.timedOut,
          aborted: result.aborted,
          truncated: truncated.truncated,
          timeoutSeconds: timeout.seconds,
          maxTimeoutSeconds: timeout.maxSeconds,
          tempPath,
        },
      };
    } catch (error) {
      return createToolErrorResult({
        code: "command_spawn_failed",
        category: "command",
        message: `Error executing command: ${error instanceof Error ? error.message : String(error)}`,
        nextAction: "Inspect the command syntax and environment, then use a simpler available command.",
        fingerprint: "command:spawn_failed",
      });
    }
  },
};
