import type { SobaRuntime } from "../../application/acp/public";
import { AcpDispatcher, type AcpDispatcherOptions } from "./dispatcher";
import {
  isJsonRpcResponse,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_REQUEST_CANCELLED,
  JsonRpcError,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcResponse,
  type JsonValue,
  makeJsonRpcFailure,
  makeJsonRpcNotification,
  makeJsonRpcRequest,
  makeJsonRpcSuccess,
  parseJsonRpcMessage,
  serializeJsonRpc,
} from "./json-rpc";

export interface AcpServerOptions {
  runtime: SobaRuntime;
  cwd: string;
  input: AsyncIterable<string | Uint8Array>;
  writeStdout: (chunk: string) => void | Promise<void>;
  writeStderr?: (chunk: string) => void | Promise<void>;
  dispatcher?: AcpDispatcher;
  agentInfo?: AcpDispatcherOptions["agentInfo"];
  features?: AcpDispatcherOptions["features"];
  requestClient?: AcpDispatcherOptions["requestClient"];
  onClientRequester?: (requestClient: NonNullable<AcpDispatcherOptions["requestClient"]>) => void;
  onClientCapabilities?: AcpDispatcherOptions["onClientCapabilities"];
}

export interface AcpServerResult {
  linesRead: number;
  responsesWritten: number;
}

export async function runAcpServer(options: AcpServerOptions): Promise<AcpServerResult> {
  const pendingClientRequests = new Map<string, PendingClientRequest>();
  const orphanClientResponses = new Map<string, JsonRpcResponse>();
  let nextClientRequestId = 1;
  let inputEnded = false;
  const requestClient = options.requestClient ?? (async (method: string, params: JsonValue): Promise<JsonValue> => {
    const id = `client_${nextClientRequestId++}`;
    const sessionId = extractSessionId(params);
    const key = clientRequestKey(id);
    const orphan = orphanClientResponses.get(key);
    if (orphan) {
      await options.writeStdout(serializeJsonRpc(makeJsonRpcRequest(id, method, params)));
      orphanClientResponses.delete(key);
      return jsonRpcResponseToResult(orphan);
    }

    if (inputEnded) {
      throw new Error("ACP input ended before the client returned a response.");
    }

    const result = new Promise<JsonValue>((resolve, reject) => {
      pendingClientRequests.set(key, { id, method, sessionId, resolve, reject });
    });
    await options.writeStdout(serializeJsonRpc(makeJsonRpcRequest(id, method, params)));

    const writtenOrphan = orphanClientResponses.get(key);
    if (writtenOrphan) {
      orphanClientResponses.delete(key);
      pendingClientRequests.delete(key);
      return jsonRpcResponseToResult(writtenOrphan);
    }

    return result;
  });
  options.onClientRequester?.(requestClient);

  const dispatcher =
    options.dispatcher ??
    new AcpDispatcher({
      runtime: options.runtime,
      cwd: options.cwd,
      agentInfo: options.agentInfo,
      features: options.features,
      notify: async (method, params) => {
        await options.writeStdout(serializeJsonRpc(makeJsonRpcNotification(method, params)));
      },
      requestClient,
      onClientCapabilities: options.onClientCapabilities,
    });
  let linesRead = 0;
  let responsesWritten = 0;
  let requestChain = Promise.resolve();

  for await (const line of readLines(options.input)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    linesRead++;

    try {
      const message = parseJsonRpcMessage(trimmed);
      if (isJsonRpcResponse(message)) {
        settleClientResponse(pendingClientRequests, orphanClientResponses, message);
        continue;
      }

      if (isImmediateNotification(message)) {
        if (message.method === "session/cancel") {
          await cancelPendingClientRequestsForSession(options, pendingClientRequests, extractSessionId(message.params));
        }
        const written = await handleClientMessage(options, dispatcher, message);
        responsesWritten += written;
        continue;
      }

      requestChain = requestChain.then(async () => {
        const written = await handleClientMessage(options, dispatcher, message);
        responsesWritten += written;
      });
    } catch (error) {
      const jsonRpcError = toJsonRpcError(error);
      await logDiagnostic(options, jsonRpcError);
      await options.writeStdout(serializeJsonRpc(makeJsonRpcFailure(null, jsonRpcError)));
      responsesWritten++;
    }
  }

  inputEnded = true;
  rejectPendingClientRequests(pendingClientRequests);
  await requestChain;

  return { linesRead, responsesWritten };
}

function isImmediateNotification(message: JsonRpcMessage): boolean {
  return "method" in message && !("id" in message) && (message.method === "session/cancel" || message.method === "$/cancel_request");
}

interface PendingClientRequest {
  id: JsonRpcId;
  method: string;
  sessionId?: string;
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
}

async function handleClientMessage(options: AcpServerOptions, dispatcher: AcpDispatcher, message: JsonRpcMessage): Promise<number> {
  if (!("method" in message)) {
    throw new JsonRpcError(JSON_RPC_INVALID_REQUEST, "Invalid Request");
  }

  let response: JsonRpcResponse | undefined;
  const requestId = "id" in message ? message.id : undefined;
  const responseId: string | number | null = requestId ?? null;
  const shouldRespondOnError = requestId !== undefined;
  try {
    const result = await dispatcher.dispatch(message);
    if (requestId !== undefined) {
      response = makeJsonRpcSuccess(requestId, result ?? null);
    }
  } catch (error) {
    const jsonRpcError = toJsonRpcError(error);
    await logDiagnostic(options, jsonRpcError);
    if (shouldRespondOnError) {
      response = makeJsonRpcFailure(responseId, jsonRpcError);
    }
  }

  if (!response) return 0;
  await options.writeStdout(serializeJsonRpc(response));
  await flushPostResponseEffects(options, dispatcher);
  return 1;
}

async function flushPostResponseEffects(options: AcpServerOptions, dispatcher: AcpDispatcher): Promise<void> {
  for (const effect of dispatcher.takePostResponseEffects()) {
    try {
      await effect();
    } catch (error) {
      await logDiagnostic(options, toJsonRpcError(error));
    }
  }
}

function settleClientResponse(
  pendingClientRequests: Map<string, PendingClientRequest>,
  orphanClientResponses: Map<string, JsonRpcResponse>,
  response: JsonRpcResponse,
): void {
  const key = clientRequestKey(response.id);
  const pending = pendingClientRequests.get(key);
  if (!pending) {
    orphanClientResponses.set(key, response);
    return;
  }

  pendingClientRequests.delete(key);
  try {
    pending.resolve(jsonRpcResponseToResult(response));
  } catch (error) {
    pending.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

function jsonRpcResponseToResult(response: JsonRpcResponse): JsonValue {
  if ("result" in response) return response.result;
  throw new JsonRpcError(response.error.code, response.error.message, response.error.data);
}

function rejectPendingClientRequests(pendingClientRequests: Map<string, PendingClientRequest>): void {
  for (const pending of pendingClientRequests.values()) {
    pending.reject(new Error("ACP input ended before the client returned a response."));
  }
  pendingClientRequests.clear();
}

async function cancelPendingClientRequestsForSession(
  options: AcpServerOptions,
  pendingClientRequests: Map<string, PendingClientRequest>,
  sessionId: string | undefined,
): Promise<void> {
  if (!sessionId) return;
  for (const [key, pending] of [...pendingClientRequests.entries()]) {
    if (pending.sessionId !== sessionId) continue;
    pendingClientRequests.delete(key);
    await options.writeStdout(serializeJsonRpc(makeJsonRpcNotification("$/cancel_request", { requestId: pending.id })));
    pending.reject(new JsonRpcError(JSON_RPC_REQUEST_CANCELLED, `Cancelled client request: ${pending.method}`));
  }
}

function clientRequestKey(id: JsonRpcId): string {
  return JSON.stringify(id);
}

function extractSessionId(params: JsonValue | undefined): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const sessionId = params.sessionId;
  return typeof sessionId === "string" ? sessionId : undefined;
}

export async function* readLines(input: AsyncIterable<string | Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of input) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      yield buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }

  buffer += decoder.decode();
  if (buffer.length > 0) yield buffer;
}

function toJsonRpcError(error: unknown): JsonRpcError {
  if (error instanceof JsonRpcError) return error;
  return new JsonRpcError(
    JSON_RPC_INTERNAL_ERROR,
    "Internal error",
    { reason: error instanceof Error ? error.message : String(error) },
  );
}

async function logDiagnostic(options: AcpServerOptions, error: JsonRpcError): Promise<void> {
  const writeStderr = options.writeStderr;
  if (!writeStderr) return;
  await writeStderr(`[soba acp] ${error.code} ${error.message}\n`);
}
