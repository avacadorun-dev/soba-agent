import type { McpOAuthDiscoveryPlan, McpOAuthFetch } from "./oauth-discovery";
import type { McpOAuthTokenSet } from "./oauth-flow";
import { type McpOAuthTokenRecord, McpOAuthTokenStore, recordFromTokenSet } from "./oauth-token-store";

export type McpOAuthAuthResult =
  | { type: "authorized"; authorizationHeader: string; record: McpOAuthTokenRecord }
  | { type: "auth_required"; reason: "missing_token" | "expired_without_refresh" | "refresh_failed" };

export interface McpOAuthClientOptions {
  projectRoot: string;
  serverId: string;
  plan: Pick<McpOAuthDiscoveryPlan, "issuer" | "tokenEndpoint" | "revocationEndpoint">;
  clientId: string;
  store?: McpOAuthTokenStore;
  fetchImpl?: McpOAuthFetch;
  refreshSkewMs?: number;
}

export interface McpOAuthLogoutResult {
  revoked: boolean;
  deleted: boolean;
}

export class McpOAuthClient {
  private readonly projectRoot: string;
  private readonly serverId: string;
  private readonly plan: Pick<McpOAuthDiscoveryPlan, "issuer" | "tokenEndpoint" | "revocationEndpoint">;
  private readonly clientId: string;
  private readonly store: McpOAuthTokenStore;
  private readonly fetchImpl: McpOAuthFetch;
  private readonly refreshSkewMs: number;

  constructor(options: McpOAuthClientOptions) {
    this.projectRoot = options.projectRoot;
    this.serverId = options.serverId;
    this.plan = options.plan;
    this.clientId = options.clientId;
    this.store = options.store ?? new McpOAuthTokenStore();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.refreshSkewMs = options.refreshSkewMs ?? 30_000;
  }

  async saveTokens(tokens: McpOAuthTokenSet, now = Date.now()): Promise<void> {
    await this.store.save(
      recordFromTokenSet({
        projectRoot: this.projectRoot,
        serverId: this.serverId,
        issuer: this.plan.issuer,
        accessToken: tokens.accessToken,
        tokenType: tokens.tokenType,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        scope: tokens.scope,
        now,
      }),
    );
  }

  async authorization(now = Date.now()): Promise<McpOAuthAuthResult> {
    const record = await this.store.load(this.projectRoot, this.serverId, this.plan.issuer);
    if (!record) {
      return { type: "auth_required", reason: "missing_token" };
    }

    if (!isExpired(record, now, this.refreshSkewMs)) {
      return {
        type: "authorized",
        authorizationHeader: `${record.tokenType} ${record.accessToken}`,
        record,
      };
    }

    if (!record.refreshToken) {
      await this.store.delete(this.projectRoot, this.serverId, this.plan.issuer);
      return { type: "auth_required", reason: "expired_without_refresh" };
    }

    const refreshed = await this.refresh(record, now);
    if (!refreshed) {
      await this.store.delete(this.projectRoot, this.serverId, this.plan.issuer);
      return { type: "auth_required", reason: "refresh_failed" };
    }

    return {
      type: "authorized",
      authorizationHeader: `${refreshed.tokenType} ${refreshed.accessToken}`,
      record: refreshed,
    };
  }

  async logout(): Promise<McpOAuthLogoutResult> {
    const record = await this.store.load(this.projectRoot, this.serverId, this.plan.issuer);
    let revoked = false;

    if (record && this.plan.revocationEndpoint) {
      revoked = await this.revoke(record);
    }

    await this.store.delete(this.projectRoot, this.serverId, this.plan.issuer);
    return {
      revoked,
      deleted: true,
    };
  }

  diagnostics(result: McpOAuthAuthResult): Record<string, string> {
    if (result.type === "authorized") {
      return {
        state: "authorized",
        issuer: result.record.issuer,
        accessToken: "[REDACTED]",
        refreshToken: result.record.refreshToken ? "[REDACTED]" : "",
      };
    }

    return {
      state: "auth_required",
      reason: result.reason,
    };
  }

  private async refresh(record: McpOAuthTokenRecord, now: number): Promise<McpOAuthTokenRecord | null> {
    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("client_id", this.clientId);
    body.set("refresh_token", record.refreshToken ?? "");

    try {
      const response = await this.fetchImpl(this.plan.tokenEndpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      if (!response.ok) {
        return null;
      }

      const tokenSet = parseTokenResponse(await response.json(), record);
      const refreshed = recordFromTokenSet({
        projectRoot: this.projectRoot,
        serverId: this.serverId,
        issuer: this.plan.issuer,
        accessToken: tokenSet.accessToken,
        tokenType: tokenSet.tokenType,
        refreshToken: tokenSet.refreshToken,
        expiresIn: tokenSet.expiresIn,
        scope: tokenSet.scope,
        now,
      });
      await this.store.save(refreshed);
      return refreshed;
    } catch {
      return null;
    }
  }

  private async revoke(record: McpOAuthTokenRecord): Promise<boolean> {
    if (!this.plan.revocationEndpoint) {
      return false;
    }

    const body = new URLSearchParams();
    body.set("token", record.refreshToken ?? record.accessToken);
    body.set("client_id", this.clientId);

    try {
      const response = await this.fetchImpl(this.plan.revocationEndpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export function redactMcpOAuthDiagnostics(value: unknown): unknown {
  if (typeof value === "string") {
    return looksLikeToken(value) ? "[REDACTED]" : value;
  }

  if (Array.isArray(value)) {
    return value.map(redactMcpOAuthDiagnostics);
  }

  if (!isRecord(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = isTokenKey(key) ? "[REDACTED]" : redactMcpOAuthDiagnostics(entry);
  }

  return redacted;
}

function isExpired(record: McpOAuthTokenRecord, now: number, refreshSkewMs: number): boolean {
  return record.expiresAt !== null && record.expiresAt <= now + refreshSkewMs;
}

function parseTokenResponse(value: unknown, previous: McpOAuthTokenRecord): McpOAuthTokenSet {
  if (!isRecord(value) || typeof value.access_token !== "string") {
    throw new Error("MCP OAuth refresh response is invalid.");
  }

  return {
    accessToken: value.access_token,
    tokenType: typeof value.token_type === "string" ? value.token_type : previous.tokenType,
    refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : previous.refreshToken,
    expiresIn: typeof value.expires_in === "number" ? value.expires_in : undefined,
    scope: typeof value.scope === "string" ? value.scope : previous.scope,
  };
}

function isTokenKey(key: string): boolean {
  return /token|authorization|code/i.test(key);
}

function looksLikeToken(value: string): boolean {
  return value.length >= 20 && /^[A-Za-z0-9._~+/=-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
