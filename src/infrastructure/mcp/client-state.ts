export const MCP_CLIENT_STATES = ["idle", "starting", "ready", "degraded", "stopping", "stopped", "crashed"] as const;

export type McpClientState = (typeof MCP_CLIENT_STATES)[number];

export interface McpClientStateSnapshot {
  state: McpClientState;
  serverId: string;
  protocolVersion: string | null;
  lifecycle: "modern" | "legacy" | null;
  capabilities: Record<string, unknown>;
  serverInfo: Record<string, unknown> | null;
  lastError: string | null;
  lastErrorCode: string | null;
  toolsListChanged: boolean;
}
