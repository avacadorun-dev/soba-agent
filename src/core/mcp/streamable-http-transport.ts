import { buildMcpAuthHeaders, isStaticMcpAuth, McpAuthConfigError } from "./auth";
import { McpHttpSession, McpHttpSessionError } from "./http-session";
import type { JsonRpcOutgoingMessage } from "./json-rpc";
import { redactMcpDiagnosticUrl, sanitizeMcpRemoteHeaders } from "./security";
import { type SseEvent, SseParser } from "./sse-parser";
import {
  type McpTransport,
  type McpTransportCloseOptions,
  type McpTransportDiagnostics,
  McpTransportError,
  type McpTransportEvent,
  type McpTransportEventHandler,
  type McpTransportSendOptions,
  type McpTransportStartOptions,
  type McpTransportState,
  throwIfTransportAborted,
} from "./transport";
import type { McpRemoteAuthConfig } from "./types";

export const STREAMABLE_HTTP_ACCEPT = "application/json, text/event-stream";
export const STREAMABLE_HTTP_LISTEN_ACCEPT = "text/event-stream";
const DEFAULT_FETCH: typeof fetch = Bun.fetch.bind(Bun);

export interface McpStreamableHttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
  auth?: McpRemoteAuthConfig;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onEvent?: McpTransportEventHandler;
}

export class McpStreamableHttpTransport implements McpTransport {
  readonly kind = "streamableHttp";
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly auth: McpRemoteAuthConfig;
  private readonly env: Record<string, string | undefined>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onEvent?: McpTransportEventHandler;
  private state: McpTransportState = "idle";
  private lastError: string | undefined;
  private lastEventId: string | undefined;
  private retryMs: number | undefined;
  private listenController: AbortController | null = null;
  private readonly session = new McpHttpSession();

  constructor(options: McpStreamableHttpTransportOptions) {
    this.url = options.url;
    this.headers = sanitizeMcpRemoteHeaders(options.headers ?? {});
    this.auth = options.auth ?? { type: "none" };
    this.env = options.env ?? process.env;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? DEFAULT_FETCH;
    this.onEvent = options.onEvent;
  }

  start(options: McpTransportStartOptions = {}): void {
    throwIfTransportAborted(options.signal, this.kind);
    if (this.state === "closed") {
      this.lastError = undefined;
    }
    this.setState("running");
  }

  async send(message: JsonRpcOutgoingMessage, options: McpTransportSendOptions = {}): Promise<void> {
    throwIfTransportAborted(options.signal, this.kind);
    if (this.state !== "running") {
      throw new McpTransportError("not_running", "MCP Streamable HTTP transport is not running.", { kind: this.kind });
    }

    const response = await this.post(message, options);
    if (isJsonRpcRequest(message)) {
      await this.handleRequestResponse(message, response);
      return;
    }

    await this.handleAcceptedResponse(response);
  }

  async close(options: McpTransportCloseOptions = {}): Promise<void> {
    this.listenController?.abort();
    this.listenController = null;
    await this.cleanupSession(options);
    this.setState("closed");
  }

  shutdown(options: McpTransportCloseOptions = {}): Promise<void> {
    return this.close(options);
  }

  diagnostics(): McpTransportDiagnostics {
    const diagnostics: McpTransportDiagnostics = {
      kind: this.kind,
      state: this.state,
      endpoint: redactMcpDiagnosticUrl(this.url),
    };
    if (this.lastError) {
      diagnostics.lastError = this.lastError;
    }
    if (this.lastEventId !== undefined) {
      diagnostics.lastEventId = this.lastEventId;
    }
    if (this.retryMs !== undefined) {
      diagnostics.retryMs = this.retryMs;
    }
    if (this.session.redacted !== null) {
      diagnostics.sessionId = this.session.redacted;
    }

    return diagnostics;
  }

  async listen(options: McpTransportStartOptions = {}): Promise<void> {
    throwIfTransportAborted(options.signal, this.kind);
    if (this.state !== "running" && this.state !== "listening") {
      throw new McpTransportError("not_running", "MCP Streamable HTTP transport is not running.", { kind: this.kind });
    }

    const controller = new AbortController();
    this.listenController = controller;
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });

    try {
      this.setState("listening");
      const response = await this.fetchImpl(this.url, {
        method: "GET",
        headers: this.listenHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleHttpError(response);
        return;
      }
      this.captureSession(response);
      this.assertEventStreamContentType(response);
      await this.readSseStream(response, { requireResponseId: null, allowEofBeforeResponse: true });
    } catch (error) {
      if (options.signal?.aborted || controller.signal.aborted || isTransportClosed(this.state)) {
        throw new McpTransportError("aborted", "MCP streamableHttp listen operation was aborted.", {
          kind: this.kind,
          cause: error,
        });
      }

      throw this.error("stream_error", `MCP Streamable HTTP listen stream failed for ${redactMcpDiagnosticUrl(this.url)}.`, error);
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (this.listenController === controller) {
        this.listenController = null;
      }
      if (this.state === "listening") {
        this.setState("running");
      }
    }
  }

  private async post(message: JsonRpcOutgoingMessage, options: McpTransportSendOptions): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });

    try {
      return await this.fetchImpl(this.url, {
        method: "POST",
        headers: this.postHeaders(),
        body: JSON.stringify(message),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof McpTransportError) {
        throw error;
      }
      if (timedOut) {
        throw this.error("timeout", `MCP Streamable HTTP request timed out after ${timeoutMs}ms.`, error);
      }
      if (options.signal?.aborted) {
        throw new McpTransportError("aborted", "MCP streamableHttp transport operation was aborted.", {
          kind: this.kind,
          cause: error,
        });
      }

      throw this.error("http_error", `MCP Streamable HTTP POST failed for ${redactMcpDiagnosticUrl(this.url)}.`, error);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  private async cleanupSession(options: McpTransportCloseOptions): Promise<void> {
    if (!this.session.active) {
      return;
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });

    try {
      const response = await this.fetchImpl(this.url, {
        method: "DELETE",
        headers: this.deleteHeaders(),
        signal: controller.signal,
      });

      if (response.ok || response.status === 405) {
        this.session.reset();
        return;
      }

      throw this.error("http_error", `MCP Streamable HTTP session cleanup failed with HTTP ${response.status}.`);
    } catch (error) {
      if (error instanceof McpTransportError) {
        throw error;
      }
      if (timedOut) {
        throw this.error("timeout", `MCP Streamable HTTP session cleanup timed out after ${timeoutMs}ms.`, error);
      }
      if (options.signal?.aborted) {
        throw new McpTransportError("aborted", "MCP streamableHttp session cleanup was aborted.", {
          kind: this.kind,
          cause: error,
        });
      }

      throw this.error("http_error", `MCP Streamable HTTP session cleanup failed for ${redactMcpDiagnosticUrl(this.url)}.`, error);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  private async handleRequestResponse(message: JsonRpcOutgoingMessage, response: Response): Promise<void> {
    if (!response.ok) {
      await this.handleHttpError(response);
      return;
    }
    this.captureSession(response);
    const contentType = response.headers.get("content-type") ?? "";
    if (isJsonContentType(contentType)) {
      this.emit({ type: "message", message: await readJson(response, this.kind) });
      return;
    }
    if (isEventStreamContentType(contentType)) {
      await this.readSseStream(response, { requireResponseId: jsonRpcRequestId(message), allowEofBeforeResponse: false });
      return;
    }

    this.throwInvalidContentType(contentType);
  }

  private async handleAcceptedResponse(response: Response): Promise<void> {
    if (response.status === 202) {
      this.captureSession(response);
      return;
    }
    if (!response.ok) {
      await this.handleHttpError(response);
      return;
    }

    throw this.error("invalid_response", `MCP Streamable HTTP expected 202 for notification/response POST, got ${response.status}.`);
  }

  private async handleHttpError(response: Response): Promise<void> {
    if (response.status === 401) {
      throw this.error("auth_required", this.authRequiredMessage());
    }
    if (response.status === 404 && this.session.active) {
      this.session.reset();
      throw this.error("session_expired", "MCP Streamable HTTP session expired; re-initialization required.");
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("application/json")) {
      const body = await readJson(response, this.kind);
      if (isJsonRpcErrorResponse(body)) {
        this.emit({ type: "message", message: body });
        return;
      }
    }

    throw this.error("http_error", `MCP Streamable HTTP POST failed with HTTP ${response.status}.`);
  }

  private assertEventStreamContentType(response: Response): void {
    const contentType = response.headers.get("content-type") ?? "";
    if (!isEventStreamContentType(contentType)) {
      throw this.error("invalid_response", `MCP Streamable HTTP expected text/event-stream response, got ${contentType || "missing content-type"}.`);
    }
  }

  private throwInvalidContentType(contentType: string): never {
    throw this.error(
      "invalid_response",
      `MCP Streamable HTTP expected application/json or text/event-stream response, got ${contentType || "missing content-type"}.`,
    );
  }

  private async readSseStream(
    response: Response,
    options: { requireResponseId: string | number | null; allowEofBeforeResponse: boolean },
  ): Promise<void> {
    if (!response.body) {
      throw this.error("stream_error", "MCP Streamable HTTP SSE response is missing a body stream.");
    }

    const parser = new SseParser();
    let receivedFinalResponse = options.requireResponseId === null;

    try {
      for await (const chunk of response.body) {
        for (const event of parser.push(chunk)) {
          if (this.handleSseEvent(event, options.requireResponseId)) {
            receivedFinalResponse = true;
          }
        }
      }

      for (const event of parser.flush()) {
        if (this.handleSseEvent(event, options.requireResponseId)) {
          receivedFinalResponse = true;
        }
      }
    } catch (error) {
      if (error instanceof McpTransportError) {
        throw error;
      }

      throw this.error("stream_error", "MCP Streamable HTTP SSE stream failed.", error);
    }

    if (!receivedFinalResponse && !options.allowEofBeforeResponse) {
      throw this.error("stream_error", "MCP Streamable HTTP SSE stream ended before the matching JSON-RPC response.");
    }
  }

  private handleSseEvent(event: SseEvent, requiredResponseId: string | number | null): boolean {
    if (event.id !== undefined) {
      this.lastEventId = event.id;
    }
    if (event.retry !== undefined) {
      this.retryMs = event.retry;
    }

    const message = parseSseJsonRpcMessage(event.data, this.kind);
    this.emit({ type: "message", message });
    return requiredResponseId !== null && isJsonRpcResponseForId(message, requiredResponseId);
  }

  private lastEventHeader(): Record<string, string> {
    return this.lastEventId !== undefined ? { "Last-Event-ID": this.lastEventId } : {};
  }

  private postHeaders(): Headers {
    const headers = new Headers(this.headers);
    headers.set("Accept", STREAMABLE_HTTP_ACCEPT);
    headers.set("Content-Type", "application/json");
    this.applyAuth(headers);
    this.session.apply(headers);
    return headers;
  }

  private listenHeaders(): Headers {
    const headers = new Headers(this.headers);
    headers.set("Accept", STREAMABLE_HTTP_LISTEN_ACCEPT);
    this.applyAuth(headers);
    this.session.apply(headers);
    for (const [key, value] of Object.entries(this.lastEventHeader())) {
      headers.set(key, value);
    }

    return headers;
  }

  private deleteHeaders(): Headers {
    const headers = new Headers(this.headers);
    this.applyAuth(headers);
    this.session.apply(headers);
    return headers;
  }

  private applyAuth(headers: Headers): void {
    let authHeaders: Headers;
    try {
      authHeaders = buildMcpAuthHeaders(this.auth, this.env);
    } catch (error) {
      if (error instanceof McpAuthConfigError) {
        throw this.error("auth_config_error", error.message, error);
      }

      throw error;
    }

    for (const [key, value] of authHeaders.entries()) {
      headers.set(key, value);
    }
  }

  private authRequiredMessage(): string {
    if (isStaticMcpAuth(this.auth)) {
      return "MCP Streamable HTTP server rejected static authentication; verify the configured MCP auth environment variable.";
    }

    return "MCP Streamable HTTP server requires authentication.";
  }

  private captureSession(response: Response): void {
    try {
      this.session.capture(response.headers);
    } catch (error) {
      if (error instanceof McpHttpSessionError) {
        throw this.error("invalid_response", error.message, error);
      }

      throw error;
    }
  }

  private setState(state: McpTransportState): void {
    this.state = state;
    this.emit({ type: "state", state });
  }

  private error(code: ConstructorParameters<typeof McpTransportError>[0], message: string, cause?: unknown): McpTransportError {
    const error = new McpTransportError(code, message, { kind: this.kind, cause });
    this.lastError = error.message;
    this.emit({ type: "error", error });
    return error;
  }

  private emit(event: McpTransportEvent): void {
    this.onEvent?.(event);
  }
}

async function readJson(response: Response, kind: "streamableHttp"): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new McpTransportError("invalid_response", "MCP Streamable HTTP response body must be valid JSON.", {
      kind,
      cause: error,
    });
  }
}

function isJsonRpcRequest(message: JsonRpcOutgoingMessage): message is JsonRpcOutgoingMessage & { id: string | number; method: string } {
  return "method" in message && "id" in message;
}

function isJsonRpcErrorResponse(value: unknown): boolean {
  return isRecord(value) && value.jsonrpc === "2.0" && isRecord(value.error);
}

function isJsonRpcResponseForId(value: unknown, id: string | number): boolean {
  return isRecord(value) && value.jsonrpc === "2.0" && value.id === id && ("result" in value || "error" in value);
}

function parseSseJsonRpcMessage(data: string, kind: "streamableHttp"): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch (error) {
    throw new McpTransportError("invalid_response", "MCP Streamable HTTP SSE data must be valid JSON.", {
      kind,
      cause: error,
    });
  }
}

function jsonRpcRequestId(message: JsonRpcOutgoingMessage): string | number | null {
  return isJsonRpcRequest(message) ? message.id : null;
}

function isJsonContentType(contentType: string): boolean {
  return contentType.toLowerCase().includes("application/json");
}

function isEventStreamContentType(contentType: string): boolean {
  return contentType.toLowerCase().includes("text/event-stream");
}

function isTransportClosed(state: McpTransportState): boolean {
  return state === "closed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
