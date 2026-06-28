import { describe, expect, test } from "bun:test";
import type { McpOAuthCallbackResult, McpOAuthCallbackServer } from "../../../src/infrastructure/mcp/oauth-callback-server";
import type { McpOAuthDiscoveryPlan, McpOAuthFetch } from "../../../src/infrastructure/mcp/oauth-discovery";
import {
  buildMcpOAuthAuthorizationRequest,
  redactMcpOAuthValue,
  runMcpOAuthLoginFlow,
  summarizeMcpOAuthCallback,
} from "../../../src/infrastructure/mcp/oauth-flow";
import type { McpPkcePair } from "../../../src/infrastructure/mcp/oauth-pkce";

describe("MCP OAuth flow", () => {
  test("builds authorization URL with state, code challenge, redirect URI, and scopes", () => {
    const request = buildMcpOAuthAuthorizationRequest({
      plan: discoveryPlan(),
      clientId: "soba-cli",
      redirectUri: "http://127.0.0.1:12345/oauth/callback",
      state: "fixed-state",
      pkce: pkcePair(),
    });
    const url = new URL(request.authorizationUrl);

    expect(url.origin + url.pathname).toBe("https://auth.example.com/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("soba-cli");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:12345/oauth/callback");
    expect(url.searchParams.get("state")).toBe("fixed-state");
    expect(url.searchParams.get("code_challenge")).toBe("fixed-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("mcp.read mcp.write");
  });

  test("callback with valid state exchanges code", async () => {
    const tokenRequests: string[] = [];
    const result = await runMcpOAuthLoginFlow({
      plan: discoveryPlan(),
      clientId: "soba-cli",
      state: "fixed-state",
      pkce: pkcePair(),
      callbackServerFactory: fakeCallbackServerFactory({ type: "success", code: "secret-code", state: "fixed-state" }),
      fetchImpl: async (_input, init) => {
        tokenRequests.push(String(init?.body));
        return Response.json({
          access_token: "secret-access-token",
          token_type: "Bearer",
          refresh_token: "secret-refresh-token",
          expires_in: 3600,
          scope: "mcp.read",
        });
      },
    });

    expect(result).toMatchObject({
      type: "success",
      browserOpened: false,
    });
    expect(result.type === "success" ? result.tokens : null).toEqual({
      accessToken: "secret-access-token",
      tokenType: "Bearer",
      refreshToken: "secret-refresh-token",
      expiresIn: 3600,
      scope: "mcp.read",
    });
    expect(tokenRequests[0]).toContain("grant_type=authorization_code");
    expect(tokenRequests[0]).toContain("code=secret-code");
    expect(tokenRequests[0]).toContain("code_verifier=fixed-verifier");
  });

  test("callback with invalid state is rejected", async () => {
    const result = await runMcpOAuthLoginFlow({
      plan: discoveryPlan(),
      clientId: "soba-cli",
      state: "fixed-state",
      pkce: pkcePair(),
      callbackServerFactory: fakeCallbackServerFactory({ type: "invalid_state", state: "wrong-state" }),
      fetchImpl: failingFetch,
    });

    expect(result.type).toBe("invalid_state");
  });

  test("OAuth error callback produces auth-denied result", async () => {
    const result = await runMcpOAuthLoginFlow({
      plan: discoveryPlan(),
      clientId: "soba-cli",
      state: "fixed-state",
      pkce: pkcePair(),
      callbackServerFactory: fakeCallbackServerFactory({ type: "denied", error: "access_denied", state: "fixed-state" }),
      fetchImpl: failingFetch,
    });

    expect(result).toMatchObject({
      type: "auth_denied",
      error: "access_denied",
    });
  });

  test("browser-open failure falls back to printed URL", async () => {
    const messages: string[] = [];
    const result = await runMcpOAuthLoginFlow({
      plan: discoveryPlan(),
      clientId: "soba-cli",
      state: "fixed-state",
      pkce: pkcePair(),
      openBrowser: () => {
        throw new Error("browser unavailable");
      },
      onUserMessage: (message) => messages.push(message),
      callbackServerFactory: fakeCallbackServerFactory({ type: "timeout" }),
      fetchImpl: failingFetch,
    });

    expect(result).toMatchObject({
      type: "timeout",
      browserOpened: false,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Open this MCP login URL:");
    expect(messages[0]).toContain("https://auth.example.com/authorize");
  });

  test("token/code values are redacted from summaries", () => {
    const code = "secret-code-value";
    const token = "secret-token-value";

    expect(redactMcpOAuthValue(code)).toBe("[REDACTED]");
    expect(redactMcpOAuthValue(token)).toBe("[REDACTED]");
    expect(summarizeMcpOAuthCallback({ type: "success", code, state: "fixed-state" })).not.toContain(code);
  });
});

const failingFetch: McpOAuthFetch = async () => {
  throw new Error("fetch should not be called");
};

function discoveryPlan(): McpOAuthDiscoveryPlan {
  return {
    serverId: "remote",
    resourceUrl: "https://mcp.example.com/mcp",
    resourceMetadataUrl: "https://mcp.example.com/.well-known/oauth-protected-resource",
    protectedResource: "https://mcp.example.com",
    issuer: "https://auth.example.com/",
    authorizationEndpoint: "https://auth.example.com/authorize",
    tokenEndpoint: "https://auth.example.com/token",
    scopes: ["mcp.read", "mcp.write"],
  };
}

function pkcePair(): McpPkcePair {
  return {
    verifier: "fixed-verifier",
    challenge: "fixed-challenge",
    method: "S256",
  };
}

function fakeCallbackServerFactory(result: McpOAuthCallbackResult): NonNullable<Parameters<typeof runMcpOAuthLoginFlow>[0]["callbackServerFactory"]> {
  return async () => {
    let closed = false;
    const server: McpOAuthCallbackServer = {
      redirectUri: "http://127.0.0.1:12345/oauth/callback",
      get closed() {
        return closed;
      },
      waitForCallback: async () => result,
      close: () => {
        closed = true;
      },
    };

    return server;
  };
}
