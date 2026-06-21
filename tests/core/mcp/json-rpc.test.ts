import { describe, expect, test } from "bun:test";
import {
  JSON_RPC_ERROR_CODES,
  JSON_RPC_VERSION,
  JsonRpcEndpoint,
  JsonRpcError,
  JsonRpcLineFramer,
  type JsonRpcNotification,
  type JsonRpcOutgoingMessage,
  JsonRpcProtocolError,
} from "../../../src/core/mcp/json-rpc";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("MCP JSON-RPC core", () => {
  test("request/response success resolves with correlated result", async () => {
    const sent: JsonRpcOutgoingMessage[] = [];
    const endpoint = new JsonRpcEndpoint({
      send: (message) => {
        sent.push(message);
      },
    });

    const result = endpoint.request("tools/list", { cursor: "next" });
    expect(sent).toEqual([
      {
        jsonrpc: JSON_RPC_VERSION,
        id: 1,
        method: "tools/list",
        params: { cursor: "next" },
      },
    ]);

    endpoint.receive({
      jsonrpc: JSON_RPC_VERSION,
      id: 1,
      result: { tools: [] },
    });

    await expect(result).resolves.toEqual({ tools: [] });
    expect(endpoint.pendingCount).toBe(0);
  });

  test("response with unknown id is reported without creating pending leaks", () => {
    const errors: JsonRpcProtocolError[] = [];
    const endpoint = new JsonRpcEndpoint({
      send: () => undefined,
      onProtocolError: (error) => errors.push(error),
    });

    endpoint.receive({
      jsonrpc: JSON_RPC_VERSION,
      id: "missing",
      result: true,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe(JSON_RPC_ERROR_CODES.unknownResponseId);
    expect(endpoint.pendingCount).toBe(0);
  });

  test("server error response rejects with normalized JSON-RPC error", async () => {
    const endpoint = new JsonRpcEndpoint({
      send: () => undefined,
    });

    const result = endpoint.request("tools/call");
    endpoint.receive({
      jsonrpc: JSON_RPC_VERSION,
      id: 1,
      error: {
        code: -32_001,
        message: "Tool failed",
        data: { retryable: false },
      },
    });

    await expect(result).rejects.toMatchObject({
      name: "JsonRpcError",
      code: -32_001,
      message: "Tool failed",
      data: { retryable: false },
      rpcId: 1,
    });
    expect(endpoint.pendingCount).toBe(0);
  });

  test("malformed JSON message is reported and answered with parse error", () => {
    const sent: JsonRpcOutgoingMessage[] = [];
    const errors: JsonRpcProtocolError[] = [];
    const endpoint = new JsonRpcEndpoint({
      send: (message) => {
        sent.push(message);
      },
      onProtocolError: (error) => errors.push(error),
    });

    endpoint.receive("{ not json");

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe(JSON_RPC_ERROR_CODES.parseError);
    expect(sent).toEqual([
      {
        jsonrpc: JSON_RPC_VERSION,
        id: null,
        error: {
          code: JSON_RPC_ERROR_CODES.parseError,
          message: "Malformed JSON-RPC message: invalid JSON.",
        },
      },
    ]);
  });

  test("timeout rejects and cleans pending request", async () => {
    const endpoint = new JsonRpcEndpoint({
      send: () => undefined,
    });

    const result = endpoint.request("slow/tool", undefined, { timeoutMs: 5 });
    expect(endpoint.pendingCount).toBe(1);

    await expect(result).rejects.toMatchObject({
      name: "JsonRpcError",
      code: JSON_RPC_ERROR_CODES.requestTimeout,
      rpcId: 1,
    });
    expect(endpoint.pendingCount).toBe(0);
  });

  test("abort signal rejects request and removes pending entry", async () => {
    const controller = new AbortController();
    const endpoint = new JsonRpcEndpoint({
      send: () => undefined,
    });

    const result = endpoint.request("cancelled/tool", undefined, {
      signal: controller.signal,
      timeoutMs: 100,
    });

    expect(endpoint.pendingCount).toBe(1);
    controller.abort();

    await expect(result).rejects.toMatchObject({
      name: "JsonRpcError",
      code: JSON_RPC_ERROR_CODES.requestCancelled,
      rpcId: 1,
    });
    expect(endpoint.pendingCount).toBe(0);
  });

  test("notification dispatch receives method and params without response", () => {
    const sent: JsonRpcOutgoingMessage[] = [];
    const notifications: JsonRpcNotification[] = [];
    const endpoint = new JsonRpcEndpoint({
      send: (message) => {
        sent.push(message);
      },
      onNotification: (notification) => notifications.push(notification),
    });

    endpoint.receive({
      jsonrpc: JSON_RPC_VERSION,
      method: "notifications/tools/list_changed",
      params: { server: "docs" },
    });

    expect(notifications).toEqual([
      {
        jsonrpc: JSON_RPC_VERSION,
        method: "notifications/tools/list_changed",
        params: { server: "docs" },
      },
    ]);
    expect(sent).toEqual([]);
  });

  test("concurrent requests resolve to the correct callers", async () => {
    const endpoint = new JsonRpcEndpoint({
      send: () => undefined,
    });

    const first = endpoint.request("first");
    const second = endpoint.request("second");

    endpoint.receive({
      jsonrpc: JSON_RPC_VERSION,
      id: 2,
      result: "second-result",
    });
    endpoint.receive({
      jsonrpc: JSON_RPC_VERSION,
      id: 1,
      result: "first-result",
    });

    await expect(first).resolves.toBe("first-result");
    await expect(second).resolves.toBe("second-result");
    expect(endpoint.pendingCount).toBe(0);
  });

  test("incoming request dispatch sends success response", async () => {
    const sent: JsonRpcOutgoingMessage[] = [];
    const endpoint = new JsonRpcEndpoint({
      send: (message) => {
        sent.push(message);
      },
      onRequest: (request) => ({ method: request.method, params: request.params }),
    });

    endpoint.receive({
      jsonrpc: JSON_RPC_VERSION,
      id: "server-request-1",
      method: "ping",
      params: { value: 1 },
    });
    await delay(0);

    expect(sent).toEqual([
      {
        jsonrpc: JSON_RPC_VERSION,
        id: "server-request-1",
        result: {
          method: "ping",
          params: { value: 1 },
        },
      },
    ]);
  });

  test("incoming request without handler sends method-not-found error", () => {
    const sent: JsonRpcOutgoingMessage[] = [];
    const endpoint = new JsonRpcEndpoint({
      send: (message) => {
        sent.push(message);
      },
    });

    endpoint.receive({
      jsonrpc: JSON_RPC_VERSION,
      id: 10,
      method: "unsupported",
    });

    expect(sent).toEqual([
      {
        jsonrpc: JSON_RPC_VERSION,
        id: 10,
        error: {
          code: JSON_RPC_ERROR_CODES.methodNotFound,
          message: 'JSON-RPC method "unsupported" is not supported.',
        },
      },
    ]);
  });

  test("line framer buffers chunks and formats newline-delimited messages", () => {
    const framer = new JsonRpcLineFramer();

    expect(framer.push('{"jsonrpc":"2.0"')).toEqual([]);
    expect(framer.push(',"method":"a"}\r\n{"jsonrpc":"2.0","method":"b"}\npartial')).toEqual([
      '{"jsonrpc":"2.0","method":"a"}',
      '{"jsonrpc":"2.0","method":"b"}',
    ]);
    expect(framer.flush()).toBe("partial");
    expect(
      framer.format({
        jsonrpc: JSON_RPC_VERSION,
        method: "notifications/tools/list_changed",
      }),
    ).toBe('{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n');
  });

  test("close rejects all pending requests and clears pending map", async () => {
    const endpoint = new JsonRpcEndpoint({
      send: () => undefined,
    });

    const first = endpoint.request("first", undefined, { timeoutMs: 100 });
    const second = endpoint.request("second", undefined, { timeoutMs: 100 });

    endpoint.close("shutdown");

    expect(endpoint.pendingCount).toBe(0);
    await expect(first).rejects.toBeInstanceOf(JsonRpcError);
    await expect(second).rejects.toMatchObject({ message: "shutdown" });
  });

  test("async send failure rejects request and clears pending map", async () => {
    const endpoint = new JsonRpcEndpoint({
      send: async () => {
        throw new Error("transport closed");
      },
    });

    const result = endpoint.request("tools/list", undefined, { timeoutMs: 100 });

    await expect(result).rejects.toMatchObject({ message: "transport closed" });
    expect(endpoint.pendingCount).toBe(0);
  });
});
