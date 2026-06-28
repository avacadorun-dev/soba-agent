import type { TrustController, TrustLevel } from "../../engine/permissions/trust-controller";
import { assertValidHeaderName, McpAuthConfigError } from "./auth";
import { MCP_SESSION_ID_HEADER } from "./http-session";
import type { McpTrustMode } from "./types";

export const MCP_TOOL_TRUST_RULE_PREFIX = "mcp_";
export const MCP_REDACTED_QUERY_VALUE = "[REDACTED:MCP_QUERY]";

const CONTROLLED_REMOTE_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "last-event-id",
  MCP_SESSION_ID_HEADER.toLowerCase(),
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const TOKEN_LIKE_QUERY_PARAM = /(?:access|api|auth|bearer|code|credential|key|password|secret|session|token)/i;
const TOKEN_LIKE_QUERY_VALUE = /(?:\b(?:sk|ghp|github_pat|xox[baprs])-[\w-]{8,}\b|[A-Za-z0-9_+/=-]{32,})/;

export interface McpServerSecurity {
  serverId: string;
  trustMode: McpTrustMode;
  timeoutMs: number;
  maxOutputBytes: number;
  env?: Record<string, string>;
}

export interface McpToolTrustRule {
  proxyName: string;
  serverId: string;
  trustMode: McpTrustMode;
}

export class McpRemoteSecurityError extends Error {
  readonly code: "invalid_remote_header";

  constructor(message: string) {
    super(message);
    this.name = "McpRemoteSecurityError";
    this.code = "invalid_remote_header";
  }
}

export function createDefaultMcpServerSecurity(serverId: string): McpServerSecurity {
  return {
    serverId,
    trustMode: "normal",
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
  };
}

export function trustLevelForMcpServer(security: Pick<McpServerSecurity, "trustMode">): TrustLevel {
  return security.trustMode;
}

export function applyMcpToolTrustRules(trustManager: TrustController, rules: McpToolTrustRule[]): void {
  trustManager.removeToolRulesByPrefix(MCP_TOOL_TRUST_RULE_PREFIX);
  for (const rule of rules) {
    trustManager.addToolRule(rule.proxyName, trustLevelForMcpServer(rule));
  }
}

export function sanitizeMcpRemoteHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    assertSafeMcpRemoteHeader(name, value);
    sanitized[name] = value;
  }

  return sanitized;
}

export function assertSafeMcpRemoteHeader(name: string, value: string): void {
  try {
    assertValidHeaderName(name);
  } catch (error) {
    if (error instanceof McpAuthConfigError) {
      throw new McpRemoteSecurityError("MCP remote header name must be a valid HTTP header token.");
    }

    throw error;
  }

  if (CONTROLLED_REMOTE_HEADERS.has(name.toLowerCase())) {
    throw new McpRemoteSecurityError(`MCP remote header ${name} is controlled by the transport and cannot be configured.`);
  }

  if (containsHeaderControlCharacters(value)) {
    throw new McpRemoteSecurityError("MCP remote header value must not contain CRLF or NUL characters.");
  }
}

export function redactMcpDiagnosticUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const [name, queryValue] of url.searchParams.entries()) {
      if (TOKEN_LIKE_QUERY_PARAM.test(name) || TOKEN_LIKE_QUERY_VALUE.test(queryValue)) {
        url.searchParams.set(name, MCP_REDACTED_QUERY_VALUE);
      }
    }

    return url.toString();
  } catch {
    return "<invalid-url>";
  }
}

export function redactMcpSensitiveText(text: string, security?: Pick<McpServerSecurity, "env">): string {
  let redacted = text;
  for (const value of Object.values(security?.env ?? {})) {
    if (value.length === 0) {
      continue;
    }
    redacted = redacted.split(value).join("[REDACTED:MCP_ENV]");
  }

  return redacted
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])-[\w-]{8,}\b/g, "[REDACTED:MCP_TOKEN]")
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, "[REDACTED:MCP_SECRET]");
}

function containsHeaderControlCharacters(value: string): boolean {
  return /[\r\n\0]/.test(value);
}
