import type { SobaRuntime } from "../../application/types";
import { AcpDispatcher, type AcpDispatcherOptions } from "../../protocol-adapters/acp/dispatcher";
import {
  JSON_RPC_INTERNAL_ERROR,
  JsonRpcError,
  type JsonRpcResponse,
  makeJsonRpcFailure,
  makeJsonRpcNotification,
  makeJsonRpcSuccess,
  parseJsonRpcRequest,
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
}

export interface AcpServerResult {
  linesRead: number;
  responsesWritten: number;
}

export async function runAcpServer(options: AcpServerOptions): Promise<AcpServerResult> {
  const dispatcher =
    options.dispatcher ??
    new AcpDispatcher({
      runtime: options.runtime,
      cwd: options.cwd,
      agentInfo: options.agentInfo,
      notify: async (method, params) => {
        await options.writeStdout(serializeJsonRpc(makeJsonRpcNotification(method, params)));
      },
      requestClient: options.requestClient,
    });
  let linesRead = 0;
  let responsesWritten = 0;

  for await (const line of readLines(options.input)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    linesRead++;

    let response: JsonRpcResponse | undefined;
    let responseId: string | number | null = null;
    let shouldRespondOnError = true;
    try {
      const request = parseJsonRpcRequest(trimmed);
      responseId = request.id ?? null;
      shouldRespondOnError = request.id !== undefined;
      const result = await dispatcher.dispatch(request);
      if (request.id !== undefined) {
        response = makeJsonRpcSuccess(request.id, result ?? null);
      }
    } catch (error) {
      const jsonRpcError = toJsonRpcError(error);
      await logDiagnostic(options, jsonRpcError);
      if (shouldRespondOnError) {
        response = makeJsonRpcFailure(responseId, jsonRpcError);
      }
    }

    if (response) {
      await options.writeStdout(serializeJsonRpc(response));
      responsesWritten++;
    }
  }

  return { linesRead, responsesWritten };
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
