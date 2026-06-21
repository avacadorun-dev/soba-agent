export const MCP_CONFIG_VERSION = 1;
export const MCP_TRUST_MODES = ["safe", "normal", "dangerous"] as const;

export type McpTrustMode = (typeof MCP_TRUST_MODES)[number];

export type McpServerTransport = "stdio" | "streamableHttp";

export type McpRemoteAuthConfig =
  | { type: "none" }
  | { type: "bearerEnv"; env: string }
  | { type: "apiKeyEnv"; header: string; env: string }
  | { type: "oauth" };

export interface McpServerConfigBase {
  id: string;
  name: string;
  timeoutMs: number;
  maxOutputBytes: number;
  trustMode: McpTrustMode;
  enabled: boolean;
}

export interface McpStdioServerConfig extends McpServerConfigBase {
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export interface McpStreamableHttpServerConfig extends McpServerConfigBase {
  transport: "streamableHttp";
  url: string;
  headers: Record<string, string>;
  auth: McpRemoteAuthConfig;
}

export type McpServerConfig = McpStdioServerConfig | McpStreamableHttpServerConfig;

export interface McpConfig {
  version: typeof MCP_CONFIG_VERSION;
  servers: McpServerConfig[];
}

export interface RawMcpServerConfig {
  id?: unknown;
  name?: unknown;
  transport?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  cwd?: unknown;
  url?: unknown;
  headers?: unknown;
  auth?: unknown;
  timeoutMs?: unknown;
  maxOutputBytes?: unknown;
  trustMode?: unknown;
  enabled?: unknown;
}

export interface RawMcpConfig {
  version?: unknown;
  servers?: unknown;
  mcpServers?: unknown;
}

export interface McpConfigIssue {
  code:
    | "invalid_config"
    | "invalid_version"
    | "missing_servers"
    | "missing_server_id"
    | "duplicate_server_id"
    | "invalid_transport"
    | "missing_command"
    | "invalid_stdio_field"
    | "missing_url"
    | "invalid_url"
    | "invalid_headers"
    | "invalid_auth"
    | "invalid_args"
    | "invalid_env"
    | "missing_env"
    | "invalid_cwd"
    | "invalid_limit"
    | "invalid_trust_mode"
    | "invalid_enabled";
  path: string;
  message: string;
}

export interface McpConfigValidationResult {
  ok: boolean;
  config?: McpConfig;
  issues: McpConfigIssue[];
}

export interface McpConfigValidationOptions {
  projectRoot: string;
  env?: Record<string, string | undefined>;
}

export interface McpConfigLoadOptions extends McpConfigValidationOptions {
  configPath?: string;
}

export function isMcpTrustMode(value: unknown): value is McpTrustMode {
  return typeof value === "string" && MCP_TRUST_MODES.includes(value as McpTrustMode);
}
