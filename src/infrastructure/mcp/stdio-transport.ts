import { JsonRpcLineFramer, type JsonRpcOutgoingMessage } from "./json-rpc";
import {
  type McpTransport,
  type McpTransportDiagnostics,
  McpTransportError,
  type McpTransportEvent,
  type McpTransportEventHandler,
  raceWithTransportAbort,
  throwIfTransportAborted,
} from "./transport";

export const DEFAULT_MCP_STDIO_SHUTDOWN_TIMEOUT_MS = 1_000;

export type McpStdioTransportStatus = "idle" | "running" | "stopping" | "closed";

export interface McpStdioTransportOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  shutdownTimeoutMs?: number;
  onMessage: (message: string) => void;
  onStderr?: (chunk: string) => void;
  onError?: (error: McpStdioTransportError) => void;
  onEvent?: McpTransportEventHandler;
}

export interface McpStdioStartOptions {
  signal?: AbortSignal;
}

export interface McpStdioSendOptions {
  signal?: AbortSignal;
}

export interface McpStdioShutdownOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface McpStdioExit {
  code: number;
  forced: boolean;
}

export type McpStdioTransportErrorCode =
  | "spawn_failed"
  | "not_running"
  | "broken_pipe"
  | "process_exit"
  | "aborted"
  | "shutdown_timeout";

export class McpStdioTransportError extends McpTransportError {
  readonly code: McpStdioTransportErrorCode;
  readonly exitCode?: number;

  constructor(code: McpStdioTransportErrorCode, message: string, options: { cause?: unknown; exitCode?: number } = {}) {
    super(code, message, { kind: "stdio", cause: options.cause });
    this.name = "McpStdioTransportError";
    this.code = code;
    this.exitCode = options.exitCode;
  }
}

export class McpStdioTransport implements McpTransport {
  readonly kind = "stdio";
  private readonly options: Required<Pick<McpStdioTransportOptions, "shutdownTimeoutMs">> & McpStdioTransportOptions;
  private readonly framer = new JsonRpcLineFramer();
  private process: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private statusValue: McpStdioTransportStatus = "idle";
  private lastError: string | undefined;
  private forcedKill = false;
  private exitPromise: Promise<McpStdioExit> | null = null;
  private stdoutTask: Promise<void> | null = null;
  private stderrTask: Promise<void> | null = null;

  constructor(options: McpStdioTransportOptions) {
    this.options = {
      ...options,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? DEFAULT_MCP_STDIO_SHUTDOWN_TIMEOUT_MS,
    };
  }

  get status(): McpStdioTransportStatus {
    return this.statusValue;
  }

  get pid(): number | null {
    return this.process?.pid ?? null;
  }

  diagnostics(): McpTransportDiagnostics {
    const diagnostics: McpTransportDiagnostics = {
      kind: this.kind,
      state: this.toTransportState(),
    };

    if (this.process?.pid) {
      diagnostics.pid = this.process.pid;
    }
    if (this.lastError) {
      diagnostics.lastError = this.lastError;
    }

    return diagnostics;
  }

  start(options: McpStdioStartOptions = {}): void {
    throwIfTransportAborted(options.signal, this.kind);

    if (this.statusValue === "running" || this.statusValue === "stopping") {
      throw new McpStdioTransportError("not_running", "MCP stdio transport is already running.");
    }

    const command = [this.options.command, ...(this.options.args ?? [])];
    this.forcedKill = false;
    this.lastError = undefined;
    try {
      this.process = Bun.spawn(command, {
        cwd: this.options.cwd,
        env: this.options.env ? { ...process.env, ...this.options.env } : process.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      const wrapped = new McpStdioTransportError("spawn_failed", `Failed to start MCP stdio process: ${this.options.command}.`, {
        cause: error,
      });
      this.emitError(wrapped);
      this.setStatus("closed");
      throw wrapped;
    }

    this.setStatus("running");
    this.stdoutTask = this.readStdout(this.process.stdout);
    this.stderrTask = this.readStderr(this.process.stderr);
    this.exitPromise = this.watchExit(this.process);
  }

  async send(message: JsonRpcOutgoingMessage, options: McpStdioSendOptions = {}): Promise<void> {
    throwIfTransportAborted(options.signal, this.kind);

    if (!this.process || this.statusValue !== "running") {
      throw new McpStdioTransportError("not_running", "MCP stdio transport is not running.");
    }

    try {
      this.process.stdin.write(this.framer.format(message));
      await raceWithTransportAbort(Promise.resolve(this.process.stdin.flush()), options.signal, this.kind);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const wrapped = new McpStdioTransportError("broken_pipe", "Failed to write JSON-RPC message to MCP stdio process.", {
        cause: error,
      });
      this.emitError(wrapped);
      throw wrapped;
    }
  }

  close(options: McpStdioShutdownOptions = {}): Promise<McpStdioExit> {
    return this.shutdown(options);
  }

  async shutdown(options: McpStdioShutdownOptions = {}): Promise<McpStdioExit> {
    const processRef = this.process;
    if (!processRef) {
      this.setStatus("closed");
      return {
        code: 0,
        forced: false,
      };
    }

    if (this.statusValue === "closed") {
      return this.waitForExit();
    }

    this.setStatus("stopping");

    try {
      await raceWithTransportAbort(Promise.resolve(processRef.stdin.end()), options.signal, this.kind);
    } catch (error) {
      if (isAbortError(error)) {
        this.killProcess(processRef, "SIGKILL");
        await this.waitForExit();
        throw error;
      }
    }

    const timeoutMs = options.timeoutMs ?? this.options.shutdownTimeoutMs;
    try {
      return await raceWithTransportAbort(this.waitForExitWithTimeout(timeoutMs), options.signal, this.kind);
    } catch (error) {
      if (isAbortError(error)) {
        this.killProcess(processRef, "SIGKILL");
        await this.waitForExit();
        throw error;
      }

      this.forcedKill = true;
      this.killProcess(processRef, "SIGKILL");
      return this.waitForExit();
    }
  }

  waitForExit(): Promise<McpStdioExit> {
    if (!this.exitPromise) {
      return Promise.resolve({
        code: 0,
        forced: false,
      });
    }

    return this.exitPromise;
  }

  private async readStdout(stream: ReadableStream<Uint8Array<ArrayBuffer>>): Promise<void> {
    const reader = stream.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          break;
        }

        for (const message of this.framer.push(result.value)) {
          this.options.onMessage(message);
          this.emit({ type: "message", message });
        }
      }

      const tail = this.framer.flush();
      if (tail) {
        this.options.onMessage(tail);
        this.emit({ type: "message", message: tail });
      }
    } catch (error) {
      this.emitError(
        new McpStdioTransportError("process_exit", "Failed while reading MCP stdio stdout.", {
          cause: error,
        }),
      );
    } finally {
      reader.releaseLock();
    }
  }

  private async readStderr(stream: ReadableStream<Uint8Array<ArrayBuffer>>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          break;
        }

        const chunk = decoder.decode(result.value, { stream: true });
        this.options.onStderr?.(chunk);
        this.emit({ type: "log", level: "info", message: chunk });
      }

      const tail = decoder.decode();
      if (tail.length > 0) {
        this.options.onStderr?.(tail);
        this.emit({ type: "log", level: "info", message: tail });
      }
    } catch (error) {
      this.emitError(
        new McpStdioTransportError("process_exit", "Failed while reading MCP stdio stderr.", {
          cause: error,
        }),
      );
    } finally {
      reader.releaseLock();
    }
  }

  private async watchExit(processRef: Bun.Subprocess<"pipe", "pipe", "pipe">): Promise<McpStdioExit> {
    const code = await processRef.exited;
    await Promise.allSettled([this.stdoutTask, this.stderrTask]);

    const exit = {
      code,
      forced: this.forcedKill,
    };

    const wasUnexpected = this.statusValue === "running" && code !== 0 && !this.forcedKill;
    this.setStatus("closed");

    if (wasUnexpected) {
      this.emitError(
        new McpStdioTransportError("process_exit", `MCP stdio process exited unexpectedly with code ${code}.`, {
          exitCode: code,
        }),
      );
    }

    return exit;
  }

  private waitForExitWithTimeout(timeoutMs: number): Promise<McpStdioExit> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new McpStdioTransportError("shutdown_timeout", `MCP stdio process did not exit within ${timeoutMs}ms.`));
      }, timeoutMs);

      void this.waitForExit()
        .then((exit) => {
          clearTimeout(timeout);
          resolve(exit);
        })
        .catch((error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private killProcess(processRef: Bun.Subprocess<"pipe", "pipe", "pipe">, signal: NodeJS.Signals): void {
    this.forcedKill = true;
    try {
      processRef.kill(signal);
    } catch {
      // Process may have exited between timeout/abort and kill.
    }
  }

  private setStatus(status: McpStdioTransportStatus): void {
    this.statusValue = status;
    this.emit({ type: "state", state: this.toTransportState() });
  }

  private toTransportState() {
    if (this.statusValue === "running") {
      return "running";
    }
    if (this.statusValue === "stopping") {
      return "stopping";
    }
    if (this.statusValue === "closed") {
      return "closed";
    }

    return "idle";
  }

  private emit(event: McpTransportEvent): void {
    this.options.onEvent?.(event);
  }

  private emitError(error: McpStdioTransportError): void {
    this.lastError = error.message;
    this.options.onError?.(error);
    this.emit({ type: "error", error });
  }
}

function isAbortError(error: unknown): error is McpTransportError {
  return error instanceof McpTransportError && error.code === "aborted";
}
