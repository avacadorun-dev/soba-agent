import type { McpRuntimeControllerLike, McpRuntimeReloadResult, McpToolRegistrySyncResult } from "../../application/mcp-runtime-controller";
import type { TrustController } from "../../kernel/permissions/trust";
import type { ToolRegistry } from "../../kernel/tools/tool-registry";
import type { McpClientManager } from "./client-manager";
import { McpClientManager as DefaultMcpClientManager } from "./client-manager";
import { loadMcpConfig } from "./config";
import type { McpSecretStore } from "./secret-store";
import { MCP_TOOL_PROXY_PREFIX } from "./tool-proxy";
import { syncMcpToolsIntoRegistry } from "./tool-registry-sync";
import type { McpConfig, McpConfigLoadOptions, McpServerConfig } from "./types";

const MCP_TOOL_NAME_PREFIX = `${MCP_TOOL_PROXY_PREFIX}_`;

interface McpRuntimeControllerOptions {
  projectRoot: string;
  secretStore: McpSecretStore;
  toolRegistry: ToolRegistry;
  trustManager: TrustController;
  loadConfig?: (options: McpConfigLoadOptions) => Promise<McpConfig | null>;
  createManager?: (input: { servers: McpServerConfig[]; env: Record<string, string | undefined> }) => McpClientManager;
}

export class McpRuntimeController implements McpRuntimeControllerLike {
  private manager?: McpClientManager;
  private readonly projectRoot: string;
  private readonly secretStore: McpSecretStore;
  private readonly toolRegistry: ToolRegistry;
  private readonly trustManager: TrustController;
  private readonly loadConfig: (options: McpConfigLoadOptions) => Promise<McpConfig | null>;
  private readonly createManager: (input: { servers: McpServerConfig[]; env: Record<string, string | undefined> }) => McpClientManager;

  constructor(options: McpRuntimeControllerOptions) {
    this.projectRoot = options.projectRoot;
    this.secretStore = options.secretStore;
    this.toolRegistry = options.toolRegistry;
    this.trustManager = options.trustManager;
    this.loadConfig = options.loadConfig ?? loadMcpConfig;
    this.createManager = options.createManager ?? ((input) => new DefaultMcpClientManager(input));
  }

  getManager(): McpClientManager | undefined {
    return this.manager;
  }

  async initialize(): Promise<McpRuntimeReloadResult> {
    return this.reload({ preserveStarted: false, stopPrevious: false });
  }

  async reload(): Promise<McpRuntimeReloadResult>;
  async reload(options: { preserveStarted?: boolean; stopPrevious?: boolean }): Promise<McpRuntimeReloadResult>;
  async reload(options: { preserveStarted?: boolean; stopPrevious?: boolean } = {}): Promise<McpRuntimeReloadResult> {
    const preserveStarted = options.preserveStarted ?? true;
    const stopPrevious = options.stopPrevious ?? true;
    const previousManager = this.manager;
    const previousServerIds = previousManager?.getServerIds() ?? [];
    const previouslyStartedIds = preserveStarted
      ? new Set(
        previousManager
          ?.getStatus()
          .servers
          .filter((server) => server.enabled && server.started)
          .map((server) => server.id) ?? [],
      )
      : new Set<string>();

    const env = await this.secretStore.env();
    const config = await this.loadConfig({
      projectRoot: this.projectRoot,
      env,
      allowMissingEnv: true,
    });
    const nextManager = config ? this.createManager({ servers: config.servers, env }) : undefined;
    const serverIds = nextManager?.getServerIds() ?? [];

    this.manager = nextManager;
    const restartedServerIds = await this.restartPreservedServers(nextManager, previouslyStartedIds);
    const toolSync = await this.syncTools();

    if (stopPrevious && previousManager && previousManager !== nextManager) {
      await previousManager.stopAll();
    }

    return {
      previousServerIds,
      serverIds,
      addedServerIds: difference(serverIds, previousServerIds),
      removedServerIds: difference(previousServerIds, serverIds),
      restartedServerIds,
      toolSync,
    };
  }

  async syncTools(): Promise<McpToolRegistrySyncResult> {
    const manager = this.manager;
    if (!manager) {
      return emptySyncResult(this.toolRegistry.unregisterByPrefix(MCP_TOOL_NAME_PREFIX));
    }

    return syncMcpToolsIntoRegistry(this.toolRegistry, manager, {
      trustManager: this.trustManager,
    });
  }

  private async restartPreservedServers(manager: McpClientManager | undefined, serverIds: Set<string>): Promise<string[]> {
    if (!manager || serverIds.size === 0) {
      return [];
    }

    const restarted: string[] = [];
    for (const serverId of serverIds) {
      if (!manager.getServerIds().includes(serverId)) {
        continue;
      }
      try {
        await manager.start(serverId);
        restarted.push(serverId);
      } catch {
        // Status and sync output expose failed servers; reload should still
        // complete so users can inspect and fix the new config in-session.
      }
    }
    return restarted;
  }
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((entry) => !rightSet.has(entry));
}

function emptySyncResult(removed: number): McpToolRegistrySyncResult {
  return {
    removed,
    registered: [],
    trustRules: [],
    skipped: [],
  };
}
