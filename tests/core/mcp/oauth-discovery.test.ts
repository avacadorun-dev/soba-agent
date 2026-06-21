import { describe, expect, test } from "bun:test";
import {
  discoverMcpOAuthPlan,
  McpOAuthDiscoveryError,
  type McpOAuthFetch,
  parseBearerWwwAuthenticate,
} from "../../../src/core/mcp/oauth-discovery";

describe("MCP OAuth discovery", () => {
  test("parses WWW-Authenticate with resource metadata", () => {
    const challenge = parseBearerWwwAuthenticate(
      'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="mcp tools"',
    );

    expect(challenge).toEqual({
      resourceMetadataUrl: "https://mcp.example.com/.well-known/oauth-protected-resource",
      scope: "mcp tools",
    });
  });

  test("probes path-specific protected resource metadata", async () => {
    const fetcher = createMetadataFetch({
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp/v1": protectedResourceMetadata(),
      "https://auth.example.com/.well-known/oauth-authorization-server": authServerMetadata(),
    });

    const plan = await discoverMcpOAuthPlan({
      serverId: "remote",
      resourceUrl: "https://mcp.example.com/mcp/v1",
      defaultScopes: ["mcp.default"],
      fetchImpl: fetcher.fetch,
    });

    expect(plan.resourceMetadataUrl).toBe("https://mcp.example.com/.well-known/oauth-protected-resource/mcp/v1");
    expect(plan.scopes).toEqual(["mcp.default"]);
    expect(fetcher.urls[0]).toBe("https://mcp.example.com/.well-known/oauth-protected-resource/mcp/v1");
  });

  test("falls back to root protected resource metadata", async () => {
    const fetcher = createMetadataFetch({
      "https://mcp.example.com/.well-known/oauth-protected-resource": protectedResourceMetadata(),
      "https://auth.example.com/.well-known/oauth-authorization-server": authServerMetadata(),
    });

    const plan = await discoverMcpOAuthPlan({
      serverId: "remote",
      resourceUrl: "https://mcp.example.com/mcp/v1",
      fetchImpl: fetcher.fetch,
    });

    expect(plan.resourceMetadataUrl).toBe("https://mcp.example.com/.well-known/oauth-protected-resource");
    expect(fetcher.urls.slice(0, 2)).toEqual([
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp/v1",
      "https://mcp.example.com/.well-known/oauth-protected-resource",
    ]);
  });

  test("discovers authorization server metadata via OAuth well-known", async () => {
    const fetcher = createMetadataFetch({
      "https://mcp.example.com/.well-known/oauth-protected-resource": protectedResourceMetadata(),
      "https://auth.example.com/.well-known/oauth-authorization-server": authServerMetadata(),
    });

    const plan = await discoverMcpOAuthPlan({
      serverId: "remote",
      resourceUrl: "https://mcp.example.com",
      fetchImpl: fetcher.fetch,
    });

    expect(plan.authorizationEndpoint).toBe("https://auth.example.com/authorize");
    expect(plan.tokenEndpoint).toBe("https://auth.example.com/token");
    expect(fetcher.urls).toContain("https://auth.example.com/.well-known/oauth-authorization-server");
  });

  test("falls back to OIDC well-known", async () => {
    const fetcher = createMetadataFetch({
      "https://mcp.example.com/.well-known/oauth-protected-resource": protectedResourceMetadata(),
      "https://auth.example.com/.well-known/openid-configuration": authServerMetadata(),
    });

    const plan = await discoverMcpOAuthPlan({
      serverId: "remote",
      resourceUrl: "https://mcp.example.com",
      fetchImpl: fetcher.fetch,
    });

    expect(plan.issuer).toBe("https://auth.example.com/");
    expect(fetcher.urls).toContain("https://auth.example.com/.well-known/oauth-authorization-server");
    expect(fetcher.urls).toContain("https://auth.example.com/.well-known/openid-configuration");
  });

  test("issuer with path uses correct discovery order", async () => {
    const fetcher = createMetadataFetch({
      "https://mcp.example.com/.well-known/oauth-protected-resource": protectedResourceMetadata({
        authorization_servers: ["https://auth.example.com/tenant/a"],
      }),
      "https://auth.example.com/.well-known/oauth-authorization-server/tenant/a": authServerMetadata({
        issuer: "https://auth.example.com/tenant/a",
        authorization_endpoint: "https://auth.example.com/tenant/a/authorize",
        token_endpoint: "https://auth.example.com/tenant/a/token",
      }),
    });

    const plan = await discoverMcpOAuthPlan({
      serverId: "remote",
      resourceUrl: "https://mcp.example.com",
      fetchImpl: fetcher.fetch,
    });

    expect(plan.issuer).toBe("https://auth.example.com/tenant/a");
    expect(fetcher.urls).toEqual([
      "https://mcp.example.com/.well-known/oauth-protected-resource",
      "https://auth.example.com/.well-known/oauth-authorization-server/tenant/a",
    ]);
  });

  test("challenged scope wins over configured default", async () => {
    const fetcher = createMetadataFetch({
      "https://mcp.example.com/.well-known/oauth-protected-resource": protectedResourceMetadata(),
      "https://auth.example.com/.well-known/oauth-authorization-server": authServerMetadata(),
    });

    const plan = await discoverMcpOAuthPlan({
      serverId: "remote",
      resourceUrl: "https://mcp.example.com",
      wwwAuthenticate:
        'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="mcp.read mcp.write"',
      defaultScopes: ["configured.default"],
      fetchImpl: fetcher.fetch,
    });

    expect(plan.scopes).toEqual(["mcp.read", "mcp.write"]);
  });

  test("insecure non-local metadata URL is rejected", async () => {
    await expect(
      discoverMcpOAuthPlan({
        serverId: "remote",
        resourceUrl: "https://mcp.example.com",
        wwwAuthenticate: 'Bearer resource_metadata="http://evil.example.com/.well-known/oauth-protected-resource"',
        fetchImpl: createMetadataFetch({}).fetch,
      }),
    ).rejects.toMatchObject({
      code: "invalid_metadata_url",
      nextAction: "use_https_metadata",
    });
  });

  test("discovery errors do not include tokens or auth headers", async () => {
    const token = "secret-token-from-header";

    try {
      await discoverMcpOAuthPlan({
        serverId: "remote",
        resourceUrl: "https://mcp.example.com",
        wwwAuthenticate: `Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", error_description="${token}"`,
        fetchImpl: createMetadataFetch({
          "https://mcp.example.com/.well-known/oauth-protected-resource": {
            resource: "https://mcp.example.com",
          },
        }).fetch,
      });
      throw new Error("Expected discovery to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(McpOAuthDiscoveryError);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(token);
      expect(message.toLowerCase()).not.toContain("authorization");
      expect(message.toLowerCase()).not.toContain("www-authenticate");
    }
  });
});

function createMetadataFetch(metadataByUrl: Record<string, unknown>): {
  urls: string[];
  fetch: McpOAuthFetch;
} {
  const urls: string[] = [];
  const fetchImpl: McpOAuthFetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    const metadata = metadataByUrl[url];

    if (!metadata) {
      return new Response("not found", { status: 404 });
    }

    return Response.json(metadata);
  };

  return {
    urls,
    fetch: fetchImpl,
  };
}

function protectedResourceMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resource: "https://mcp.example.com",
    authorization_servers: ["https://auth.example.com"],
    ...overrides,
  };
}

function authServerMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issuer: "https://auth.example.com/",
    authorization_endpoint: "https://auth.example.com/authorize",
    token_endpoint: "https://auth.example.com/token",
    ...overrides,
  };
}
