import { describe, expect, test } from "bun:test";
import { MCP_DRAFT_PROTOCOL_VERSION, McpClient } from "../../../src/core/mcp/client";
import { McpClientManager } from "../../../src/core/mcp/client-manager";
import { JSON_RPC_VERSION, type JsonRpcOutgoingMessage } from "../../../src/core/mcp/json-rpc";
import {
  type McpTransport,
  type McpTransportDiagnostics,
  McpTransportError,
  type McpTransportEventHandler,
  throwIfTransportAborted,
} from "../../../src/core/mcp/transport";
import type { McpServerConfig } from "../../../src/core/mcp/types";

describe("MCP transport abstraction", () => {
  test("fake in-memory transport drives MCP client lifecycle", async () => {
    const transport = new MemoryTransport();
    const client = createClient(transport);

    await client.start();
    const tools = await client.listTools();

    expect(client.getState()).toMatchObject({
      state: "ready",
      lifecycle: "modern",
      protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
    });
    expect(tools.map((tool) => tool.name)).toEqual(["memory_echo"]);
    expect(transport.diagnostics()).toEqual({
      kind: "memory",
      state: "running",
    });
  });

  test("abort before send produces controlled transport error", async () => {
    const transport = new MemoryTransport();
    const controller = new AbortController();
    transport.start();
    controller.abort();

    expect(() =>
      transport.send(
        {
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "tools/list",
        },
        { signal: controller.signal },
      ),
    ).toThrow(McpTransportError);

    try {
      transport.send(
        {
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "tools/list",
        },
        { signal: controller.signal },
      );
    } catch (error) {
      expect(error).toMatchObject({
      name: "McpTransportError",
      code: "aborted",
      kind: "memory",
    });
    }
  });

  test("close is idempotent", async () => {
    const transport = new MemoryTransport();
    transport.start();

    await transport.close();
    await transport.close();

    expect(transport.diagnostics()).toEqual({
      kind: "memory",
      state: "closed",
    });
  });

  test("transport-level malformed message does not crash client manager", async () => {
    const transport = new MemoryTransport();
    const manager = new McpClientManager({
      servers: [serverConfig()],
      createClient: (server) =>
        new McpClient({
          server,
          requestTimeoutMs: 50,
          transportFactory: (onEvent) => transport.attach(onEvent),
        }),
    });

    await manager.start("memory");
    transport.emitMalformedMessage();

    const status = manager.getStatus().servers[0];
    expect(status).toMatchObject({
      id: "memory",
      state: "degraded",
    });

    await manager.stopAll();
  });
});

class MemoryTransport implements McpTransport {
  readonly kind = "memory";
  private state: McpTransportDiagnostics["state"] = "idle";
  private onEvent: McpTransportEventHandler | null = null;

  attach(onEvent: McpTransportEventHandler): McpTransport {
    this.onEvent = onEvent;
    return this;
  }

  start(): void {
    this.state = "running";
    this.onEvent?.({ type: "state", state: "running" });
  }

  send(message: JsonRpcOutgoingMessage, options: { signal?: AbortSignal } = {}): void {
    throwIfTransportAborted(options.signal, this.kind);
    if (this.state !== "running") {
      throw new McpTransportError("not_running", "Memory transport is not running.", { kind: this.kind });
    }
    if (!("method" in message) || !("id" in message)) {
      return;
    }

    if (message.method === "server/discover") {
      this.respond(message.id, {
        protocolVersions: [MCP_DRAFT_PROTOCOL_VERSION],
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "memory-mcp" },
      });
      return;
    }

    if (message.method === "tools/list") {
      this.respond(message.id, {
        tools: [
          {
            name: "memory_echo",
            inputSchema: { type: "object" },
          },
        ],
      });
      return;
    }

    this.onEvent?.({
      type: "message",
      message: {
        jsonrpc: JSON_RPC_VERSION,
        id: message.id,
        error: {
          code: -32601,
          message: "Method not found",
        },
      },
    });
  }

  async close(): Promise<void> {
    this.state = "closed";
    this.onEvent?.({ type: "state", state: "closed" });
  }

  shutdown(): Promise<void> {
    return this.close();
  }

  diagnostics(): McpTransportDiagnostics {
    return {
      kind: this.kind,
      state: this.state,
    };
  }

  emitMalformedMessage(): void {
    this.onEvent?.({ type: "message", message: "{not json" });
  }

  private respond(id: string | number, result: unknown): void {
    this.onEvent?.({
      type: "message",
      message: {
        jsonrpc: JSON_RPC_VERSION,
        id,
        result,
      },
    });
  }
}

function createClient(transport: MemoryTransport): McpClient {
  return new McpClient({
    server: serverConfig(),
    requestTimeoutMs: 50,
    transportFactory: (onEvent) => transport.attach(onEvent),
  });
}

function serverConfig(): McpServerConfig {
  return {
    id: "memory",
    name: "Memory MCP",
    transport: "stdio",
    command: "bun",
    args: [],
    env: {},
    cwd: "/tmp",
    timeoutMs: 50,
    maxOutputBytes: 1024,
    trustMode: "normal",
    enabled: true,
  };
}
