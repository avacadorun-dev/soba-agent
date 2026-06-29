import type { JsonRpcOutgoingMessage } from "./json-rpc";

export type McpTransportKind = "stdio" | "streamableHttp" | "memory";
export type McpTransportState = "idle" | "starting" | "running" | "listening" | "stopping" | "closed" | "failed";

export interface McpTransportStartOptions {
  signal?: AbortSignal;
}

export interface McpTransportSendOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface McpTransportCloseOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface McpTransportDiagnostics {
  kind: McpTransportKind;
  state: McpTransportState;
  endpoint?: string;
  pid?: number;
  lastError?: string;
  lastEventId?: string;
  retryMs?: number;
  sessionId?: string;
}

export type McpTransportEvent =
  | { type: "message"; message: string | unknown }
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string }
  | { type: "state"; state: McpTransportState }
  | { type: "error"; error: McpTransportError };

export type McpTransportEventHandler = (event: McpTransportEvent) => void;

export type McpTransportErrorCode =
  | "spawn_failed"
  | "not_running"
  | "broken_pipe"
  | "process_exit"
  | "aborted"
  | "timeout"
  | "shutdown_timeout"
  | "http_error"
  | "auth_required"
  | "invalid_response"
  | "stream_error"
  | "session_expired"
  | "auth_config_error"
  | "closed"
  | "unsupported";

export class McpTransportError extends Error {
  readonly code: McpTransportErrorCode;
  readonly kind: McpTransportKind;
  readonly cause?: unknown;

  constructor(
    code: McpTransportErrorCode,
    message: string,
    options: { kind: McpTransportKind; cause?: unknown } = { kind: "stdio" },
  ) {
    super(message);
    this.name = "McpTransportError";
    this.code = code;
    this.kind = options.kind;
    this.cause = options.cause;
  }
}

export interface McpTransport {
  readonly kind: McpTransportKind;
  start(options?: McpTransportStartOptions): void | Promise<void>;
  send(message: JsonRpcOutgoingMessage, options?: McpTransportSendOptions): void | Promise<void>;
  listen?(options?: McpTransportStartOptions): void | Promise<void>;
  close(options?: McpTransportCloseOptions): Promise<unknown>;
  shutdown(options?: McpTransportCloseOptions): Promise<unknown>;
  diagnostics(): McpTransportDiagnostics;
}

export async function raceWithTransportAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  kind: McpTransportKind,
): Promise<T> {
  throwIfTransportAborted(signal, kind);

  if (!signal) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const abortHandler = () => {
      reject(createTransportAbortError(kind));
    };

    signal.addEventListener("abort", abortHandler, { once: true });
    void promise
      .then(resolve)
      .catch(reject)
      .finally(() => {
        signal.removeEventListener("abort", abortHandler);
      });
  });
}

export function throwIfTransportAborted(signal: AbortSignal | undefined, kind: McpTransportKind): void {
  if (signal?.aborted) {
    throw createTransportAbortError(kind);
  }
}

export function createTransportAbortError(kind: McpTransportKind): McpTransportError {
  return new McpTransportError("aborted", `MCP ${kind} transport operation was aborted.`, { kind });
}
