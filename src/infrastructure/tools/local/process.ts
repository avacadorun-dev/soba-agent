/**
 * process tool.
 *
 * Lifecycle control for long-running background processes: start, status,
 * logs, stop, list. Jobs survive the originating tool call; output is
 * redacted with the same rules as bash and persisted to a per-job log file.
 * Approval for `start` goes through the same command trust check as bash, so
 * a backgrounded job can never run a command the foreground would refuse.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createToolErrorResult, redactSecrets } from "../../../kernel/tools/errors";
import type { ToolContext, ToolDefinition, ToolResult } from "../../../kernel/tools/types";
import { truncateOutput } from "../../../kernel/tools/types";
export interface ProcessArgs {
  action: "start" | "status" | "logs" | "stop" | "list";
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  jobId?: string;
  logPath?: string;
  /** Keep the job alive across session boundaries; otherwise it is swept when the session ends. */
  keep?: boolean;
  tailLines?: number;
}

interface Job {
  jobId: string;
  sessionId: string;
  command: string;
  cwd: string;
  logPath: string;
  keep: boolean;
  startedAt: number;
  endedAt?: number;
  status: "running" | "exited";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stopSignal?: "SIGTERM" | "SIGKILL";
  pid?: number;
  child?: ChildProcess;
  bytesWritten: number;
}

const jobs = new Map<string, Job>();
let jobCounter = 0;

const DEFAULT_LOG_TAIL_LINES = 50;
const MAX_LOG_TAIL_LINES = 2000;
const MAX_LOG_BYTES = 50 * 1024;
const STOP_GRACE_MS = 5000;
const REDACTION_CARRY_CHARS = 4096;

function createJobId(): string {
  jobCounter += 1;
  return `pj_${Date.now().toString(36)}_${jobCounter.toString(36)}`;
}

function jobSnapshot(job: Job) {
  return {
    jobId: job.jobId,
    command: job.command,
    cwd: job.cwd,
    status: job.status,
    exitCode: job.exitCode,
    signal: job.signal,
    startedAt: new Date(job.startedAt).toISOString(),
    elapsedMs: (job.endedAt ?? Date.now()) - job.startedAt,
    logPath: job.logPath,
    logBytes: job.bytesWritten,
    keep: job.keep,
    ...(job.pid !== undefined ? { pid: job.pid } : {}),
    ...(job.stopSignal ? { stopSignal: job.stopSignal } : {}),
  };
}

class RedactingLogWriter {
  private carry = "";
  private fd: number | null = null;
  private bytes = 0;
  private readonly logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  get bytesWritten(): number {
    return this.bytes;
  }

  open(): void {
    if (this.fd !== null) return;
    mkdirSync(dirname(this.logPath), { recursive: true });
    this.fd = openSync(this.logPath, "w");
  }

  append(chunk: string): void {
    if (!chunk) return;
    const combined = this.carry + chunk;
    // Flush complete lines immediately so live logs are readable; keep only
    // a bounded carry for redaction context.
    const lineBoundary = combined.lastIndexOf("\n") + 1;
    const flushLength = Math.max(lineBoundary, combined.length - REDACTION_CARRY_CHARS, 0);
    if (flushLength <= 0) {
      this.carry = combined;
      return;
    }
    this.write(redactSecrets(combined.slice(0, flushLength)));
    this.carry = combined.slice(flushLength);
  }

  close(): void {
    if (this.carry) {
      this.write(redactSecrets(this.carry));
      this.carry = "";
    }
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
  }

  private write(text: string): void {
    if (!text || this.fd === null) return;
    const buffer = Buffer.from(text, "utf-8");
    writeSync(this.fd, buffer);
    this.bytes += buffer.length;
  }
}

function killProcessTree(pid: number | undefined, signal: NodeJS.Signals): boolean {
  if (!pid || process.platform === "win32") return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** Stop jobs from sessions other than the active one, unless marked keep. */
function sweepOtherSessions(activeSessionId: string): number {
  let swept = 0;
  for (const job of jobs.values()) {
    if (job.status !== "running" || job.keep || job.sessionId === activeSessionId) continue;
    requestStop(job);
    swept += 1;
  }
  return swept;
}

function requestStop(job: Job): void {
  if (job.status !== "running") return;
  job.stopSignal = "SIGTERM";
  const stopped = killProcessTree(job.pid, "SIGTERM");
  if (!stopped && job.child) job.child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (job.status !== "running") return;
    job.stopSignal = "SIGKILL";
    const killed = killProcessTree(job.pid, "SIGKILL");
    if (!killed && job.child) job.child.kill("SIGKILL");
  }, STOP_GRACE_MS);
  timer.unref();
}

export const processTool: ToolDefinition<ProcessArgs> = {
  name: "process",
  label: "process",
  description:
    "Manage long-running background processes with explicit lifecycle control. start launches a command and returns a stable job id; status reports running/exited state, exit code, timing, and output size; logs returns a bounded redacted tail; stop terminates gracefully then forcefully (the signal is disclosed); list shows this session's jobs. Jobs survive the originating call and are swept when the session ends unless keep is set. Starting a process requires the same command approval as bash.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start", "status", "logs", "stop", "list"],
        description: "Lifecycle action to perform.",
      },
      command: {
        type: "string",
        description: "Command to run. Required for start.",
      },
      cwd: {
        type: "string",
        description: "Working directory for the job, relative to the project root. Defaults to the project root.",
      },
      env: {
        type: "object",
        description: "Optional extra environment variables for the job.",
      },
      jobId: {
        type: "string",
        description: "Job id returned by start. Required for status, logs, and stop.",
      },
      logPath: {
        type: "string",
        description: "Optional custom log file path for the job output.",
      },
      keep: {
        type: "boolean",
        description: "Keep the job alive across session boundaries. Default false.",
      },
      tailLines: {
        type: "number",
        description: `For logs: how many trailing lines to return. Defaults to ${DEFAULT_LOG_TAIL_LINES}.`,
      },
    },
    required: ["action"],
  },
  toolType: "function",
  semantics: { effects: ["execute"], parallelSafe: false, restrictedMode: "deny" },

  async execute(args: ProcessArgs, context: ToolContext, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) {
      return createToolErrorResult({
        code: "process_aborted",
        category: "aborted",
        message: "Operation aborted.",
        nextAction: "Check the job state before retrying.",
        fingerprint: "aborted:process_aborted",
      });
    }

    switch (args.action) {
      case "start":
        return startJob(args, context);
      case "status":
        return jobStatus(args);
      case "logs":
        return jobLogs(args);
      case "stop":
        return stopJob(args);
      case "list":
        return listJobs(context);
      default:
        return createToolErrorResult({
          code: "process_invalid_action",
          category: "validation",
          message: `Unknown process action: ${String(args.action)}.`,
          nextAction: "Use one of start, status, logs, stop, list.",
          fingerprint: "validation:process_invalid_action",
        });
    }
  },
};

function startJob(args: ProcessArgs, context: ToolContext): ToolResult {
  const command = args.command?.trim();
  if (!command) {
    return createToolErrorResult({
      code: "process_missing_command",
      category: "validation",
      message: "process start requires a non-empty command string.",
      nextAction: "Provide command, e.g. {\"action\":\"start\",\"command\":\"bun run dev\"}.",
      fingerprint: "validation:process_missing_command",
    });
  }

  const jobCwd = resolve(context.cwd, args.cwd ?? ".");
  if (jobCwd !== context.cwd && !jobCwd.startsWith(`${context.cwd}/`)) {
    return createToolErrorResult({
      code: "process_cwd_outside_project",
      category: "validation",
      message: `process cwd must stay inside the project: ${args.cwd}`,
      nextAction: "Use a cwd relative to the project root.",
      fingerprint: "validation:process_cwd_outside_project",
    });
  }

  const jobId = createJobId();
  const logPath = args.logPath
    ? resolve(context.cwd, args.logPath)
    : resolve(context.cwd, ".soba", "process-logs", `${jobId}.log`);
  if (logPath !== context.cwd && !logPath.startsWith(`${context.cwd}/`)) {
    return createToolErrorResult({
      code: "process_log_outside_project",
      category: "validation",
      message: `process logPath must stay inside the project: ${args.logPath}`,
      nextAction: "Use a log path relative to the project root.",
      fingerprint: "validation:process_log_outside_project",
    });
  }

  let writer: RedactingLogWriter;
  try {
    writer = new RedactingLogWriter(logPath);
    writer.open();
  } catch (error) {
    return createToolErrorResult({
      code: "process_log_open_failed",
      category: "filesystem",
      message: `Cannot open process log at ${logPath}: ${error instanceof Error ? error.message : String(error)}`,
      nextAction: "Choose a writable logPath inside the project.",
      fingerprint: "filesystem:process_log_open_failed",
    });
  }

  const child = spawn("/bin/sh", ["-c", command], {
    cwd: jobCwd,
    env: { ...process.env, ...(args.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  const job: Job = {
    jobId,
    sessionId: context.sessionId ?? "default",
    command,
    cwd: jobCwd,
    logPath,
    keep: args.keep === true,
    startedAt: Date.now(),
    status: "running",
    exitCode: null,
    signal: null,
    pid: child.pid,
    child,
    bytesWritten: 0,
  };
  jobs.set(jobId, job);

  child.stdout?.on("data", (data: Buffer) => writer.append(data.toString()));
  child.stderr?.on("data", (data: Buffer) => writer.append(data.toString()));
  child.on("error", (error) => {
    job.status = "exited";
    job.endedAt = Date.now();
    writer.append(`\n[process spawn error: ${error.message}]\n`);
    writer.close();
    job.bytesWritten = writer.bytesWritten;
  });
  child.on("close", (code, childSignal) => {
    job.status = "exited";
    job.exitCode = code;
    job.signal = childSignal;
    job.endedAt = Date.now();
    writer.close();
    job.bytesWritten = writer.bytesWritten;
  });
  child.unref();

  return {
    content: [{
      type: "text",
      text: `Started job ${jobId} (pid ${child.pid ?? "unknown"}): ${command}\nLog: ${logPath}`,
    }],
    isError: false,
    details: {
      job: jobSnapshot(job),
      ...(args.keep === true ? { keep: true } : {}),
    },
  };
}

function requireJob(args: ProcessArgs): { job: Job } | { error: ToolResult } {
  if (!args.jobId) {
    return {
      error: createToolErrorResult({
        code: "process_missing_job_id",
        category: "validation",
        message: `process ${args.action} requires a jobId.`,
        nextAction: "Use process list to see job ids from this session.",
        fingerprint: "validation:process_missing_job_id",
      }),
    };
  }
  const job = jobs.get(args.jobId);
  if (!job) {
    return {
      error: createToolErrorResult({
        code: "process_unknown_job",
        category: "validation",
        message: `No such job: ${args.jobId}.`,
        nextAction: "Use process list to see job ids from this session.",
        fingerprint: "validation:process_unknown_job",
      }),
    };
  }
  return { job };
}

function jobStatus(args: ProcessArgs): ToolResult {
  const resolved = requireJob(args);
  if ("error" in resolved) return resolved.error;
  return {
    content: [{ type: "text", text: formatJobStatus(resolved.job) }],
    isError: false,
    details: { job: jobSnapshot(resolved.job) },
  };
}

function formatJobStatus(job: Job): string {
  const snapshot = jobSnapshot(job);
  return [
    `job ${snapshot.jobId}: ${snapshot.status}`,
    `command: ${snapshot.command}`,
    `started: ${snapshot.startedAt} (elapsed ${snapshot.elapsedMs}ms)`,
    `exitCode: ${snapshot.exitCode ?? "n/a"}${snapshot.signal ? ` signal: ${snapshot.signal}` : ""}`,
    `log: ${snapshot.logPath} (${snapshot.logBytes} bytes)`,
  ].join("\n");
}

function jobLogs(args: ProcessArgs): ToolResult {
  const resolved = requireJob(args);
  if ("error" in resolved) return resolved.error;
  const job = resolved.job;

  let raw: string;
  try {
    raw = readFileSync(job.logPath, "utf-8");
  } catch {
    raw = "";
  }

  const tailLines = normalizeTailLines(args.tailLines);
  const lines = raw.split("\n");
  const sliced = lines.length > tailLines ? lines.slice(-tailLines) : lines;
  const truncated = truncateOutput(sliced.join("\n"), tailLines, MAX_LOG_BYTES);

  return {
    content: [{
      type: "text",
      text: [
        `[process logs] job ${job.jobId} (${job.status}) last ${sliced.length} line(s)${lines.length > tailLines ? ` of ${lines.length}` : ""}${truncated.truncated ? "; output truncated" : ""}:`,
        truncated.text || "(no output yet)",
      ].join("\n"),
    }],
    isError: false,
    details: {
      jobId: job.jobId,
      status: job.status,
      logBytes: job.bytesWritten,
      truncated: truncated.truncated || lines.length > tailLines,
    },
  };
}

function stopJob(args: ProcessArgs): ToolResult {
  const resolved = requireJob(args);
  if ("error" in resolved) return resolved.error;
  const job = resolved.job;

  if (job.status === "exited") {
    return {
      content: [{
        type: "text",
        text: `Job ${job.jobId} already exited (code ${job.exitCode ?? "n/a"}${job.signal ? `, signal ${job.signal}` : ""}).`,
      }],
      isError: false,
      details: { job: jobSnapshot(job) },
    };
  }

  requestStop(job);
  return {
    content: [{
      type: "text",
      text: `Stop requested for job ${job.jobId}: sent ${job.stopSignal ?? "SIGTERM"}; forceful SIGKILL follows after ${STOP_GRACE_MS}ms if it does not exit.`,
    }],
    isError: false,
    details: { job: jobSnapshot(job) },
  };
}

function listJobs(context: ToolContext): ToolResult {
  const swept = sweepOtherSessions(context.sessionId ?? "default");
  const sessionId = context.sessionId ?? "default";
  const sessionJobs = [...jobs.values()]
    .filter((job) => job.sessionId === sessionId)
    .sort((a, b) => a.startedAt - b.startedAt);

  if (sessionJobs.length === 0) {
    return {
      content: [{ type: "text", text: `No jobs for session ${sessionId}.${swept > 0 ? ` Swept ${swept} job(s) from ended sessions.` : ""}` }],
      isError: false,
      details: { jobs: [], swept },
    };
  }

  const lines = sessionJobs.map((job) => {
    const snapshot = jobSnapshot(job);
    return `  ${snapshot.jobId} [${snapshot.status}] ${snapshot.command} (elapsed ${snapshot.elapsedMs}ms, log ${snapshot.logBytes}B)`;
  });
  return {
    content: [{
      type: "text",
      text: [`Jobs for session ${sessionId}:`, ...lines, ...(swept > 0 ? [`Swept ${swept} job(s) from ended sessions.`] : [])].join("\n"),
    }],
    isError: false,
    details: { jobs: sessionJobs.map(jobSnapshot), swept },
  };
}

function normalizeTailLines(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LOG_TAIL_LINES;
  return Math.max(1, Math.min(MAX_LOG_TAIL_LINES, Math.floor(value)));
}
