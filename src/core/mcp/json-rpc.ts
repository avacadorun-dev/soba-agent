export const JSON_RPC_VERSION = "2.0";

export const JSON_RPC_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  requestTimeout: -32000,
  requestCancelled: -32001,
  unknownResponseId: -32002,
} as const;

export type JsonRpcId = string | number;
export type JsonRpcParams = Record<string, unknown> | unknown[];

export interface JsonRpcRequest {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId;
  method: string;
  params?: JsonRpcParams;
}

export interface JsonRpcNotification {
  jsonrpc: typeof JSON_RPC_VERSION;
  method: string;
  params?: JsonRpcParams;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId | null;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;
export type JsonRpcOutgoingMessage = JsonRpcMessage;

export interface JsonRpcRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface JsonRpcEndpointOptions {
  send: (message: JsonRpcOutgoingMessage, options?: JsonRpcRequestOptions) => void | Promise<void>;
  onNotification?: (notification: JsonRpcNotification) => void;
  onRequest?: (request: JsonRpcRequest) => unknown | Promise<unknown>;
  onProtocolError?: (error: JsonRpcProtocolError) => void;
  defaultTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  abortHandler?: () => void;
  signal?: AbortSignal;
}

export class JsonRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  readonly rpcId: JsonRpcId | null;

  constructor(error: JsonRpcErrorObject, rpcId: JsonRpcId | null = null) {
    super(error.message);
    this.name = "JsonRpcError";
    this.code = error.code;
    this.data = error.data;
    this.rpcId = rpcId;
  }
}

export class JsonRpcProtocolError extends Error {
  readonly code: number;
  readonly data?: unknown;
  readonly rpcId: JsonRpcId | null;

  constructor(error: JsonRpcErrorObject, rpcId: JsonRpcId | null = null) {
    super(error.message);
    this.name = "JsonRpcProtocolError";
    this.code = error.code;
    this.data = error.data;
    this.rpcId = rpcId;
  }
}

export class JsonRpcEndpoint {
  private readonly sendMessage: (message: JsonRpcOutgoingMessage, options?: JsonRpcRequestOptions) => void | Promise<void>;
  private readonly onNotification?: (notification: JsonRpcNotification) => void;
  private readonly onRequest?: (request: JsonRpcRequest) => unknown | Promise<unknown>;
  private readonly onProtocolError?: (error: JsonRpcProtocolError) => void;
  private readonly defaultTimeoutMs: number;
  private readonly pending = new Map<string, PendingRequest>();
  private nextId = 1;

  constructor(options: JsonRpcEndpointOptions) {
    this.sendMessage = options.send;
    this.onNotification = options.onNotification;
    this.onRequest = options.onRequest;
    this.onProtocolError = options.onProtocolError;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  request(method: string, params?: JsonRpcParams, options: JsonRpcRequestOptions = {}): Promise<unknown> {
    const id = this.nextRequestId();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const request = withOptionalParams({
      jsonrpc: JSON_RPC_VERSION,
      id,
      method,
      params,
    });

    return new Promise<unknown>((resolve, reject) => {
      const key = idKey(id);
      const timeout = setTimeout(() => {
        this.rejectPending(
          id,
          new JsonRpcError(
            {
              code: JSON_RPC_ERROR_CODES.requestTimeout,
              message: `JSON-RPC request "${method}" timed out after ${timeoutMs}ms.`,
            },
            id,
          ),
        );
      }, timeoutMs);

      const pending: PendingRequest = {
        resolve,
        reject,
        timeout,
        signal: options.signal,
      };

      if (options.signal) {
        if (options.signal.aborted) {
          clearTimeout(timeout);
          reject(
            new JsonRpcError(
              {
                code: JSON_RPC_ERROR_CODES.requestCancelled,
                message: `JSON-RPC request "${method}" was cancelled.`,
              },
              id,
            ),
          );
          return;
        }

        pending.abortHandler = () => {
          this.rejectPending(
            id,
            new JsonRpcError(
              {
                code: JSON_RPC_ERROR_CODES.requestCancelled,
                message: `JSON-RPC request "${method}" was cancelled.`,
              },
              id,
            ),
          );
        };
        options.signal.addEventListener("abort", pending.abortHandler, { once: true });
      }

      this.pending.set(key, pending);

      void this.sendOutgoing(request, options).catch((error: unknown) => {
        this.rejectPending(id, toError(error));
      });
    });
  }

  notify(method: string, params?: JsonRpcParams): void {
    void this.sendOutgoing(
      withOptionalParams({
        jsonrpc: JSON_RPC_VERSION,
        method,
        params,
      }),
    ).catch((error: unknown) => this.emitSendError(error));
  }

  receive(input: string | unknown): void {
    const parsed = typeof input === "string" ? parseJsonRpcInput(input) : input;
    if (parsed instanceof JsonRpcProtocolError) {
      this.emitProtocolError(parsed);
      void this.sendOutgoing(errorResponse(null, parsed)).catch((error: unknown) => this.emitSendError(error));
      return;
    }

    const message = parseJsonRpcMessage(parsed);
    if (message instanceof JsonRpcProtocolError) {
      this.emitProtocolError(message);
      if (isRequestLike(parsed)) {
        void this.sendOutgoing(errorResponse(extractId(parsed), message)).catch((error: unknown) => this.emitSendError(error));
      }
      return;
    }

    if (isJsonRpcResponse(message)) {
      this.handleResponse(message);
      return;
    }

    if (isJsonRpcRequest(message)) {
      this.handleRequest(message);
      return;
    }

    this.onNotification?.(message);
  }

  close(reason = "JSON-RPC endpoint closed."): void {
    const entries = Array.from(this.pending.entries());
    this.pending.clear();

    for (const [, pending] of entries) {
      this.cleanupPending(pending);
      pending.reject(
        new JsonRpcError({
          code: JSON_RPC_ERROR_CODES.requestCancelled,
          message: reason,
        }),
      );
    }
  }

  private nextRequestId(): JsonRpcId {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  private handleResponse(response: JsonRpcResponse): void {
    if (response.id === null) {
      this.emitProtocolError(
        new JsonRpcProtocolError({
          code: JSON_RPC_ERROR_CODES.unknownResponseId,
          message: "JSON-RPC response id cannot be null for pending request correlation.",
        }),
      );
      return;
    }

    const pending = this.pending.get(idKey(response.id));
    if (!pending) {
      this.emitProtocolError(
        new JsonRpcProtocolError(
          {
            code: JSON_RPC_ERROR_CODES.unknownResponseId,
            message: `JSON-RPC response id "${String(response.id)}" does not match a pending request.`,
          },
          response.id,
        ),
      );
      return;
    }

    this.pending.delete(idKey(response.id));
    this.cleanupPending(pending);

    if ("error" in response) {
      pending.reject(new JsonRpcError(normalizeJsonRpcErrorObject(response.error), response.id));
      return;
    }

    pending.resolve(response.result);
  }

  private handleRequest(request: JsonRpcRequest): void {
    if (!this.onRequest) {
      void this.sendOutgoing(
        errorResponse(request.id, {
          code: JSON_RPC_ERROR_CODES.methodNotFound,
          message: `JSON-RPC method "${request.method}" is not supported.`,
        }),
      ).catch((error: unknown) => this.emitSendError(error));
      return;
    }

    void Promise.resolve()
      .then(() => this.onRequest?.(request))
      .then((result) => {
        void this.sendOutgoing({
          jsonrpc: JSON_RPC_VERSION,
          id: request.id,
          result,
        }).catch((error: unknown) => this.emitSendError(error));
      })
      .catch((error: unknown) => {
        const normalized = error instanceof JsonRpcError ? errorToObject(error) : internalErrorObject(toError(error).message);
        void this.sendOutgoing(errorResponse(request.id, normalized)).catch((sendError: unknown) => this.emitSendError(sendError));
      });
  }

  private sendOutgoing(message: JsonRpcOutgoingMessage, options?: JsonRpcRequestOptions): Promise<void> {
    try {
      return Promise.resolve(this.sendMessage(message, options));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private rejectPending(id: JsonRpcId, error: Error): void {
    const key = idKey(id);
    const pending = this.pending.get(key);
    if (!pending) {
      return;
    }

    this.pending.delete(key);
    this.cleanupPending(pending);
    pending.reject(error);
  }

  private cleanupPending(pending: PendingRequest): void {
    clearTimeout(pending.timeout);
    if (pending.signal && pending.abortHandler) {
      pending.signal.removeEventListener("abort", pending.abortHandler);
    }
  }

  private emitProtocolError(error: JsonRpcProtocolError): void {
    this.onProtocolError?.(error);
  }

  private emitSendError(error: unknown): void {
    this.emitProtocolError(new JsonRpcProtocolError(internalErrorObject(toError(error).message)));
  }
}

export class JsonRpcLineFramer {
  private buffer = "";

  push(chunk: string | Uint8Array): string[] {
    this.buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);

    const messages: string[] = [];
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        messages.push(line);
      }
    }

    return messages;
  }

  flush(): string | null {
    if (this.buffer.length === 0) {
      return null;
    }

    const message = this.buffer.replace(/\r$/, "");
    this.buffer = "";
    return message.length > 0 ? message : null;
  }

  format(message: JsonRpcOutgoingMessage): string {
    return `${JSON.stringify(message)}\n`;
  }
}

export function normalizeJsonRpcErrorObject(value: unknown): JsonRpcErrorObject {
  if (!isRecord(value)) {
    return internalErrorObject("JSON-RPC error must be an object.");
  }

  const code = typeof value.code === "number" && Number.isInteger(value.code) ? value.code : JSON_RPC_ERROR_CODES.internalError;
  const message = typeof value.message === "string" && value.message.length > 0 ? value.message : "JSON-RPC error.";

  if ("data" in value) {
    return {
      code,
      message,
      data: value.data,
    };
  }

  return {
    code,
    message,
  };
}

function parseJsonRpcInput(input: string): unknown | JsonRpcProtocolError {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return new JsonRpcProtocolError({
      code: JSON_RPC_ERROR_CODES.parseError,
      message: "Malformed JSON-RPC message: invalid JSON.",
    });
  }
}

function parseJsonRpcMessage(value: unknown): JsonRpcMessage | JsonRpcProtocolError {
  if (Array.isArray(value)) {
    return new JsonRpcProtocolError({
      code: JSON_RPC_ERROR_CODES.invalidRequest,
      message: "JSON-RPC batch messages are not supported.",
    });
  }

  if (!isRecord(value) || value.jsonrpc !== JSON_RPC_VERSION) {
    return new JsonRpcProtocolError({
      code: JSON_RPC_ERROR_CODES.invalidRequest,
      message: "JSON-RPC message must be an object with jsonrpc: \"2.0\".",
    });
  }

  if ("method" in value) {
    return parseRequestOrNotification(value);
  }

  return parseResponse(value);
}

function parseRequestOrNotification(value: Record<string, unknown>): JsonRpcRequest | JsonRpcNotification | JsonRpcProtocolError {
  if (typeof value.method !== "string" || value.method.length === 0) {
    return new JsonRpcProtocolError({
      code: JSON_RPC_ERROR_CODES.invalidRequest,
      message: "JSON-RPC request method must be a non-empty string.",
    });
  }

  if ("params" in value && !isJsonRpcParams(value.params)) {
    return new JsonRpcProtocolError({
      code: JSON_RPC_ERROR_CODES.invalidParams,
      message: "JSON-RPC params must be an object or an array when provided.",
    });
  }

  if (!("id" in value)) {
    return withOptionalParams({
      jsonrpc: JSON_RPC_VERSION,
      method: value.method,
      params: value.params as JsonRpcParams | undefined,
    });
  }

  if (!isJsonRpcId(value.id)) {
    return new JsonRpcProtocolError({
      code: JSON_RPC_ERROR_CODES.invalidRequest,
      message: "JSON-RPC request id must be a string or number.",
    });
  }

  return withOptionalParams({
    jsonrpc: JSON_RPC_VERSION,
    id: value.id,
    method: value.method,
    params: value.params as JsonRpcParams | undefined,
  });
}

function parseResponse(value: Record<string, unknown>): JsonRpcResponse | JsonRpcProtocolError {
  if (!("id" in value) || !(isJsonRpcId(value.id) || value.id === null)) {
    return new JsonRpcProtocolError({
      code: JSON_RPC_ERROR_CODES.invalidRequest,
      message: "JSON-RPC response id must be a string, number or null.",
    });
  }

  const hasResult = "result" in value;
  const hasError = "error" in value;
  if (hasResult === hasError) {
    return new JsonRpcProtocolError({
      code: JSON_RPC_ERROR_CODES.invalidRequest,
      message: "JSON-RPC response must contain exactly one of result or error.",
    });
  }

  if (hasError) {
    return {
      jsonrpc: JSON_RPC_VERSION,
      id: value.id,
      error: normalizeJsonRpcErrorObject(value.error),
    };
  }

  return {
    jsonrpc: JSON_RPC_VERSION,
    id: value.id,
    result: value.result,
  };
}

function errorResponse(id: JsonRpcId | null, error: JsonRpcErrorObject | JsonRpcProtocolError): JsonRpcErrorResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: error instanceof JsonRpcProtocolError ? errorToObject(error) : normalizeJsonRpcErrorObject(error),
  };
}

function internalErrorObject(message: string): JsonRpcErrorObject {
  return {
    code: JSON_RPC_ERROR_CODES.internalError,
    message,
  };
}

function errorToObject(error: JsonRpcError | JsonRpcProtocolError): JsonRpcErrorObject {
  if (error.data !== undefined) {
    return {
      code: error.code,
      message: error.message,
      data: error.data,
    };
  }

  return {
    code: error.code,
    message: error.message,
  };
}

function withOptionalParams<T extends JsonRpcRequest | JsonRpcNotification>(message: T): T {
  if (message.params === undefined) {
    const { params: _params, ...withoutParams } = message;
    return withoutParams as T;
  }

  return message;
}

function isJsonRpcResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return "result" in message || "error" in message;
}

function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "id" in message && "method" in message;
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

function isJsonRpcParams(value: unknown): value is JsonRpcParams {
  return Array.isArray(value) || isRecord(value);
}

function isRequestLike(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && "id" in value;
}

function extractId(value: Record<string, unknown>): JsonRpcId | null {
  return isJsonRpcId(value.id) ? value.id : null;
}

function idKey(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`;
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
