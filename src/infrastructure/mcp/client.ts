import { APP_VERSION } from "../../core/version";
import type { McpClientState, McpClientStateSnapshot } from "./client-state";
import { JsonRpcEndpoint, JsonRpcError, type JsonRpcNotification, type JsonRpcParams } from "./json-rpc";
import { type McpTransport, McpTransportError, type McpTransportEvent, type McpTransportEventHandler } from "./transport";
import type { McpServerConfig } from "./types";

export type { McpTransport as McpClientTransport, McpTransportEventHandler as McpClientTransportHandlers } from "./transport";

export const MCP_RELEASED_PROTOCOL_VERSION = "2025-11-25";
export const MCP_LEGACY_2025_06_PROTOCOL_VERSION = "2025-06-18";
export const MCP_LEGACY_2025_03_PROTOCOL_VERSION = "2025-03-26";
export const MCP_LEGACY_2024_11_PROTOCOL_VERSION = "2024-11-05";
export const MCP_DRAFT_PROTOCOL_VERSION = "2026-07-28";
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  MCP_DRAFT_PROTOCOL_VERSION,
  MCP_RELEASED_PROTOCOL_VERSION,
  MCP_LEGACY_2025_06_PROTOCOL_VERSION,
  MCP_LEGACY_2025_03_PROTOCOL_VERSION,
  MCP_LEGACY_2024_11_PROTOCOL_VERSION,
] as const;

const DEFAULT_CLIENT_NAME = "soba-agent";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface McpClientOptions {
  server: McpServerConfig;
  transportFactory: (handler: McpTransportEventHandler) => McpTransport;
  requestTimeoutMs?: number;
  clientInfo?: McpClientInfo;
  clientCapabilities?: Record<string, unknown>;
}

export interface McpClientStartOptions {
  signal?: AbortSignal;
}

export interface McpClientStopOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface McpClientInfo {
  name: string;
  version: string;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
  title?: string;
  [key: string]: unknown;
}

export interface McpToolCallResult {
  content?: unknown;
  structuredContent?: unknown;
  resultType?: string;
  ttlMs?: number;
  cacheScope?: string;
  isError?: boolean;
  [key: string]: unknown;
}

export type McpClientErrorCode =
  | "invalid_state"
  | "incompatible_protocol"
  | "missing_capability"
  | "transport_error"
  | "auth_required"
  | "request_failed"
  | "invalid_response";

export class McpClientError extends Error {
  readonly code: McpClientErrorCode;
  readonly cause?: unknown;

  constructor(code: McpClientErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = "McpClientError";
    this.code = code;
    this.cause = options.cause;
  }
}

export class McpClient {
  private readonly server: McpServerConfig;
  private readonly requestTimeoutMs: number;
  private readonly clientInfo: McpClientInfo;
  private readonly clientCapabilities: Record<string, unknown>;
  private readonly endpoint: JsonRpcEndpoint;
  private readonly transport: McpTransport;
  private state: McpClientState = "idle";
  private protocolVersion: string | null = null;
  private lifecycle: "modern" | "legacy" | null = null;
  private capabilities: Record<string, unknown> = {};
  private serverInfo: Record<string, unknown> | null = null;
  private lastError: string | null = null;
  private lastErrorCode: string | null = null;
  private toolsCache: McpTool[] | null = null;
  private toolsListChanged = false;

  constructor(options: McpClientOptions) {
    this.server = options.server;
    this.requestTimeoutMs = options.requestTimeoutMs ?? options.server.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.clientInfo = options.clientInfo ?? {
      name: DEFAULT_CLIENT_NAME,
      version: APP_VERSION,
    };
    this.clientCapabilities = options.clientCapabilities ?? {
      tools: {},
    };
    this.endpoint = new JsonRpcEndpoint({
      send: (message, sendOptions) => this.transport.send(message, sendOptions),
      onNotification: (notification) => this.handleNotification(notification),
      onProtocolError: (error) => this.setDegraded(error.message),
      defaultTimeoutMs: this.requestTimeoutMs,
    });
    this.transport = options.transportFactory((event) => {
      this.handleTransportEvent(event);
    });
  }

  getState(): McpClientStateSnapshot {
    return {
      state: this.state,
      serverId: this.server.id,
      protocolVersion: this.protocolVersion,
      lifecycle: this.lifecycle,
      capabilities: { ...this.capabilities },
      serverInfo: this.serverInfo ? { ...this.serverInfo } : null,
      lastError: this.lastError,
      lastErrorCode: this.lastErrorCode,
      toolsListChanged: this.toolsListChanged,
    };
  }

  async start(options: McpClientStartOptions = {}): Promise<void> {
    if (this.state !== "idle" && this.state !== "stopped" && this.state !== "crashed") {
      throw new McpClientError("invalid_state", `Cannot start MCP client from state ${this.state}.`);
    }

    this.transition("starting");
    try {
      await this.transport.start({ signal: options.signal });
      const modernStarted = await this.tryModernDiscover(options.signal);
      if (!modernStarted) {
        await this.startLegacy(options.signal);
      }

      if (!hasToolsCapability(this.capabilities)) {
        throw new McpClientError("missing_capability", "MCP server does not advertise tools capability.");
      }

      this.transition("ready");
    } catch (error) {
      this.lastError = formatError(error);
      this.lastErrorCode = errorCode(error);
      this.transition("degraded");
      await this.safeShutdown();
      throw toMcpClientError(error, "Failed to start MCP client.");
    }
  }

  async stop(options: McpClientStopOptions = {}): Promise<void> {
    if (this.state === "stopped") {
      return;
    }

    this.transition("stopping");
    this.endpoint.close("MCP client stopped.");
    await this.transport.shutdown(options);
    this.transition("stopped");
  }

  async listTools(options: { signal?: AbortSignal; timeoutMs?: number; refresh?: boolean } = {}): Promise<McpTool[]> {
    this.assertReady();
    if (this.toolsCache && !this.toolsListChanged && !options.refresh) {
      return cloneTools(this.toolsCache);
    }

    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const params = this.withMeta(cursor ? { cursor } : {});
      const result = await this.request("tools/list", params, options);
      const parsed = parseToolsListResult(result);
      tools.push(...parsed.tools);
      cursor = parsed.nextCursor;
    } while (cursor);

    this.toolsCache = tools;
    this.toolsListChanged = false;
    return cloneTools(tools);
  }

  async callTool(name: string, args: Record<string, unknown> = {}, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<McpToolCallResult> {
    this.assertReady();
    const result = await this.request(
      "tools/call",
      this.withMeta({
        name,
        arguments: args,
      }),
      options,
    );
    return parseToolCallResult(result);
  }

  receive(message: string | unknown): void {
    this.endpoint.receive(message);
  }

  private async tryModernDiscover(signal: AbortSignal | undefined): Promise<boolean> {
    try {
      const result = await this.endpoint.request(
        "server/discover",
        {
          supportedProtocolVersions: [...MCP_SUPPORTED_PROTOCOL_VERSIONS],
          clientInfo: this.clientInfo,
          capabilities: this.clientCapabilities,
        },
        { timeoutMs: this.requestTimeoutMs, signal },
      );
      const discovered = parseDiscoverResult(result);
      const protocolVersion = chooseProtocolVersion(discovered.protocolVersions);
      if (!protocolVersion) {
        throw new McpClientError("incompatible_protocol", "MCP server has no mutually supported protocol version.");
      }

      this.protocolVersion = protocolVersion;
      this.lifecycle = "modern";
      this.capabilities = discovered.capabilities;
      this.serverInfo = discovered.serverInfo;
      return true;
    } catch (error) {
      if (error instanceof McpClientError && error.code === "incompatible_protocol") {
        throw error;
      }
      if (isAuthRequiredError(error) || this.lastErrorCode === "auth_required") {
        if (error instanceof McpTransportError) {
          throw error;
        }

        throw new McpClientError("auth_required", formatError(error), { cause: error });
      }

      return false;
    }
  }

  private async startLegacy(signal: AbortSignal | undefined): Promise<void> {
    const result = await this.endpoint.request(
      "initialize",
      {
        protocolVersion: MCP_RELEASED_PROTOCOL_VERSION,
        capabilities: this.clientCapabilities,
        clientInfo: this.clientInfo,
      },
      { timeoutMs: this.requestTimeoutMs, signal },
    );
    const initialized = parseInitializeResult(result);
    const protocolVersion = chooseProtocolVersion([initialized.protocolVersion]);
    if (!protocolVersion) {
      throw new McpClientError("incompatible_protocol", `MCP server protocol ${initialized.protocolVersion} is not supported.`);
    }

    this.protocolVersion = protocolVersion;
    this.lifecycle = "legacy";
    this.capabilities = initialized.capabilities;
    this.serverInfo = initialized.serverInfo;
    this.endpoint.notify("notifications/initialized");
  }

  private async request(method: string, params: JsonRpcParams, options: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown> {
    try {
      return await this.endpoint.request(method, params, {
        timeoutMs: options.timeoutMs ?? this.requestTimeoutMs,
        signal: options.signal,
      });
    } catch (error) {
      throw toMcpClientError(error, `MCP request ${method} failed.`);
    }
  }

  private withMeta(params: Record<string, unknown>): Record<string, unknown> {
    if (this.lifecycle !== "modern" || !this.protocolVersion) {
      return params;
    }

    return {
      ...params,
      _meta: {
        protocolVersion: this.protocolVersion,
        clientInfo: this.clientInfo,
        capabilities: this.clientCapabilities,
      },
    };
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (notification.method === "notifications/tools/list_changed") {
      this.toolsCache = null;
      this.toolsListChanged = true;
      if (this.state === "ready") {
        this.lastError = null;
      }
    }
  }

  private handleTransportError(error: unknown): void {
    this.lastError = formatError(error);
    this.lastErrorCode = errorCode(error);
    this.transition(this.state === "stopping" ? "stopped" : "crashed");
    this.endpoint.close(this.lastError ?? "MCP transport error.");
  }

  private handleTransportEvent(event: McpTransportEvent): void {
    if (event.type === "message") {
      this.endpoint.receive(event.message);
      return;
    }
    if (event.type === "error") {
      this.handleTransportError(event.error);
    }
  }

  private setDegraded(message: string): void {
    this.lastError = message;
    this.lastErrorCode = "protocol_error";
    if (this.state === "ready") {
      this.transition("degraded");
    }
  }

  private assertReady(): void {
    if (this.state !== "ready") {
      throw new McpClientError("invalid_state", `MCP client is not ready; current state is ${this.state}.`);
    }
  }

  private transition(next: McpClientState): void {
    this.state = next;
    if (next === "ready") {
      this.lastError = null;
      this.lastErrorCode = null;
    }
  }

  private async safeShutdown(): Promise<void> {
    try {
      await this.transport.shutdown({ timeoutMs: 100 });
    } catch {
      // Startup failure cleanup is best-effort. The caller receives the original error.
    }
  }
}

interface DiscoverResult {
  protocolVersions: string[];
  capabilities: Record<string, unknown>;
  serverInfo: Record<string, unknown> | null;
}

interface InitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: Record<string, unknown> | null;
}

function parseDiscoverResult(value: unknown): DiscoverResult {
  if (!isRecord(value)) {
    throw new McpClientError("invalid_response", "server/discover result must be an object.");
  }

  const versions = Array.isArray(value.protocolVersions)
    ? value.protocolVersions.filter((version): version is string => typeof version === "string")
    : typeof value.protocolVersion === "string"
      ? [value.protocolVersion]
      : [];

  return {
    protocolVersions: versions,
    capabilities: isRecord(value.capabilities) ? value.capabilities : {},
    serverInfo: isRecord(value.serverInfo) ? value.serverInfo : null,
  };
}

function parseInitializeResult(value: unknown): InitializeResult {
  if (!isRecord(value)) {
    throw new McpClientError("invalid_response", "initialize result must be an object.");
  }
  if (typeof value.protocolVersion !== "string") {
    throw new McpClientError("invalid_response", "initialize result must include protocolVersion.");
  }

  return {
    protocolVersion: value.protocolVersion,
    capabilities: isRecord(value.capabilities) ? value.capabilities : {},
    serverInfo: isRecord(value.serverInfo) ? value.serverInfo : null,
  };
}

function parseToolsListResult(value: unknown): { tools: McpTool[]; nextCursor?: string } {
  if (!isRecord(value) || !Array.isArray(value.tools)) {
    throw new McpClientError("invalid_response", "tools/list result must include tools array.");
  }

  return {
    tools: value.tools.map(parseTool),
    ...(typeof value.nextCursor === "string" && value.nextCursor.length > 0 ? { nextCursor: value.nextCursor } : {}),
  };
}

function parseTool(value: unknown): McpTool {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.length === 0) {
    throw new McpClientError("invalid_response", "MCP tool must include a name.");
  }

  return { ...value, name: value.name };
}

function parseToolCallResult(value: unknown): McpToolCallResult {
  if (!isRecord(value)) {
    throw new McpClientError("invalid_response", "tools/call result must be an object.");
  }

  return { ...value };
}

function chooseProtocolVersion(versions: string[]): string | null {
  for (const supported of MCP_SUPPORTED_PROTOCOL_VERSIONS) {
    if (versions.includes(supported)) {
      return supported;
    }
  }

  return null;
}

function hasToolsCapability(capabilities: Record<string, unknown>): boolean {
  return isRecord(capabilities.tools);
}

function cloneTools(tools: McpTool[]): McpTool[] {
  return tools.map((tool) => ({ ...tool }));
}

function toMcpClientError(error: unknown, fallbackMessage: string): McpClientError {
  if (error instanceof McpClientError) {
    return error;
  }
  if (error instanceof JsonRpcError) {
    return new McpClientError("request_failed", `${fallbackMessage} ${error.message}`, { cause: error });
  }
  if (error instanceof McpTransportError && error.code === "auth_required") {
    return new McpClientError("auth_required", `${fallbackMessage} ${error.message}`, { cause: error });
  }
  if (error instanceof Error) {
    return new McpClientError("transport_error", `${fallbackMessage} ${error.message}`, { cause: error });
  }

  return new McpClientError("transport_error", `${fallbackMessage} ${String(error)}`, { cause: error });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | null {
  if (isRecord(error) && typeof error.code === "string") {
    return error.code;
  }

  return null;
}

function isAuthRequiredError(error: unknown): boolean {
  return error instanceof McpTransportError && error.code === "auth_required";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
