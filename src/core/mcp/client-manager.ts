import { McpClient } from "./client";
import type { McpClientState, McpClientStateSnapshot } from "./client-state";
import type { McpServerSecurity } from "./security";
import { McpStdioTransport } from "./stdio-transport";
import { McpStreamableHttpTransport } from "./streamable-http-transport";
import type { McpTransportEventHandler } from "./transport";
import type { McpRemoteAuthConfig, McpServerConfig, McpServerTransport, McpStdioServerConfig, McpStreamableHttpServerConfig } from "./types";

const DEFAULT_MAX_CRASH_RESTARTS = 2;

export type McpClientManagerErrorCode = "unknown_server" | "disabled_server" | "duplicate_server" | "restart_exhausted";

export interface McpClientManagerOptions {
  servers: McpServerConfig[];
  createClient?: (server: McpServerConfig) => McpClient;
  maxCrashRestarts?: number;
  authController?: McpRemoteAuthController;
  env?: Record<string, string | undefined>;
}

export type McpManagedServerAuthType = McpRemoteAuthConfig["type"] | "not_applicable";
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

export interface McpRemoteAuthController {
  cachedStatus?: (server: McpStreamableHttpServerConfig) => McpManagedServerAuthStatus | null;
  status?: (server: McpStreamableHttpServerConfig) => Promise<McpRemoteAuthCommandResult>;
  login?: (server: McpStreamableHttpServerConfig) => Promise<McpRemoteAuthCommandResult>;
  logout?: (server: McpStreamableHttpServerConfig) => Promise<McpRemoteAuthCommandResult>;
}

export interface McpManagedServerStatus {
  id: string;
  name: string;
  transport?: McpServerTransport;
  authState?: McpManagedServerAuthStatus;
  enabled: boolean;
  started: boolean;
  state: McpClientState;
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
  counts: Record<McpClientState, number>;
}

export class McpClientManagerError extends Error {
  readonly code: McpClientManagerErrorCode;
  readonly serverId?: string;

  constructor(code: McpClientManagerErrorCode, message: string, options: { serverId?: string } = {}) {
    super(message);
    this.name = "McpClientManagerError";
    this.code = code;
    this.serverId = options.serverId;
  }
}

interface ManagedClientEntry {
  server: McpServerConfig;
  client: McpClient | null;
  startPromise: Promise<McpClient> | null;
  crashRestartCount: number;
  restartExhausted: boolean;
}

export class McpClientManager {
  private readonly entries = new Map<string, ManagedClientEntry>();
  private readonly createClient: (server: McpServerConfig) => McpClient;
  private readonly maxCrashRestarts: number;
  private readonly authController?: McpRemoteAuthController;
  private readonly env: Record<string, string | undefined>;

  constructor(options: McpClientManagerOptions) {
    this.env = options.env ?? process.env;
    this.createClient = options.createClient ?? ((server) => createDefaultClient(server, this.env));
    this.maxCrashRestarts = Math.max(0, Math.floor(options.maxCrashRestarts ?? DEFAULT_MAX_CRASH_RESTARTS));
    this.authController = options.authController;

    for (const server of options.servers) {
      if (this.entries.has(server.id)) {
        throw new McpClientManagerError("duplicate_server", `Duplicate MCP server id: ${server.id}.`, { serverId: server.id });
      }

      this.entries.set(server.id, {
        server,
        client: null,
        startPromise: null,
        crashRestartCount: 0,
        restartExhausted: false,
      });
    }
  }

  getServerIds(): string[] {
    return [...this.entries.keys()];
  }

  getClientIfStarted(serverId: string): McpClient | null {
    return this.getEntry(serverId).client;
  }

  getServerSecurity(serverId: string): McpServerSecurity {
    const server = this.getEntry(serverId).server;
    return {
      serverId: server.id,
      trustMode: server.trustMode,
      timeoutMs: server.timeoutMs,
      maxOutputBytes: server.maxOutputBytes,
      env: server.transport === "stdio" ? server.env : {},
    };
  }

  async getClient(serverId: string): Promise<McpClient> {
    const entry = this.getEntry(serverId);
    this.assertEnabled(entry);

    const client = entry.client;
    if (!client) {
      return this.startEntry(entry);
    }

    const state = client.getState().state;
    if (isRecoverableClientState(state)) {
      return this.recoverEntry(entry);
    }
    if (state === "stopped") {
      return this.startEntry(entry);
    }

    return client;
  }

  async start(serverId: string): Promise<McpClient> {
    const entry = this.getEntry(serverId);
    this.assertEnabled(entry);

    const current = entry.client;
    if (current) {
      const state = current.getState().state;
      if (state === "ready" || state === "starting") {
        return current;
      }
      if (isRecoverableClientState(state)) {
        return this.recoverEntry(entry);
      }
    }

    return this.startEntry(entry);
  }

  async stop(serverId: string): Promise<void> {
    const entry = this.getEntry(serverId);
    await this.stopEntry(entry);
  }

  async restart(serverId: string): Promise<McpClient> {
    const entry = this.getEntry(serverId);
    this.assertEnabled(entry);

    await this.stopEntry(entry);
    entry.client = null;
    entry.restartExhausted = false;
    entry.crashRestartCount = 0;
    return this.startEntry(entry);
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.entries.values()].map((entry) => this.stopEntry(entry)));
  }

  getStatus(): McpClientManagerStatus {
    const servers = [...this.entries.values()].map((entry) => this.statusForEntry(entry));
    return {
      servers,
      counts: countStates(servers),
    };
  }

  async getAuthStatus(serverId: string): Promise<McpRemoteAuthCommandResult> {
    const entry = this.getEntry(serverId);
    if (entry.server.transport !== "streamableHttp") {
      return {
        status: authStatusForServer(entry.server, null, this.env),
        message: `MCP server "${entry.server.id}" uses stdio and does not require remote auth.`,
        details: null,
      };
    }

    return this.authController?.status?.(entry.server) ?? {
      status: this.remoteAuthStatusForEntry(entry),
      message: `MCP auth status for "${entry.server.id}": ${this.remoteAuthStatusForEntry(entry).state}.`,
      details: null,
    };
  }

  async login(serverId: string): Promise<McpRemoteAuthCommandResult> {
    const entry = this.getEntry(serverId);
    if (entry.server.transport !== "streamableHttp") {
      return {
        status: authStatusForServer(entry.server, null, this.env),
        message: `MCP server "${entry.server.id}" uses stdio and does not require remote auth.`,
        details: null,
      };
    }

    if (this.authController?.login) {
      return this.authController.login(entry.server);
    }

    const status = this.remoteAuthStatusForEntry(entry);
    const message =
      entry.server.auth.type === "oauth"
        ? `MCP OAuth login flow is not configured for "${entry.server.id}".`
        : `MCP server "${entry.server.id}" uses ${entry.server.auth.type}; ${status.nextAction ?? "no login flow is required"}.`;
    return {
      status,
      message,
      details: status.nextAction,
    };
  }

  async logout(serverId: string): Promise<McpRemoteAuthCommandResult> {
    const entry = this.getEntry(serverId);
    if (entry.server.transport !== "streamableHttp") {
      return {
        status: authStatusForServer(entry.server, null, this.env),
        message: `MCP server "${entry.server.id}" uses stdio and does not require remote auth.`,
        details: null,
      };
    }

    if (this.authController?.logout) {
      return this.authController.logout(entry.server);
    }

    const status = this.remoteAuthStatusForEntry(entry);
    return {
      status,
      message: `No stored MCP auth token was cleared for "${entry.server.id}".`,
      details: status.nextAction,
    };
  }

  private async recoverEntry(entry: ManagedClientEntry): Promise<McpClient> {
    if (entry.crashRestartCount >= this.maxCrashRestarts) {
      entry.restartExhausted = true;
      throw new McpClientManagerError(
        "restart_exhausted",
        `MCP server "${entry.server.id}" exceeded crash restart limit (${this.maxCrashRestarts}).`,
        { serverId: entry.server.id },
      );
    }

    entry.crashRestartCount += 1;
    await this.stopEntry(entry);
    entry.client = null;
    return this.startEntry(entry);
  }

  private async startEntry(entry: ManagedClientEntry): Promise<McpClient> {
    if (entry.startPromise) {
      return entry.startPromise;
    }

    const client = this.createClient(entry.server);
    entry.client = client;
    entry.startPromise = client
      .start()
      .then(() => client)
      .finally(() => {
        entry.startPromise = null;
      });

    return entry.startPromise;
  }

  private async stopEntry(entry: ManagedClientEntry): Promise<void> {
    if (entry.startPromise) {
      await entry.startPromise.catch(() => undefined);
    }

    const client = entry.client;
    if (!client) {
      return;
    }

    const state = client.getState().state;
    if (state === "stopped") {
      return;
    }

    await client.stop({ timeoutMs: entry.server.timeoutMs }).catch(() => undefined);
  }

  private getEntry(serverId: string): ManagedClientEntry {
    const entry = this.entries.get(serverId);
    if (!entry) {
      throw new McpClientManagerError("unknown_server", `Unknown MCP server id: ${serverId}.`, { serverId });
    }

    return entry;
  }

  private assertEnabled(entry: ManagedClientEntry): void {
    if (!entry.server.enabled) {
      throw new McpClientManagerError("disabled_server", `MCP server "${entry.server.id}" is disabled.`, { serverId: entry.server.id });
    }
  }

  private statusForEntry(entry: ManagedClientEntry): McpManagedServerStatus {
    const snapshot = entry.client?.getState() ?? idleSnapshot(entry.server);
    return {
      id: entry.server.id,
      name: entry.server.name,
      transport: entry.server.transport,
      authState: this.authStatusForEntry(entry, snapshot.lastErrorCode),
      enabled: entry.server.enabled,
      started: entry.client !== null,
      state: snapshot.state,
      lifecycle: snapshot.lifecycle,
      protocolVersion: snapshot.protocolVersion,
      lastError: snapshot.lastError,
      lastErrorCode: snapshot.lastErrorCode,
      toolsListChanged: snapshot.toolsListChanged,
      crashRestartCount: entry.crashRestartCount,
      restartExhausted: entry.restartExhausted,
    };
  }

  private authStatusForEntry(entry: ManagedClientEntry, lastErrorCode: string | null): McpManagedServerAuthStatus {
    if (entry.server.transport === "streamableHttp") {
      return this.authController?.cachedStatus?.(entry.server) ?? authStatusForServer(entry.server, lastErrorCode, this.env);
    }

    return authStatusForServer(entry.server, lastErrorCode, this.env);
  }

  private remoteAuthStatusForEntry(entry: ManagedClientEntry): McpManagedServerAuthStatus {
    const snapshot = entry.client?.getState() ?? idleSnapshot(entry.server);
    return this.authStatusForEntry(entry, snapshot.lastErrorCode);
  }
}

function isRecoverableClientState(state: McpClientState): boolean {
  return state === "crashed" || state === "degraded";
}

function authStatusForServer(
  server: McpServerConfig,
  lastErrorCode: string | null,
  env: Record<string, string | undefined> = process.env,
): McpManagedServerAuthStatus {
  if (server.transport === "stdio") {
    return {
      type: "not_applicable",
      state: "not_required",
      detail: "stdio",
      nextAction: null,
    };
  }

  if (lastErrorCode === "auth_required") {
    if (server.transport === "streamableHttp" && (server.auth.type === "bearerEnv" || server.auth.type === "apiKeyEnv")) {
      return {
        type: server.auth.type,
        state: "auth_required",
        detail: `server rejected credentials from ${server.auth.env}`,
        nextAction: `Verify ${server.auth.env}, the configured auth header, and the provider workspace/project access; then restart ${server.id}.`,
      };
    }

    return {
      type: server.auth.type,
      state: "auth_required",
      detail: "server rejected the current credentials",
      nextAction: `Run /mcp auth login ${server.id}`,
    };
  }

  if (server.auth.type === "none") {
    return {
      type: "none",
      state: "not_required",
      detail: "none",
      nextAction: null,
    };
  }

  if (server.auth.type === "bearerEnv" || server.auth.type === "apiKeyEnv") {
    const configured = (env[server.auth.env] ?? "").length > 0;
    return {
      type: server.auth.type,
      state: configured ? "configured" : "missing_env",
      detail: server.auth.env,
      nextAction: configured ? null : `Set ${server.auth.env} and restart SOBA.`,
    };
  }

  return {
    type: "oauth",
    state: "login_required",
    detail: "oauth",
    nextAction: `Run /mcp auth login ${server.id}`,
  };
}

function createDefaultClient(server: McpServerConfig, env: Record<string, string | undefined>): McpClient {
  if (server.transport === "streamableHttp") {
    return createStreamableHttpClientForServer(server, env);
  }

  return createStdioClientForServer(server);
}

function createStdioClientForServer(server: McpStdioServerConfig): McpClient {
  return new McpClient({
    server,
    transportFactory: (onEvent: McpTransportEventHandler) =>
      new McpStdioTransport({
        command: server.command,
        args: server.args,
        cwd: server.cwd,
        env: server.env,
        shutdownTimeoutMs: server.timeoutMs,
        onMessage: () => undefined,
        onEvent,
      }),
  });
}

function createStreamableHttpClientForServer(
  server: McpStreamableHttpServerConfig,
  env: Record<string, string | undefined>,
): McpClient {
  return new McpClient({
    server,
    transportFactory: (onEvent: McpTransportEventHandler) =>
      new McpStreamableHttpTransport({
        url: server.url,
        headers: server.headers,
        auth: server.auth,
        env,
        timeoutMs: server.timeoutMs,
        onEvent,
      }),
  });
}

function idleSnapshot(server: McpServerConfig): McpClientStateSnapshot {
  return {
    state: "idle",
    serverId: server.id,
    protocolVersion: null,
    lifecycle: null,
    capabilities: {},
    serverInfo: null,
    lastError: null,
    lastErrorCode: null,
    toolsListChanged: false,
  };
}

function countStates(servers: McpManagedServerStatus[]): Record<McpClientState, number> {
  const counts: Record<McpClientState, number> = {
    idle: 0,
    starting: 0,
    ready: 0,
    degraded: 0,
    stopping: 0,
    stopped: 0,
    crashed: 0,
  };

  for (const server of servers) {
    counts[server.state] += 1;
  }

  return counts;
}
