import { z } from "zod";

export type JsonRpcId = string | number | null;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: JsonValue;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: JsonValue;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: JsonValue;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: JsonValue;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const jsonRpcIdSchema = z.union([z.string(), z.number(), z.null()]);

const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: jsonRpcIdSchema.optional(),
  method: z.string().min(1),
  params: jsonValueSchema.optional(),
});

const jsonRpcResponseSchema = z.union([
  z.object({
    jsonrpc: z.literal("2.0"),
    id: jsonRpcIdSchema,
    result: jsonValueSchema,
  }),
  z.object({
    jsonrpc: z.literal("2.0"),
    id: jsonRpcIdSchema,
    error: z.object({
      code: z.number().int(),
      message: z.string(),
      data: jsonValueSchema.optional(),
    }),
  }),
]);

export class JsonRpcError extends Error {
  readonly code: number;
  readonly data?: JsonValue;

  constructor(code: number, message: string, data?: JsonValue) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
  }
}

export function parseJsonRpcMessage(line: string): JsonRpcMessage {
  const parsed = parseJson(line);
  const request = jsonRpcRequestSchema.safeParse(parsed);
  if (request.success) return request.data;

  const response = jsonRpcResponseSchema.safeParse(parsed);
  if (response.success) return response.data;

  throw new JsonRpcError(JSON_RPC_INVALID_REQUEST, "Invalid Request", {
    issues: request.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new JsonRpcError(JSON_RPC_PARSE_ERROR, "Parse error", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export function isJsonRpcResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return "id" in message && ("result" in message || "error" in message) && !("method" in message);
}

export function makeJsonRpcRequest(id: JsonRpcId, method: string, params?: JsonValue): JsonRpcRequest {
  const request: JsonRpcRequest = {
    jsonrpc: "2.0",
    id,
    method,
  };
  if (params !== undefined) request.params = params;
  return request;
}

export function makeJsonRpcSuccess(id: JsonRpcId, result: JsonValue): JsonRpcSuccess {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

export function makeJsonRpcFailure(id: JsonRpcId, error: JsonRpcError): JsonRpcFailure {
  const response: JsonRpcFailure = {
    jsonrpc: "2.0",
    id,
    error: {
      code: error.code,
      message: error.message,
    },
  };
  if (error.data !== undefined) response.error.data = error.data;
  return response;
}

export function makeJsonRpcNotification(method: string, params?: JsonValue): JsonRpcNotification {
  const notification: JsonRpcNotification = {
    jsonrpc: "2.0",
    method,
  };
  if (params !== undefined) notification.params = params;
  return notification;
}

export function serializeJsonRpc(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}
