import { describe, expect, test } from "bun:test";
import { MCP_DRAFT_PROTOCOL_VERSION, McpClient, type McpClientTransport, type McpClientTransportHandlers } from "../../../src/core/mcp/client";
import { McpClientManager, McpClientManagerError, type McpRemoteAuthCommandResult } from "../../../src/core/mcp/client-manager";
import { JSON_RPC_VERSION, type JsonRpcOutgoingMessage, type JsonRpcRequest } from "../../../src/core/mcp/json-rpc";
import { McpTransportError } from "../../../src/core/mcp/transport";
import type { McpServerConfig } from "../../../src/core/mcp/types";

describe("MCP client manager", () => {
  test("starts two configured servers", async () => {
    const harness = new ManagerHarness([serverConfig("alpha"), serverConfig("beta")]);

    await harness.manager.start("alpha");
    await harness.manager.start("beta");

    expect(harness.manager.getStatus().counts.ready).toBe(2);
    expect(harness.transport("alpha").startedCount).toBe(1);
    expect(harness.transport("beta").startedCount).toBe(1);
  });

  test("lazy starts server on first client access", async () => {
    const harness = new ManagerHarness([serverConfig("alpha")]);

    expect(harness.manager.getClientIfStarted("alpha")).toBeNull();
    const client = await harness.manager.getClient("alpha");

    expect(client.getState().state).toBe("ready");
    expect(harness.manager.getClientIfStarted("alpha")).toBe(client);
  });

  test("stopping one server leaves others running", async () => {
    const harness = new ManagerHarness([serverConfig("alpha"), serverConfig("beta")]);
    await harness.manager.start("alpha");
    await harness.manager.start("beta");

    await harness.manager.stop("alpha");

    expect(harness.manager.getStatus().servers.find((server) => server.id === "alpha")).toMatchObject({ state: "stopped" });
    expect(harness.manager.getStatus().servers.find((server) => server.id === "beta")).toMatchObject({ state: "ready" });
    expect(harness.transport("alpha").shutdownCount).toBe(1);
    expect(harness.transport("beta").shutdownCount).toBe(0);
  });

  test("restarts crashed server with a fresh client", async () => {
    const harness = new ManagerHarness([serverConfig("alpha")]);
    const first = await harness.manager.start("alpha");
    harness.transport("alpha").crash(new Error("process exited 42"));

    const second = await harness.manager.getClient("alpha");

    expect(first).not.toBe(second);
    expect(second.getState().state).toBe("ready");
    expect(harness.manager.getStatus().servers[0]).toMatchObject({
      state: "ready",
      crashRestartCount: 1,
      restartExhausted: false,
    });
  });

  test("recovers degraded server with a fresh client instead of returning stale tools client", async () => {
    const harness = new ManagerHarness([serverConfig("alpha")]);
    const first = await harness.manager.start("alpha");
    harness.transport("alpha").protocolError("JSON-RPC response id server-error does not match a pending request.");

    expect(harness.manager.getStatus().servers[0]).toMatchObject({
      state: "degraded",
      lastError: 'JSON-RPC response id "server-error" does not match a pending request.',
    });

    const second = await harness.manager.getClient("alpha");

    expect(first).not.toBe(second);
    expect(second.getState().state).toBe("ready");
    expect(harness.manager.getStatus().servers[0]).toMatchObject({
      state: "ready",
      crashRestartCount: 1,
      restartExhausted: false,
    });
  });

  test("aggregate status includes ready degraded and crashed servers", async () => {
    const harness = new ManagerHarness([serverConfig("ready"), serverConfig("degraded"), serverConfig("crashed")], {
      degradedServers: new Set(["degraded"]),
    });

    await harness.manager.start("ready");
    await expect(harness.manager.start("degraded")).rejects.toMatchObject({ code: "missing_capability" });
    await harness.manager.start("crashed");
    harness.transport("crashed").crash(new Error("boom"));

    const status = harness.manager.getStatus();

    expect(status.counts).toMatchObject({
      ready: 1,
      degraded: 1,
      crashed: 1,
    });
    expect(status.servers.map((server) => [server.id, server.state])).toEqual([
      ["ready", "ready"],
      ["degraded", "degraded"],
      ["crashed", "crashed"],
    ]);
  });

  test("repeated crash hits bounded recovery policy", async () => {
    const harness = new ManagerHarness([serverConfig("alpha")], { maxCrashRestarts: 1 });
    await harness.manager.start("alpha");
    harness.transport("alpha").crash(new Error("first crash"));
    await harness.manager.getClient("alpha");
    harness.transport("alpha").crash(new Error("second crash"));

    await expect(harness.manager.getClient("alpha")).rejects.toBeInstanceOf(McpClientManagerError);
    await expect(harness.manager.getClient("alpha")).rejects.toMatchObject({
      code: "restart_exhausted",
      serverId: "alpha",
    });
    expect(harness.manager.getStatus().servers[0]).toMatchObject({
      state: "crashed",
      restartExhausted: true,
      crashRestartCount: 1,
    });
  });

  test("cleanup stops all started clients", async () => {
    const harness = new ManagerHarness([serverConfig("alpha"), serverConfig("beta")]);
    await harness.manager.start("alpha");
    await harness.manager.start("beta");

    await harness.manager.stopAll();

    expect(harness.transport("alpha").shutdownCount).toBe(1);
    expect(harness.transport("beta").shutdownCount).toBe(1);
    expect(harness.manager.getStatus().counts.stopped).toBe(2);
  });

  test("partial failure does not block another server", async () => {
    const harness = new ManagerHarness([serverConfig("broken"), serverConfig("healthy")], {
      degradedServers: new Set(["broken"]),
    });

    await expect(harness.manager.start("broken")).rejects.toMatchObject({ code: "missing_capability" });
    await expect(harness.manager.start("healthy")).resolves.toBeInstanceOf(McpClient);

    expect(harness.manager.getStatus().servers.find((server) => server.id === "broken")).toMatchObject({ state: "degraded" });
    expect(harness.manager.getStatus().servers.find((server) => server.id === "healthy")).toMatchObject({ state: "ready" });
  });

  test("status includes remote transport and auth state", () => {
    const harness = new ManagerHarness([remoteServerConfig("remote")]);

    expect(harness.manager.getStatus().servers[0]).toMatchObject({
      id: "remote",
      transport: "streamableHttp",
      authState: {
        type: "oauth",
        state: "login_required",
        nextAction: "Run /mcp auth login remote",
      },
    });
  });

  test("static remote auth rejection points to env/header instead of OAuth login", async () => {
    const harness = new ManagerHarness([remoteApiKeyServerConfig("remote")], {
      authRequiredServers: new Set(["remote"]),
    });

    await expect(harness.manager.start("remote")).rejects.toMatchObject({ code: "auth_required" });

    expect(harness.manager.getStatus().servers[0]).toMatchObject({
      id: "remote",
      state: "degraded",
      authState: {
        type: "apiKeyEnv",
        state: "auth_required",
        detail: "server rejected credentials from REMOTE_MCP_API_KEY",
        nextAction: "Verify REMOTE_MCP_API_KEY, the configured auth header, and the provider workspace/project access; then restart remote.",
      },
    });
  });

  test("login command starts remote auth flow through controller", async () => {
    const calls: string[] = [];
    const loginResult: McpRemoteAuthCommandResult = {
      status: { type: "oauth", state: "authenticated", detail: "oauth", nextAction: null },
      message: "OAuth login completed.",
      details: null,
    };
    const manager = new McpClientManager({
      servers: [remoteServerConfig("remote")],
      authController: {
        login: async (server) => {
          calls.push(`login:${server.id}`);
          return loginResult;
        },
      },
    });

    await expect(manager.login("remote")).resolves.toBe(loginResult);
    expect(calls).toEqual(["login:remote"]);
  });

  test("logout clears token state through controller", async () => {
    let authenticated = true;
    const manager = new McpClientManager({
      servers: [remoteServerConfig("remote")],
      authController: {
        cachedStatus: () =>
          authenticated
            ? { type: "oauth", state: "authenticated", detail: "oauth", nextAction: null }
            : { type: "oauth", state: "login_required", detail: "oauth", nextAction: "Run /mcp auth login remote" },
        logout: async () => {
          authenticated = false;
          return {
            status: { type: "oauth", state: "login_required", detail: "oauth", nextAction: "Run /mcp auth login remote" },
            message: "OAuth token cleared.",
            details: null,
          };
        },
      },
    });

    expect(manager.getStatus().servers[0]?.authState?.state).toBe("authenticated");
    await manager.logout("remote");
    expect(manager.getStatus().servers[0]?.authState?.state).toBe("login_required");
  });
});

type HandlerResult = unknown | typeof ScriptedTransport.noResponse;
type RequestHandler = (request: JsonRpcRequest) => HandlerResult;

class ManagerHarness {
  readonly manager: McpClientManager;
  private readonly transports = new Map<string, ScriptedTransport[]>();
  private readonly degradedServers: Set<string>;
  private readonly authRequiredServers: Set<string>;

  constructor(
    servers: McpServerConfig[],
    options: {
      degradedServers?: Set<string>;
      authRequiredServers?: Set<string>;
      maxCrashRestarts?: number;
    } = {},
  ) {
    this.degradedServers = options.degradedServers ?? new Set();
    this.authRequiredServers = options.authRequiredServers ?? new Set();
    this.manager = new McpClientManager({
      servers,
      maxCrashRestarts: options.maxCrashRestarts,
      createClient: (server) => {
        const transport = this.createTransport(server.id);
        const list = this.transports.get(server.id) ?? [];
        list.push(transport);
        this.transports.set(server.id, list);
        return new McpClient({
          server,
          transportFactory: (handlers) => transport.attach(handlers),
          requestTimeoutMs: server.timeoutMs,
        });
      },
    });
  }

  transport(serverId: string): ScriptedTransport {
    const list = this.transports.get(serverId);
    const transport = list?.at(-1);
    if (!transport) {
      throw new Error(`No transport for ${serverId}`);
    }

    return transport;
  }

  private createTransport(serverId: string): ScriptedTransport {
    if (this.authRequiredServers.has(serverId)) {
      return new ScriptedTransport({
        "server/discover": () => {
          throw new McpTransportError("auth_required", "MCP Streamable HTTP server rejected static authentication.", {
            kind: "streamableHttp",
          });
        },
      });
    }

    return new ScriptedTransport({
      "server/discover": () => ({
        protocolVersions: [MCP_DRAFT_PROTOCOL_VERSION],
        capabilities: this.degradedServers.has(serverId) ? {} : { tools: { listChanged: true } },
        serverInfo: { name: serverId },
      }),
    });
  }
}

class ScriptedTransport implements McpClientTransport {
  static readonly noResponse = Symbol("no-response");

  readonly kind = "memory";
  private onEvent: McpClientTransportHandlers | null = null;
  private readonly requestHandlers: Record<string, RequestHandler>;
  private started = false;
  startedCount = 0;
  shutdownCount = 0;
  readonly sent: JsonRpcOutgoingMessage[] = [];

  constructor(requestHandlers: Record<string, RequestHandler>) {
    this.requestHandlers = requestHandlers;
  }

  attach(onEvent: McpClientTransportHandlers): McpClientTransport {
    this.onEvent = onEvent;
    return this;
  }

  start(): void {
    this.started = true;
    this.startedCount += 1;
  }

  send(message: JsonRpcOutgoingMessage): void {
    if (!this.started) {
      throw new Error("transport not started");
    }

    this.sent.push(message);
    if (!("method" in message) || !("id" in message)) {
      return;
    }

    const handler = this.requestHandlers[message.method];
    if (!handler) {
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
      return;
    }

    const result = handler(message);
    if (result === ScriptedTransport.noResponse) {
      return;
    }

    this.onEvent?.({
      type: "message",
      message: {
      jsonrpc: JSON_RPC_VERSION,
      id: message.id,
      result,
      },
    });
  }

  async shutdown(): Promise<void> {
    if (this.started) {
      this.shutdownCount += 1;
    }
    this.started = false;
  }

  close(): Promise<void> {
    return this.shutdown();
  }

  diagnostics() {
    return {
      kind: this.kind,
      state: this.started ? "running" : "closed",
    } as const;
  }

  crash(error: unknown): void {
    this.onEvent?.({
      type: "error",
      error: new McpTransportError("process_exit", error instanceof Error ? error.message : String(error), {
        kind: "memory",
        cause: error,
      }),
    });
  }

  protocolError(message: string): void {
    this.onEvent?.({
      type: "message",
      message: {
        jsonrpc: JSON_RPC_VERSION,
        id: "server-error",
        error: {
          code: -32603,
          message,
        },
      },
    });
  }
}

function serverConfig(id: string): McpServerConfig {
  return {
    id,
    name: id,
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

function remoteServerConfig(id: string): McpServerConfig {
  return {
    id,
    name: id,
    transport: "streamableHttp",
    url: `https://${id}.example.com/mcp`,
    headers: {},
    auth: { type: "oauth" },
    timeoutMs: 50,
    maxOutputBytes: 1024,
    trustMode: "normal",
    enabled: true,
  };
}

function remoteApiKeyServerConfig(id: string): McpServerConfig {
  return {
    id,
    name: id,
    transport: "streamableHttp",
    url: `https://${id}.example.com/mcp`,
    headers: {},
    auth: { type: "apiKeyEnv", header: "X-API-Key", env: "REMOTE_MCP_API_KEY" },
    timeoutMs: 50,
    maxOutputBytes: 1024,
    trustMode: "normal",
    enabled: true,
  };
}
