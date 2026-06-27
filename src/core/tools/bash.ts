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
import { closeSync, mkdirSync, mkdtempSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import { commandErrorInfo, createToolErrorResult, redactSecrets } from "./errors";
import type { ToolContext, ToolDefinition, ToolResult } from "./types";

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
const REDACTION_CARRY_CHARS = 4096;

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
  output: string;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
  tempPath?: string;
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

    const capture = new StreamingOutputCapture(cwd, MAX_LINES, MAX_BYTES);
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
      capture.append(data);
    });

    child.stderr?.on("data", (data: Buffer) => {
      capture.append(data);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      capture.close();
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", onAbort);
      rejectPromise(err);
    });

    child.on("close", (code, signalCode) => {
      if (settled) return;
      settled = true;
      capture.close();
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", onAbort);

      resolvePromise({
        output: capture.text(),
        exitCode: code,
        signalCode,
        timedOut,
        aborted,
        truncated: capture.truncated,
        tempPath: capture.tempPath,
      });
    });
  });
}

class StreamingOutputCapture {
  private preview = "";
  private redactionCarry = "";
  private pendingFullOutput: string[] = [];
  private spoolFd: number | null = null;
  private _tempPath: string | undefined;
  private totalBytes = 0;
  private totalLineBreaks = 0;
  private _truncated = false;

  constructor(
    private readonly cwd: string,
    private readonly maxLines: number,
    private readonly maxBytes: number,
  ) {}

  get truncated(): boolean {
    return this._truncated;
  }

  get tempPath(): string | undefined {
    return this._tempPath;
  }

  append(data: Buffer): void {
    const raw = data.toString();
    if (!raw) return;

    const combined = this.redactionCarry + raw;
    const flushTarget = Math.max(0, combined.length - REDACTION_CARRY_CHARS);
    const flushLength = safeRedactionFlushLength(combined, flushTarget);
    if (flushLength > 0) {
      this.appendRedacted(redactSecrets(combined.slice(0, flushLength)));
      this.redactionCarry = combined.slice(flushLength);
    } else {
      this.redactionCarry = combined;
    }
  }

  close(): void {
    if (this.redactionCarry) {
      this.appendRedacted(redactSecrets(this.redactionCarry));
      this.redactionCarry = "";
    }
    if (this.spoolFd !== null) {
      closeSync(this.spoolFd);
      this.spoolFd = null;
    }
  }

  text(): string {
    return this.preview;
  }

  private appendRedacted(chunk: string): void {
    if (!chunk) return;

    this.totalBytes += Buffer.byteLength(chunk, "utf-8");
    this.totalLineBreaks += countLineBreaks(chunk);

    if (this.spoolFd !== null) {
      writeSync(this.spoolFd, chunk);
    } else {
      this.pendingFullOutput.push(chunk);
      if (this.totalBytes > this.maxBytes || this.totalLineBreaks >= this.maxLines) {
        this.ensureSpool();
      }
    }

    this.preview += chunk;
    this.trimPreview();
  }

  private ensureSpool(): void {
    if (this._tempPath || this.spoolFd !== null) return;
    try {
      mkdirSync(join(this.cwd, ".soba-tmp"), { recursive: true });
      const tempDir = mkdtempSync(join(join(this.cwd, ".soba-tmp"), "bash-"));
      this._tempPath = join(tempDir, "output.txt");
      this.spoolFd = openSync(this._tempPath, "w");
      for (const chunk of this.pendingFullOutput) {
        writeSync(this.spoolFd, chunk);
      }
      this.pendingFullOutput = [];
    } catch {
      this._tempPath = undefined;
      this.spoolFd = null;
    }
  }

  private trimPreview(): void {
    let trimmed = false;
    const lines = this.preview.split("\n");
    if (lines.length > this.maxLines) {
      this.preview = lines.slice(-this.maxLines).join("\n");
      trimmed = true;
    }

    const previewBuffer = Buffer.from(this.preview, "utf-8");
    if (previewBuffer.length > this.maxBytes) {
      this.preview = new TextDecoder().decode(previewBuffer.subarray(previewBuffer.length - this.maxBytes));
      trimmed = true;
    }

    if (trimmed) {
      this._truncated = true;
      this.ensureSpool();
    }
  }
}

function countLineBreaks(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

function safeRedactionFlushLength(value: string, target: number): number {
  if (target <= 0) return 0;
  for (let index = Math.min(target, value.length - 1); index >= 0; index -= 1) {
    if (/\s/.test(value[index])) return index + 1;
  }
  return target;
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
    "Run project commands, verification workflows, git, package-manager scripts, and shell-only operations in the current working directory. Do not use bash for pwd, routine directory listing, text search, or file reads when ls, search_files, read, or inspect_file fit. Run final verification directly; --help/--version/which probes and verification piped through head/tail are diagnostic only. Default timeout is 30s and requested timeouts are capped by the runtime bashMaxTimeoutSeconds setting (default 300s). Output is truncated to the last 2000 lines or 50KB (whichever is hit first). When truncated, full output is saved to a temp file.",
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
      if (result.output) output += result.output;

      if (result.timedOut) {
        output += `\n[Command timed out after ${timeout.seconds}s]`;
      }
      if (result.aborted) {
        output += "\n[Command stopped by user. Continue with another approach or ask before restarting it.]";
      }
      if (result.signalCode && !result.aborted && !result.timedOut) {
        output += `\n[Command terminated by signal: ${result.signalCode}]`;
      }

      let outputText = redactSecrets(output);
      if (result.truncated) {
        outputText += `\n[Output truncated to last ${MAX_LINES} lines / ${MAX_BYTES / 1024}KB]`;
      }
      if (result.tempPath) {
        outputText += `\n[Full output saved to ${result.tempPath}]`;
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
          command: args.command,
          exitCode: result.exitCode,
          signalCode: result.signalCode ?? undefined,
          timedOut: result.timedOut,
          aborted: result.aborted,
          truncated: result.truncated,
          timeoutSeconds: timeout.seconds,
          maxTimeoutSeconds: timeout.maxSeconds,
          tempPath: result.tempPath,
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
