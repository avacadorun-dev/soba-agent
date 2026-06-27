import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpRuntimeController } from "../../src/application/mcp-runtime-controller";
import type { McpClientManager, McpClientManagerStatus } from "../../src/core/mcp/client-manager";
import { McpSecretStore } from "../../src/core/mcp/secret-store";
import type { McpServerSecurity } from "../../src/core/mcp/security";
import type { McpConfig, McpServerConfig } from "../../src/core/mcp/types";
import { ToolRegistry } from "../../src/core/tools/tool-registry";
import { TrustManager } from "../../src/core/trust/trust-manager";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "soba-mcp-runtime-controller-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("McpRuntimeController", () => {
  test("reload перечитывает MCP config, останавливает старый manager и пересобирает tools", async () => {
    const registry = new ToolRegistry();
    const managers: FakeReloadManager[] = [];
    const configs: Array<McpConfig | null> = [
      { version: 1, servers: [stdioServer("alpha")] },
      { version: 1, servers: [stdioServer("beta")] },
    ];
    const controller = new McpRuntimeController({
      projectRoot: tempDir,
      secretStore: new McpSecretStore({ homeDir: tempDir }),
      toolRegistry: registry,
      trustManager: new TrustManager(),
      loadConfig: async () => configs.shift() ?? null,
      createManager: ({ servers }) => {
        const manager = new FakeReloadManager(servers.map((server) => server.id));
        managers.push(manager);
        return manager as unknown as McpClientManager;
      },
    });

    await controller.initialize();
    expect(registry.has("mcp_alpha_echo")).toBe(true);

    const result = await controller.reload();

    expect(result.addedServerIds).toEqual(["beta"]);
    expect(result.removedServerIds).toEqual(["alpha"]);
    expect(result.toolSync.registered).toEqual(["mcp_beta_echo"]);
    expect(managers[0]?.stopAllCalls).toBe(1);
    expect(registry.has("mcp_alpha_echo")).toBe(false);
    expect(registry.has("mcp_beta_echo")).toBe(true);
  });

  test("reload сохраняет текущий manager и tools, если новый config не загрузился", async () => {
    const registry = new ToolRegistry();
    const managers: FakeReloadManager[] = [];
    let shouldFail = false;
    const controller = new McpRuntimeController({
      projectRoot: tempDir,
      secretStore: new McpSecretStore({ homeDir: tempDir }),
      toolRegistry: registry,
      trustManager: new TrustManager(),
      loadConfig: async () => {
        if (shouldFail) throw new Error("broken mcp json");
        return { version: 1, servers: [stdioServer("alpha")] };
      },
      createManager: ({ servers }) => {
        const manager = new FakeReloadManager(servers.map((server) => server.id));
        managers.push(manager);
        return manager as unknown as McpClientManager;
      },
    });

    await controller.initialize();
    shouldFail = true;

    await expect(controller.reload()).rejects.toThrow("broken mcp json");

    expect(controller.getManager()).toBe(managers[0] as unknown as McpClientManager);
    expect(managers[0]?.stopAllCalls).toBe(0);
    expect(registry.has("mcp_alpha_echo")).toBe(true);
  });
});

class FakeReloadManager {
  stopAllCalls = 0;
  private readonly serverIds: string[];

  constructor(serverIds: string[]) {
    this.serverIds = serverIds;
  }

  getServerIds(): string[] {
    return this.serverIds.slice();
  }

  getStatus(): McpClientManagerStatus {
    const servers = this.serverIds.map((id) => ({
      id,
      name: id,
      transport: "stdio" as const,
      authState: {
        type: "not_applicable" as const,
        state: "not_required" as const,
        detail: "stdio",
        nextAction: null,
      },
      enabled: true,
      started: true,
      state: "ready" as const,
      lifecycle: "modern" as const,
      protocolVersion: "2026-07-28",
      lastError: null,
      lastErrorCode: null,
      toolsListChanged: false,
      crashRestartCount: 0,
      restartExhausted: false,
    }));
    return {
      servers,
      counts: {
        idle: 0,
        starting: 0,
        ready: servers.length,
        degraded: 0,
        stopping: 0,
        stopped: 0,
        crashed: 0,
      },
    };
  }

  getServerSecurity(serverId: string): McpServerSecurity {
    return {
      serverId,
      trustMode: "normal",
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
      env: {},
    };
  }

  async getClient(serverId: string): Promise<unknown> {
    return {
      listTools: async () => [
        {
          name: "echo",
          description: `Echo from ${serverId}`,
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ],
      callTool: async () => ({
        content: [{ type: "text", text: `${serverId}:ok` }],
        isError: false,
      }),
    };
  }

  async start(_serverId: string): Promise<unknown> {
    return {};
  }

  async stopAll(): Promise<void> {
    this.stopAllCalls += 1;
  }
}

function stdioServer(id: string): McpServerConfig {
  return {
    id,
    name: id,
    transport: "stdio",
    command: "echo",
    args: [],
    env: {},
    cwd: tempDir,
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
    trustMode: "normal",
    enabled: true,
  };
}
