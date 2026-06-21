import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertValidHeaderName, McpAuthConfigError } from "./auth";
import { assertSafeMcpRemoteHeader, McpRemoteSecurityError } from "./security";
import {
  isMcpTrustMode,
  MCP_CONFIG_VERSION,
  type McpConfig,
  type McpConfigIssue,
  type McpConfigLoadOptions,
  type McpConfigValidationOptions,
  type McpConfigValidationResult,
  type McpRemoteAuthConfig,
  type McpServerConfig,
  type McpServerConfigBase,
  type RawMcpServerConfig,
} from "./types";

export const DEFAULT_MCP_TIMEOUT_MS = 30_000;
export const DEFAULT_MCP_MAX_OUTPUT_BYTES = 1024 * 1024;
export const MCP_CONFIG_RELATIVE_PATH = ".soba/mcp.json";

const SERVER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const ENV_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const ENV_PLACEHOLDER_PATTERN = /\$\{ENV:([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export class McpConfigError extends Error {
  readonly issues: McpConfigIssue[];

  constructor(issues: McpConfigIssue[]) {
    super(formatMcpConfigIssues(issues));
    this.name = "McpConfigError";
    this.issues = issues;
  }
}

export function getMcpConfigPath(projectRoot: string): string {
  return join(resolve(projectRoot), MCP_CONFIG_RELATIVE_PATH);
}

export function validateMcpConfig(raw: unknown, options: McpConfigValidationOptions): McpConfigValidationResult {
  const issues: McpConfigIssue[] = [];
  const projectRoot = resolve(options.projectRoot);
  const env = options.env ?? process.env;

  if (!isRecord(raw)) {
    return {
      ok: false,
      issues: [issue("invalid_config", "$", "MCP config must be a JSON object.")],
    };
  }

  const version = raw.version ?? MCP_CONFIG_VERSION;
  if (version !== MCP_CONFIG_VERSION) {
    issues.push(issue("invalid_version", "version", `MCP config version must be ${MCP_CONFIG_VERSION}.`));
  }

  const rawServers = normalizeRawServers(readRawServers(raw, issues), issues);
  const servers: McpServerConfig[] = [];
  const ids = new Set<string>();

  for (const rawServer of rawServers) {
    const parsed = parseServer(rawServer.value, {
      path: rawServer.path,
      fallbackId: rawServer.fallbackId,
      projectRoot,
      env,
      issues,
    });

    if (!parsed) {
      continue;
    }

    if (ids.has(parsed.id)) {
      issues.push(issue("duplicate_server_id", `${rawServer.path}.id`, `MCP server id "${parsed.id}" is duplicated.`));
      continue;
    }

    ids.add(parsed.id);
    servers.push(parsed);
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    };
  }

  return {
    ok: true,
    config: {
      version: MCP_CONFIG_VERSION,
      servers,
    },
    issues: [],
  };
}

export function parseMcpConfig(raw: unknown, options: McpConfigValidationOptions): McpConfig {
  const result = validateMcpConfig(raw, options);
  if (!result.ok || !result.config) {
    throw new McpConfigError(result.issues);
  }

  return result.config;
}

export async function loadMcpConfig(options: McpConfigLoadOptions): Promise<McpConfig | null> {
  const configPath = options.configPath ?? getMcpConfigPath(options.projectRoot);
  if (!existsSync(configPath)) {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await Bun.file(configPath).text());
  } catch {
    throw new McpConfigError([issue("invalid_config", "$", "MCP config file must contain valid JSON.")]);
  }

  return parseMcpConfig(raw, options);
}

export function formatMcpConfigIssues(issues: McpConfigIssue[]): string {
  if (issues.length === 0) {
    return "MCP config validation failed.";
  }

  return issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n");
}

interface RawServerEntry {
  value: unknown;
  path: string;
  fallbackId?: string;
}

interface RawServerSource {
  value: unknown;
  path: string;
}

interface ParseServerContext {
  path: string;
  fallbackId?: string;
  projectRoot: string;
  env: Record<string, string | undefined>;
  issues: McpConfigIssue[];
}

function readRawServers(raw: Record<string, unknown>, issues: McpConfigIssue[]): RawServerSource {
  const hasServers = Object.hasOwn(raw, "servers");
  const hasMcpServers = Object.hasOwn(raw, "mcpServers");

  if (hasServers && hasMcpServers) {
    issues.push(
      issue(
        "invalid_config",
        "mcpServers",
        "MCP config must use either servers or mcpServers, not both.",
      ),
    );
    return { value: [], path: "servers" };
  }

  if (hasMcpServers) {
    return { value: raw.mcpServers, path: "mcpServers" };
  }

  return { value: raw.servers, path: "servers" };
}

function normalizeRawServers(source: RawServerSource, issues: McpConfigIssue[]): RawServerEntry[] {
  if (Array.isArray(source.value)) {
    return source.value.map((server, index) => ({
      value: server,
      path: `${source.path}[${index}]`,
    }));
  }

  if (isRecord(source.value)) {
    return Object.entries(source.value).map(([id, server]) => ({
      value: server,
      path: `${source.path}.${id}`,
      fallbackId: id,
    }));
  }

  issues.push(issue("missing_servers", source.path, "MCP config must define one or more servers."));
  return [];
}

function parseServer(value: unknown, context: ParseServerContext): McpServerConfig | null {
  const { path, fallbackId, projectRoot, env, issues } = context;

  if (!isRecord(value)) {
    issues.push(issue("invalid_config", path, "MCP server config must be an object."));
    return null;
  }

  const raw = value as RawMcpServerConfig;
  const id = parseServerId(raw.id, fallbackId, path, issues);

  if (!id) {
    return null;
  }

  const name = parseOptionalString(raw.name, `${path}.name`, issues) ?? id;
  const transport = parseTransport(raw, `${path}.transport`, issues);
  const timeoutMs = parsePositiveInteger(
    raw.timeoutMs,
    `${path}.timeoutMs`,
    DEFAULT_MCP_TIMEOUT_MS,
    "MCP server timeoutMs must be a positive integer.",
    issues,
  );
  const maxOutputBytes = parsePositiveInteger(
    raw.maxOutputBytes,
    `${path}.maxOutputBytes`,
    DEFAULT_MCP_MAX_OUTPUT_BYTES,
    "MCP server maxOutputBytes must be a positive integer.",
    issues,
  );
  const trustMode = parseTrustMode(raw.trustMode, `${path}.trustMode`, issues);
  const enabled = parseEnabled(raw.enabled, `${path}.enabled`, issues);

  if (!transport || !timeoutMs || !maxOutputBytes || !trustMode || enabled === undefined) {
    return null;
  }

  const base: McpServerConfigBase = {
    id,
    name,
    timeoutMs,
    maxOutputBytes,
    trustMode,
    enabled,
  };

  if (transport === "stdio") {
    return parseStdioServer(raw, path, projectRoot, env, base, issues);
  }

  return parseStreamableHttpServer(raw, path, env, base, issues);
}

function parseServerId(value: unknown, fallbackId: string | undefined, path: string, issues: McpConfigIssue[]): string | null {
  const candidate = value ?? fallbackId;
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    issues.push(issue("missing_server_id", `${path}.id`, "MCP server id is required."));
    return null;
  }

  const id = candidate.trim();
  if (!SERVER_ID_PATTERN.test(id)) {
    issues.push(issue("missing_server_id", `${path}.id`, "MCP server id must use letters, numbers, dot, underscore or dash."));
    return null;
  }

  return id;
}

function parseStdioServer(
  raw: RawMcpServerConfig,
  path: string,
  projectRoot: string,
  env: Record<string, string | undefined>,
  base: McpServerConfigBase,
  issues: McpConfigIssue[],
): McpServerConfig | null {
  const command = parseRequiredString(raw.command, `${path}.command`, "missing_command", "MCP server command is required.", issues);
  const args = parseArgs(raw.args, `${path}.args`, issues);
  const serverEnv = parseStringMap(raw.env, `${path}.env`, env, "env", issues);
  const cwd = parseCwd(raw.cwd, `${path}.cwd`, projectRoot, issues);

  if (!command || !args || !serverEnv || !cwd) {
    return null;
  }

  return {
    ...base,
    transport: "stdio",
    command,
    args,
    env: serverEnv,
    cwd,
  };
}

function parseStreamableHttpServer(
  raw: RawMcpServerConfig,
  path: string,
  env: Record<string, string | undefined>,
  base: McpServerConfigBase,
  issues: McpConfigIssue[],
): McpServerConfig | null {
  rejectRemoteOnlyStdioField(raw.command, `${path}.command`, "command", issues);
  rejectRemoteOnlyStdioField(raw.args, `${path}.args`, "args", issues);
  rejectRemoteOnlyStdioField(raw.cwd, `${path}.cwd`, "cwd", issues);
  rejectRemoteOnlyStdioField(raw.env, `${path}.env`, "env", issues);

  const url = parseRemoteUrl(raw.url, `${path}.url`, env, issues);
  const headers = parseStringMap(raw.headers, `${path}.headers`, env, "headers", issues);
  const auth = parseRemoteAuth(raw.auth, `${path}.auth`, issues);

  if (!url || !headers || !auth) {
    return null;
  }

  return {
    ...base,
    transport: "streamableHttp",
    url,
    headers,
    auth,
  };
}

function parseRequiredString(
  value: unknown,
  path: string,
  code: McpConfigIssue["code"],
  message: string,
  issues: McpConfigIssue[],
): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(issue(code, path, message));
    return null;
  }

  return value;
}

function parseOptionalString(value: unknown, path: string, issues: McpConfigIssue[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(issue("invalid_config", path, "MCP server name must be a non-empty string when provided."));
    return undefined;
  }

  return value;
}

function parseTransport(raw: RawMcpServerConfig, path: string, issues: McpConfigIssue[]): McpServerConfig["transport"] | null {
  if (raw.transport === undefined) {
    return "stdio";
  }

  if (raw.transport === "stdio" || raw.transport === "streamableHttp") {
    return raw.transport;
  }

  issues.push(issue("invalid_transport", path, "MCP server transport must be stdio or streamableHttp."));
  return null;
}

function parseArgs(value: unknown, path: string, issues: McpConfigIssue[]): string[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    issues.push(issue("invalid_args", path, "MCP server args must be an array of strings."));
    return null;
  }

  return [...value];
}

function parseStringMap(
  value: unknown,
  path: string,
  env: Record<string, string | undefined>,
  fieldName: "env" | "headers",
  issues: McpConfigIssue[],
): Record<string, string> | null {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    const code = fieldName === "env" ? "invalid_env" : "invalid_headers";
    issues.push(issue(code, path, `MCP server ${fieldName} must be an object of string values.`));
    return null;
  }

  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (fieldName === "env" && !ENV_NAME_PATTERN.test(key)) {
      issues.push(issue("invalid_env", `${path}.${key}`, "MCP env key must be a valid environment variable name."));
      continue;
    }
    if (fieldName === "headers" && key.trim().length === 0) {
      issues.push(issue("invalid_headers", `${path}.${key}`, "MCP header key must be a non-empty string."));
      continue;
    }
    if (fieldName === "headers" && !isValidHeaderNameForConfig(key)) {
      issues.push(issue("invalid_headers", `${path}.${key}`, "MCP header key must be a valid HTTP header name."));
      continue;
    }
    if (typeof rawValue !== "string") {
      const code = fieldName === "env" ? "invalid_env" : "invalid_headers";
      issues.push(issue(code, `${path}.${key}`, `MCP ${fieldName} value must be a string or \${ENV:NAME} placeholder.`));
      continue;
    }

    const expanded = expandEnvValue(rawValue, `${path}.${key}`, env, issues);
    if (expanded !== null) {
      if (fieldName === "headers" && !isSafeHeaderForConfig(key, expanded)) {
        issues.push(issue("invalid_headers", `${path}.${key}`, "MCP header must not contain CRLF or override transport-controlled headers."));
        continue;
      }
      result[key] = expanded;
    }
  }

  return result;
}

function expandEnvValue(
  value: string,
  path: string,
  env: Record<string, string | undefined>,
  issues: McpConfigIssue[],
): string | null {
  let failed = false;
  const expanded = value.replace(ENV_PLACEHOLDER_PATTERN, (_match, name: string) => {
    const envValue = env[name];
    if (envValue === undefined) {
      failed = true;
      issues.push(issue("missing_env", path, `Required environment variable ${name} is not set.`));
      return "";
    }

    return envValue;
  });

  return failed ? null : expanded;
}

function parseRemoteUrl(value: unknown, path: string, env: Record<string, string | undefined>, issues: McpConfigIssue[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(issue("missing_url", path, "Streamable HTTP MCP server url is required."));
    return null;
  }

  const expanded = expandEnvValue(value, path, env, issues);
  if (expanded === null) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(expanded);
  } catch {
    issues.push(issue("invalid_url", path, "Streamable HTTP MCP server url must be an absolute URL."));
    return null;
  }

  if (url.username || url.password) {
    issues.push(issue("invalid_url", path, "Streamable HTTP MCP server url must not include credentials."));
    return null;
  }

  if (url.protocol === "https:") {
    return url.toString();
  }

  if (url.protocol === "http:" && isLocalHttpHost(url.hostname)) {
    return url.toString();
  }

  issues.push(issue("invalid_url", path, "Streamable HTTP MCP server url must use https, except localhost development URLs."));
  return null;
}

function parseRemoteAuth(value: unknown, path: string, issues: McpConfigIssue[]): McpRemoteAuthConfig | null {
  if (value === undefined) {
    return { type: "none" };
  }
  if (!isRecord(value)) {
    issues.push(issue("invalid_auth", path, "MCP remote auth must be an object."));
    return null;
  }

  const type = value.type;
  if (type === "none") {
    return { type: "none" };
  }
  if (type === "oauth") {
    return { type: "oauth" };
  }
  if (type === "bearerEnv") {
    const envName = parseEnvName(value.env, `${path}.env`, issues);
    return envName ? { type: "bearerEnv", env: envName } : null;
  }
  if (type === "apiKeyEnv") {
    const header = parseRequiredString(value.header, `${path}.header`, "invalid_auth", "MCP apiKeyEnv auth header is required.", issues);
    const envName = parseEnvName(value.env, `${path}.env`, issues);
    if (header && !isValidHeaderNameForConfig(header)) {
      issues.push(issue("invalid_auth", `${path}.header`, "MCP apiKeyEnv auth header must be a valid HTTP header name."));
      return null;
    }
    return header && envName ? { type: "apiKeyEnv", header, env: envName } : null;
  }

  issues.push(issue("invalid_auth", `${path}.type`, "MCP remote auth type must be none, bearerEnv, apiKeyEnv or oauth."));
  return null;
}

function parseEnvName(value: unknown, path: string, issues: McpConfigIssue[]): string | null {
  if (typeof value !== "string" || !ENV_NAME_PATTERN.test(value)) {
    issues.push(issue("invalid_auth", path, "MCP auth env must be a valid environment variable name."));
    return null;
  }

  return value;
}

function rejectRemoteOnlyStdioField(value: unknown, path: string, fieldName: string, issues: McpConfigIssue[]): void {
  if (value !== undefined) {
    issues.push(issue("invalid_stdio_field", path, `Streamable HTTP MCP server must not define stdio field ${fieldName}.`));
  }
}

function parseCwd(value: unknown, path: string, projectRoot: string, issues: McpConfigIssue[]): string | null {
  if (value === undefined) {
    return projectRoot;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(issue("invalid_cwd", path, "MCP server cwd must be a non-empty string."));
    return null;
  }

  const resolved = resolve(projectRoot, value);
  if (!isPathInside(projectRoot, resolved)) {
    issues.push(issue("invalid_cwd", path, "MCP server cwd must stay inside the project root."));
    return null;
  }

  return resolved;
}

function parsePositiveInteger(
  value: unknown,
  path: string,
  defaultValue: number,
  message: string,
  issues: McpConfigIssue[],
): number | null {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    issues.push(issue("invalid_limit", path, message));
    return null;
  }

  return value;
}

function parseTrustMode(value: unknown, path: string, issues: McpConfigIssue[]) {
  if (value === undefined) {
    return "normal";
  }
  if (!isMcpTrustMode(value)) {
    issues.push(issue("invalid_trust_mode", path, "MCP server trustMode must be safe, normal or dangerous."));
    return null;
  }

  return value;
}

function parseEnabled(value: unknown, path: string, issues: McpConfigIssue[]): boolean | undefined {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "boolean") {
    issues.push(issue("invalid_enabled", path, "MCP server enabled must be a boolean."));
    return undefined;
  }

  return value;
}

function issue(code: McpConfigIssue["code"], path: string, message: string): McpConfigIssue {
  return {
    code,
    path,
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathInside(basePath: string, candidatePath: string): boolean {
  const base = resolve(basePath);
  const candidate = resolve(candidatePath);
  return candidate === base || candidate.startsWith(`${base}/`);
}

function isLocalHttpHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isValidHeaderNameForConfig(value: string): boolean {
  try {
    assertValidHeaderName(value);
    return true;
  } catch (error) {
    if (error instanceof McpAuthConfigError) {
      return false;
    }

    throw error;
  }
}

function isSafeHeaderForConfig(name: string, value: string): boolean {
  try {
    assertSafeMcpRemoteHeader(name, value);
    return true;
  } catch (error) {
    if (error instanceof McpRemoteSecurityError) {
      return false;
    }

    throw error;
  }
}
