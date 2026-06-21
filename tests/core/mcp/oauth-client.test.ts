import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpOAuthClient, redactMcpOAuthDiagnostics } from "../../../src/core/mcp/oauth-client";
import type { McpOAuthFetch } from "../../../src/core/mcp/oauth-discovery";
import { McpOAuthTokenStore, recordFromTokenSet } from "../../../src/core/mcp/oauth-token-store";

describe("MCP OAuth client", () => {
  let tempDir: string;
  let projectRoot: string;
  let store: McpOAuthTokenStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "soba-oauth-client-"));
    projectRoot = join(tempDir, "project");
    store = new McpOAuthTokenStore({ path: join(tempDir, "tokens.json") });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("expired access token refreshes before request", async () => {
    const calls: string[] = [];
    await store.save(
      recordFromTokenSet({
        projectRoot,
        serverId: "docs",
        issuer: "https://auth.example.com/",
        accessToken: "expired-access-token",
        tokenType: "Bearer",
        refreshToken: "secret-refresh-token",
        expiresIn: -10,
        now: 10_000,
      }),
    );

    const client = createClient({
      fetchImpl: async (_input, init) => {
        calls.push(String(init?.body));
        return Response.json({
          access_token: "fresh-access-token",
          token_type: "Bearer",
          refresh_token: "fresh-refresh-token",
          expires_in: 3600,
        });
      },
    });

    const result = await client.authorization(20_000);

    expect(result).toMatchObject({
      type: "authorized",
      authorizationHeader: "Bearer fresh-access-token",
    });
    expect(calls[0]).toContain("grant_type=refresh_token");
    expect(calls[0]).toContain("refresh_token=secret-refresh-token");
    await expect(store.load(projectRoot, "docs", "https://auth.example.com/")).resolves.toMatchObject({
      accessToken: "fresh-access-token",
      refreshToken: "fresh-refresh-token",
    });
  });

  test("refresh failure returns auth-required state", async () => {
    await store.save(
      recordFromTokenSet({
        projectRoot,
        serverId: "docs",
        issuer: "https://auth.example.com/",
        accessToken: "expired-access-token",
        refreshToken: "secret-refresh-token",
        expiresIn: -10,
        now: 10_000,
      }),
    );

    const client = createClient({
      fetchImpl: async () => new Response("invalid_grant", { status: 400 }),
    });

    const result = await client.authorization(20_000);

    expect(result).toEqual({
      type: "auth_required",
      reason: "refresh_failed",
    });
    await expect(store.load(projectRoot, "docs", "https://auth.example.com/")).resolves.toBeNull();
  });

  test("logout removes local token", async () => {
    await store.save(
      recordFromTokenSet({
        projectRoot,
        serverId: "docs",
        issuer: "https://auth.example.com/",
        accessToken: "secret-access-token",
      }),
    );

    const result = await createClient().logout();

    expect(result).toEqual({
      revoked: false,
      deleted: true,
    });
    await expect(store.load(projectRoot, "docs", "https://auth.example.com/")).resolves.toBeNull();
  });

  test("revoke endpoint is called when available", async () => {
    const calls: string[] = [];
    await store.save(
      recordFromTokenSet({
        projectRoot,
        serverId: "docs",
        issuer: "https://auth.example.com/",
        accessToken: "secret-access-token",
        refreshToken: "secret-refresh-token",
      }),
    );

    const client = createClient({
      revocationEndpoint: "https://auth.example.com/revoke",
      fetchImpl: async (input, init) => {
        calls.push(`${String(input)} ${String(init?.body)}`);
        return new Response(null, { status: 200 });
      },
    });

    const result = await client.logout();

    expect(result.revoked).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("https://auth.example.com/revoke");
    expect(calls[0]).toContain("token=secret-refresh-token");
  });

  test("revoke absence does not fail logout", async () => {
    await store.save(
      recordFromTokenSet({
        projectRoot,
        serverId: "docs",
        issuer: "https://auth.example.com/",
        accessToken: "secret-access-token",
        refreshToken: "secret-refresh-token",
      }),
    );

    const result = await createClient({
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      },
    }).logout();

    expect(result).toEqual({
      revoked: false,
      deleted: true,
    });
  });

  test("token values never appear in diagnostics or serialized session items", async () => {
    const accessToken = "secret-access-token-value";
    const refreshToken = "secret-refresh-token-value";
    await store.save(
      recordFromTokenSet({
        projectRoot,
        serverId: "docs",
        issuer: "https://auth.example.com/",
        accessToken,
        refreshToken,
        expiresIn: 3600,
        now: 10_000,
      }),
    );

    const result = await createClient().authorization(20_000);
    const diagnostics = createClient().diagnostics(result);
    const serialized = JSON.stringify(redactMcpOAuthDiagnostics({ diagnostics, accessToken, refreshToken }));

    expect(serialized).not.toContain(accessToken);
    expect(serialized).not.toContain(refreshToken);
    expect(serialized).toContain("[REDACTED]");
  });

  function createClient(options: { fetchImpl?: McpOAuthFetch; revocationEndpoint?: string } = {}): McpOAuthClient {
    return new McpOAuthClient({
      projectRoot,
      serverId: "docs",
      plan: {
        issuer: "https://auth.example.com/",
        tokenEndpoint: "https://auth.example.com/token",
        revocationEndpoint: options.revocationEndpoint,
      },
      clientId: "soba-cli",
      store,
      fetchImpl: options.fetchImpl,
      refreshSkewMs: 0,
    });
  }
});
