export type McpManagedServerAuthType = "none" | "bearerEnv" | "apiKeyEnv" | "oauth" | "not_applicable";
export type McpManagedServerAuthState =
  | "not_required"
  | "configured"
  | "missing_env"
  | "login_required"
  | "authenticated"
  | "auth_required";

export interface McpManagedServerAuthStatus {
  type: McpManagedServerAuthType;
  state: McpManagedServerAuthState;
  detail: string | null;
  nextAction: string | null;
}

export interface McpRemoteAuthCommandResult {
  status: McpManagedServerAuthStatus;
  message: string;
  details: string | null;
}

export interface McpManagedServerSecurity {
  serverId: string;
  trustMode: "safe" | "normal" | "dangerous";
  timeoutMs: number;
  maxOutputBytes: number;
  env?: Record<string, string>;
}

export interface McpManagedServerStatus {
  id: string;
  name: string;
  transport?: "stdio" | "streamableHttp";
  authState?: McpManagedServerAuthStatus;
  enabled: boolean;
  started: boolean;
  state: "idle" | "starting" | "ready" | "degraded" | "stopping" | "stopped" | "crashed";
  lifecycle: "modern" | "legacy" | null;
  protocolVersion: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  toolsListChanged: boolean;
  crashRestartCount: number;
  restartExhausted: boolean;
}

export interface McpClientManagerStatus {
  servers: McpManagedServerStatus[];
  counts: Record<McpManagedServerStatus["state"], number>;
}

export interface McpRuntimeManager {
  getServerIds(): string[];
  getClient(serverId: string): Promise<any>;
  getStatus(): McpClientManagerStatus;
  getServerSecurity(serverId: string): McpManagedServerSecurity;
  start(serverId: string): Promise<unknown>;
  stop(serverId: string): Promise<void>;
  restart(serverId: string): Promise<unknown>;
  getAuthStatus(serverId: string): Promise<McpRemoteAuthCommandResult>;
  login(serverId: string): Promise<McpRemoteAuthCommandResult>;
  logout(serverId: string): Promise<McpRemoteAuthCommandResult>;
}

export interface McpRuntimeToolTrustRule {
  proxyName: string;
  serverId: string;
  trustMode: "safe" | "normal" | "dangerous";
}

export interface McpToolRegistrySyncResult {
  removed: number;
  registered: string[];
  trustRules: McpRuntimeToolTrustRule[];
  skipped: Array<{
    serverId: string;
    reason: string;
  }>;
}

export interface McpRuntimeReloadResult {
  previousServerIds: string[];
  serverIds: string[];
  addedServerIds: string[];
  removedServerIds: string[];
  restartedServerIds: string[];
  toolSync: McpToolRegistrySyncResult;
}

export interface McpRuntimeControllerLike {
  getManager(): McpRuntimeManager | undefined;
  reload(): Promise<McpRuntimeReloadResult>;
  syncTools(): Promise<McpToolRegistrySyncResult>;
}
