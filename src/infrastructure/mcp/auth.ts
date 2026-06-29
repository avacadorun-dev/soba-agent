import type { McpRemoteAuthConfig } from "./types";

export class McpAuthConfigError extends Error {
  readonly code = "auth_config_error";

  constructor(message: string) {
    super(message);
    this.name = "McpAuthConfigError";
  }
}

export function buildMcpAuthHeaders(
  auth: McpRemoteAuthConfig,
  env: Record<string, string | undefined> = process.env,
): Headers {
  const headers = new Headers();

  if (auth.type === "none" || auth.type === "oauth") {
    return headers;
  }

  if (auth.type === "bearerEnv") {
    const token = readRequiredSecret(auth.env, env);
    headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  assertValidHeaderName(auth.header);
  headers.set(auth.header, readRequiredSecret(auth.env, env));
  return headers;
}

export function assertValidHeaderName(value: string): void {
  if (!isValidHeaderName(value)) {
    throw new McpAuthConfigError("MCP auth header name is invalid.");
  }
}

export function isStaticMcpAuth(auth: McpRemoteAuthConfig): boolean {
  return auth.type === "bearerEnv" || auth.type === "apiKeyEnv";
}

function readRequiredSecret(name: string, env: Record<string, string | undefined>): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new McpAuthConfigError(`Required environment variable ${name} for MCP auth is not set.`);
  }

  return value;
}

function isValidHeaderName(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isAlpha = (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
    const isDigit = code >= 0x30 && code <= 0x39;
    const isTokenSymbol = "!#$%&'*+-.^_`|~".includes(value[index] ?? "");
    if (!isAlpha && !isDigit && !isTokenSymbol) {
      return false;
    }
  }

  return true;
}
