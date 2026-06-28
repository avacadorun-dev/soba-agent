import type { TrustController } from "../../engine/permissions/trust-controller";
import type { ToolRegistry } from "../../kernel/tools/tool-registry";
import type { McpManagedServerStatus } from "./client-manager";
import { applyMcpToolTrustRules, createDefaultMcpServerSecurity, type McpToolTrustRule } from "./security";
import { buildMcpToolDefinitionsForServers, MCP_TOOL_PROXY_PREFIX, type McpToolProxyOptions, type McpToolProxySource } from "./tool-proxy";

const MCP_TOOL_NAME_PREFIX = `${MCP_TOOL_PROXY_PREFIX}_`;

export interface McpToolRegistrySyncSource extends McpToolProxySource {
  getStatus(): { servers: McpManagedServerStatus[] };
}

export interface McpToolRegistrySyncResult {
  removed: number;
  registered: string[];
  trustRules: McpToolTrustRule[];
  skipped: Array<{
    serverId: string;
    reason: string;
  }>;
}

export interface McpToolRegistrySyncOptions extends McpToolProxyOptions {
  trustManager?: TrustController;
}

export async function syncMcpToolsIntoRegistry(
  registry: ToolRegistry,
  source: McpToolRegistrySyncSource,
  options: McpToolRegistrySyncOptions = {},
): Promise<McpToolRegistrySyncResult> {
  const removed = registry.unregisterByPrefix(MCP_TOOL_NAME_PREFIX);
  const registered: string[] = [];
  const trustRules: McpToolTrustRule[] = [];
  const skipped: Array<{ serverId: string; reason: string }> = [];

  const readyServers = source
    .getStatus()
    .servers.filter((server) => server.enabled && server.state === "ready" && !server.restartExhausted)
    .map((server) => server.id);

  for (const serverId of readyServers) {
    try {
      const definitions = await buildMcpToolDefinitionsForServers(source, [serverId], options);
      for (const definition of definitions) {
        registry.register(definition);
        registered.push(definition.name);
        trustRules.push({
          proxyName: definition.name,
          serverId,
          trustMode: (source.getServerSecurity?.(serverId) ?? createDefaultMcpServerSecurity(serverId)).trustMode,
        });
      }
    } catch (error) {
      skipped.push({
        serverId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (options.trustManager) {
    applyMcpToolTrustRules(options.trustManager, trustRules);
  }

  return {
    removed,
    registered,
    trustRules,
    skipped,
  };
}
