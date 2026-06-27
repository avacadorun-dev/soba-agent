import type { SobaRuntime } from "../../application/types";
import { AcpDispatcher, type AcpDispatcherOptions } from "../../protocol-adapters/acp/dispatcher";
import {
  isJsonRpcResponse,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_REQUEST,
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
} from "../../protocol-adapters/acp/json-rpc";

export interface AcpServerOptions {
  runtime: SobaRuntime;
  cwd: string;
  input: AsyncIterable<string | Uint8Array>;
  writeStdout: (chunk: string) => void | Promise<void>;
  writeStderr?: (chunk: string) => void | Promise<void>;
  dispatcher?: AcpDispatcher;
  agentInfo?: AcpDispatcherOptions["agentInfo"];
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
    await options.writeStdout(serializeJsonRpc(makeJsonRpcRequest(id, method, params)));

    const orphan = orphanClientResponses.get(clientRequestKey(id));
    if (orphan) {
      orphanClientResponses.delete(clientRequestKey(id));
      return jsonRpcResponseToResult(orphan);
    }

    if (inputEnded) {
      throw new Error("ACP input ended before the client returned a response.");
    }

    return new Promise<JsonValue>((resolve, reject) => {
      pendingClientRequests.set(clientRequestKey(id), { resolve, reject });
    });
  });
  options.onClientRequester?.(requestClient);

  const dispatcher =
    options.dispatcher ??
    new AcpDispatcher({
      runtime: options.runtime,
      cwd: options.cwd,
      agentInfo: options.agentInfo,
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

interface PendingClientRequest {
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
  return 1;
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

function clientRequestKey(id: JsonRpcId): string {
  return JSON.stringify(id);
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
