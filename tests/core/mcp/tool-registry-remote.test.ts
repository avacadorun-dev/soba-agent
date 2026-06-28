import { describe, expect, test } from "bun:test";
import { MCP_DRAFT_PROTOCOL_VERSION, type McpClient, type McpTool, type McpToolCallResult } from "../../../src/infrastructure/mcp/client";
import { McpClientManager, type McpClientManagerStatus, type McpManagedServerStatus } from "../../../src/infrastructure/mcp/client-manager";
import { MCP_SESSION_ID_HEADER } from "../../../src/infrastructure/mcp/http-session";
import { JSON_RPC_VERSION, type JsonRpcRequest } from "../../../src/infrastructure/mcp/json-rpc";
import type { McpServerSecurity } from "../../../src/infrastructure/mcp/security";
import { syncMcpToolsIntoRegistry } from "../../../src/infrastructure/mcp/tool-registry-sync";
import type { McpStreamableHttpServerConfig } from "../../../src/infrastructure/mcp/types";
import { ToolRegistry } from "../../../src/kernel/tools/tool-registry";

describe("Remote MCP ToolRegistry regression", () => {
  test("remote tool appears in registry with safe function name and readable label", async () => {
    await withRemoteMcpServer(
      {
        tools: [{ name: "repo.search", description: "Search repository docs" }],
      },
      async (server) => {
        const manager = new McpClientManager({ servers: [remoteServerConfig(server)] });
        await manager.start("remote.ctx-7");
        const registry = new ToolRegistry();

        const sync = await syncMcpToolsIntoRegistry(registry, manager);

        expect(sync.registered).toEqual(["mcp_remote_ctx_7_repo_search"]);
        expect(registry.getOpenResponsesTools()).toContainEqual(
          expect.objectContaining({
            type: "function",
            name: "mcp_remote_ctx_7_repo_search",
          }),
        );
        expect(registry.get("mcp_remote_ctx_7_repo_search")?.label).toBe("mcp.remote.ctx-7.repo.search");
        expect(registry.getNames().every((name) => /^[a-zA-Z0-9_-]+$/.test(name))).toBe(true);

        await manager.stopAll();
      },
    );
  });

  test("remote tool call executes through registry and normalizes output", async () => {
    await withRemoteMcpServer(
      {
        tools: [{ name: "summarize" }],
        callResult: {
          content: [{ type: "text", text: "remote-ok" }],
          structuredContent: { source: "remote" },
          resultType: "structured",
          isError: false,
        },
      },
      async (server) => {
        const manager = new McpClientManager({ servers: [remoteServerConfig(server)] });
        await manager.start("remote.ctx-7");
        const registry = new ToolRegistry();
        await syncMcpToolsIntoRegistry(registry, manager);

        const result = await registry.get("mcp_remote_ctx_7_summarize")?.execute({ topic: "mcp" }, { cwd: "/tmp" });

        expect(server.toolCalls).toEqual([{ name: "summarize", arguments: { topic: "mcp" } }]);
        expect(result).toMatchObject({
          isError: false,
          content: [{ type: "text", text: 'remote-ok\n{\n  "source": "remote"\n}' }],
          details: {
            mcp: {
              resultType: "structured",
              structuredContent: { source: "remote" },
              truncated: false,
            },
          },
        });

        await manager.stopAll();
      },
    );
  });

  test("remote output uses the same truncation path as stdio MCP output", async () => {
    await withRemoteMcpServer(
      {
        tools: [{ name: "dump" }],
        callResult: {
          content: [{ type: "text", text: "A".repeat(200) }],
          isError: false,
        },
      },
      async (server) => {
        const manager = new McpClientManager({
          servers: [
            {
              ...remoteServerConfig(server),
              maxOutputBytes: 80,
            },
          ],
        });
        await manager.start("remote.ctx-7");
        const registry = new ToolRegistry();
        await syncMcpToolsIntoRegistry(registry, manager);

        const result = await registry.get("mcp_remote_ctx_7_dump")?.execute({}, { cwd: "/tmp" });

        expect(result?.isError).toBe(false);
        expect(result?.content[0]?.text).toContain("[MCP output truncated");
        expect(result?.details).toMatchObject({
          mcp: {
            truncated: true,
            originalBytes: 200,
          },
        });

        await manager.stopAll();
      },
    );
  });

  test("crashed remote server does not remove unrelated stdio MCP tools", async () => {
    const registry = new ToolRegistry();
    const source = new MixedMcpSource({
      remote: {
        state: "crashed",
        security: security("remote", "normal"),
        tools: [{ name: "broken" }],
      },
      local: {
        state: "ready",
        security: security("local", "safe"),
        tools: [{ name: "echo" }],
      },
    });

    const sync = await syncMcpToolsIntoRegistry(registry, source);

    expect(sync.registered).toEqual(["mcp_local_echo"]);
    expect(sync.skipped).toEqual([]);
    expect(registry.has("mcp_remote_broken")).toBe(false);
    expect(registry.has("mcp_local_echo")).toBe(true);
  });
});

interface RemoteMcpServerOptions {
  tools: McpTool[];
  callResult?: McpToolCallResult;
  sessionId?: string;
}

interface RemoteMcpServerFixture {
  url: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
}

async function withRemoteMcpServer(options: RemoteMcpServerOptions, run: (server: RemoteMcpServerFixture) => Promise<void>): Promise<void> {
  const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as JsonRpcRequest;
      const headers = new Headers({ "content-type": "application/json" });
      if (options.sessionId) {
        headers.set(MCP_SESSION_ID_HEADER, options.sessionId);
      }

      if (body.method === "server/discover") {
        return Response.json(
          {
            jsonrpc: JSON_RPC_VERSION,
            id: body.id,
            result: {
              protocolVersions: [MCP_DRAFT_PROTOCOL_VERSION],
              capabilities: { tools: { listChanged: true } },
              serverInfo: { name: "remote fixture" },
            },
          },
          { headers },
        );
      }

      if (body.method === "tools/list") {
        return Response.json({ jsonrpc: JSON_RPC_VERSION, id: body.id, result: { tools: options.tools } }, { headers });
      }

      if (body.method === "tools/call") {
        const params = isRecord(body.params) ? body.params : {};
        const name = typeof params.name === "string" ? params.name : "";
        const args = isRecord(params.arguments) ? params.arguments : {};
        toolCalls.push({ name, arguments: args });
        return Response.json(
          {
            jsonrpc: JSON_RPC_VERSION,
            id: body.id,
            result: options.callResult ?? {
              content: [{ type: "text", text: "ok" }],
              isError: false,
            },
          },
          { headers },
        );
      }

      return Response.json(
        {
          jsonrpc: JSON_RPC_VERSION,
          id: body.id,
          error: { code: -32601, message: "Method not found" },
        },
        { status: 404, headers },
      );
    },
  });

  try {
    await run({
      url: new URL("/mcp", server.url).toString(),
      toolCalls,
    });
  } finally {
    server.stop(true);
  }
}

function remoteServerConfig(server: RemoteMcpServerFixture): McpStreamableHttpServerConfig {
  return {
    id: "remote.ctx-7",
    name: "Remote Context7",
    transport: "streamableHttp",
    url: server.url,
    headers: {},
    auth: { type: "none" },
    timeoutMs: 200,
    maxOutputBytes: 1024,
    trustMode: "normal",
    enabled: true,
  };
}

interface MixedServerState {
  state: McpManagedServerStatus["state"];
  security: McpServerSecurity;
  tools: McpTool[];
}

class MixedMcpSource {
  private readonly states: Record<string, MixedServerState>;

  constructor(states: Record<string, MixedServerState>) {
    this.states = states;
  }

  getServerIds(): string[] {
    return Object.keys(this.states);
  }

  getStatus(): McpClientManagerStatus {
    const servers: McpManagedServerStatus[] = Object.entries(this.states).map(([id, state]) => ({
      id,
      name: id,
      enabled: true,
      started: state.state !== "idle",
      state: state.state,
      lifecycle: state.state === "ready" ? "modern" : null,
      protocolVersion: state.state === "ready" ? MCP_DRAFT_PROTOCOL_VERSION : null,
      lastError: state.state === "crashed" ? "crashed" : null,
      lastErrorCode: state.state === "crashed" ? "process_exit" : null,
      toolsListChanged: false,
      crashRestartCount: 0,
      restartExhausted: false,
    }));

    return {
      servers,
      counts: {
        idle: servers.filter((server) => server.state === "idle").length,
        starting: servers.filter((server) => server.state === "starting").length,
        ready: servers.filter((server) => server.state === "ready").length,
        degraded: servers.filter((server) => server.state === "degraded").length,
        stopping: servers.filter((server) => server.state === "stopping").length,
        stopped: servers.filter((server) => server.state === "stopped").length,
        crashed: servers.filter((server) => server.state === "crashed").length,
      },
    };
  }

  async getClient(serverId: string): Promise<McpClient> {
    const state = this.states[serverId];
    if (!state) {
      throw new Error(`Unknown server ${serverId}`);
    }

    return {
      listTools: async () => state.tools,
      callTool: async () => ({ content: [{ type: "text", text: "ok" }], isError: false }),
    } as unknown as McpClient;
  }

  getServerSecurity(serverId: string): McpServerSecurity {
    const state = this.states[serverId];
    if (!state) {
      throw new Error(`Unknown server ${serverId}`);
    }

    return state.security;
  }
}

function security(serverId: string, trustMode: McpServerSecurity["trustMode"]): McpServerSecurity {
  return {
    serverId,
    trustMode,
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
    env: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
