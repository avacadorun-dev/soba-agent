import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectMemory } from "../../src/engine/memory/project-memory";
import { AgentLoop } from "../../src/engine/turn/agent-loop";
import type { OpenResponsesClient } from "../../src/infrastructure/llm/openresponses/openresponses-client";
import { MCP_DRAFT_PROTOCOL_VERSION, type McpTool, type McpToolCallResult } from "../../src/infrastructure/mcp/client";
import { McpClientManager } from "../../src/infrastructure/mcp/client-manager";
import { JSON_RPC_VERSION, type JsonRpcRequest } from "../../src/infrastructure/mcp/json-rpc";
import type { McpOAuthCallbackResult, McpOAuthCallbackServer } from "../../src/infrastructure/mcp/oauth-callback-server";
import { McpOAuthClient } from "../../src/infrastructure/mcp/oauth-client";
import type { McpOAuthDiscoveryPlan } from "../../src/infrastructure/mcp/oauth-discovery";
import { runMcpOAuthLoginFlow } from "../../src/infrastructure/mcp/oauth-flow";
import type { McpPkcePair } from "../../src/infrastructure/mcp/oauth-pkce";
import { McpOAuthTokenStore, recordFromTokenSet } from "../../src/infrastructure/mcp/oauth-token-store";
import { syncMcpToolsIntoRegistry } from "../../src/infrastructure/mcp/tool-registry-sync";
import type { McpServerConfig } from "../../src/infrastructure/mcp/types";
import { SessionManager } from "../../src/infrastructure/persistence/sessions/session-manager";
import type { CreateResponseParams, ResponseResource } from "../../src/kernel/model/openresponses-types";
import { ToolRegistry } from "../../src/kernel/tools/tool-registry";

const MOCK_MCP_SERVER_PATH = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/mcp/mock-mcp-server.ts");

describe("v0.4.0 release DoD WOW tests", () => {
  const projectRoots: string[] = [];
  const mcpManagers: McpClientManager[] = [];

  afterEach(async () => {
    await Promise.allSettled(mcpManagers.map((manager) => manager.stopAll()));
    mcpManagers.length = 0;

    for (const root of projectRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("WOW-1: a new session receives persisted architecture knowledge without restating it", async () => {
    const projectRoot = createTempProjectRoot();
    const firstRunMemory = new ProjectMemory({ projectRoot });
    firstRunMemory.initialize();

    expect(existsSync(join(projectRoot, ".soba", "memory", "knowledge", "architecture.md"))).toBe(true);
    expect(existsSync(join(projectRoot, ".soba", "memory", "knowledge", "conventions.md"))).toBe(true);
    expect(existsSync(join(projectRoot, ".soba", "memory", "knowledge", "known-errors.md"))).toBe(true);
    expect(existsSync(join(projectRoot, ".soba", "memory", "knowledge", "dependencies.md"))).toBe(true);

    firstRunMemory.getStores().knowledge.write(
      "architecture",
      "# Architecture\n\nSOBA test project uses a release-candidate hexagonal memory backbone.\n",
    );

    const newSessionMemory = new ProjectMemory({ projectRoot });
    const session = SessionManager.inMemory(projectRoot);
    const registry = new ToolRegistry();
    const client = makeCapturingClient([makeTextResponse("The project uses a hexagonal memory backbone.")]);
    const loop = new AgentLoop(client, session, registry, projectRoot, {}, undefined, undefined, undefined, undefined, undefined, undefined, newSessionMemory);

    const result = await loop.runTurn("What is the project architecture?");

    expect(result.errors).toEqual([]);
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.instructions).toContain("<project_knowledge>");
    expect(client.requests[0]?.instructions).toContain("release-candidate hexagonal memory backbone");
    expect(client.requests[0]?.input).not.toContain("release-candidate hexagonal memory backbone");
  });

  test("WOW-2: stdio MCP tools use the shared ToolRegistry and AgentLoop session path", async () => {
    const projectRoot = createTempProjectRoot();
    const registry = new ToolRegistry();
    const manager = new McpClientManager({
      servers: [
        mockServerConfig(projectRoot, "mock-modern", { SOBA_MOCK_MCP_SCENARIO: "modern" }),
        mockServerConfig(projectRoot, "mock-legacy", {
          SOBA_MOCK_MCP_SCENARIO: "legacy",
          SOBA_MOCK_MCP_PAGE_SIZE: "2",
        }),
      ],
    });
    mcpManagers.push(manager);

    await manager.start("mock-modern");
    await manager.start("mock-legacy");
    const sync = await syncMcpToolsIntoRegistry(registry, manager);

    expect(sync.skipped).toEqual([]);
    expect(registry.getNames().filter((name) => name.startsWith("mcp_")).sort()).toContain("mcp_mock_modern_echo");
    expect(registry.getNames().filter((name) => name.startsWith("mcp_")).sort()).toContain("mcp_mock_legacy_echo");
    expect(registry.getOpenResponsesTools().map((tool) => (tool.type === "function" ? tool.name : tool.type))).toContain("mcp_mock_modern_echo");

    const session = SessionManager.inMemory(projectRoot);
    const client = makeCapturingClient([
      makeToolCallResponse("mcp_mock_modern_echo", JSON.stringify({ value: "release-wow" })),
      makeTextResponse("MCP echo completed through the shared path."),
    ]);
    const loop = new AgentLoop(client, session, registry, projectRoot);

    const result = await loop.runTurn("Call the external MCP echo tool.");

    expect(result.errors).toEqual([]);
    const branchItems = session.getBranch().flatMap((entry) => (entry.type === "item" ? [entry.item] : []));
    expect(branchItems.map((item) => item.type)).toEqual(["message", "function_call", "function_call_output", "message"]);
    expect(branchItems.find((item) => item.type === "function_call")).toMatchObject({
      type: "function_call",
      name: "mcp_mock_modern_echo",
      call_id: "call_1",
    });
    expect(branchItems.find((item) => item.type === "function_call_output")).toMatchObject({
      type: "function_call_output",
      call_id: "call_1",
    });
    expect(JSON.stringify(branchItems.find((item) => item.type === "function_call_output"))).toContain("release-wow");
  });

  test("WOW-R2: remote no-auth tool call uses the same ToolRegistry and AgentLoop path", async () => {
    await withRemoteMcpServer(
      {
        tools: [{ name: "repo.summary" }],
        callResult: {
          content: [{ type: "text", text: "remote release summary" }],
          structuredContent: { source: "remote" },
          resultType: "structured",
          isError: false,
        },
      },
      async (server) => {
        const projectRoot = createTempProjectRoot();
        const registry = new ToolRegistry();
        const manager = new McpClientManager({ servers: [remoteServerConfig(server)] });
        mcpManagers.push(manager);

        await manager.start("remote-docs");
        const sync = await syncMcpToolsIntoRegistry(registry, manager);

        expect(sync.registered).toEqual(["mcp_remote_docs_repo_summary"]);
        expect(registry.getNames().every((name) => /^[a-zA-Z0-9_-]+$/.test(name))).toBe(true);

        const session = SessionManager.inMemory(projectRoot);
        const client = makeCapturingClient([
          makeToolCallResponse("mcp_remote_docs_repo_summary", JSON.stringify({ topic: "release" })),
          makeTextResponse("Remote MCP completed through the shared path."),
        ]);
        const loop = new AgentLoop(client, session, registry, projectRoot);

        const result = await loop.runTurn("Call the remote MCP summary tool.");

        expect(result.errors).toEqual([]);
        expect(server.toolCalls).toEqual([{ name: "repo.summary", arguments: { topic: "release" } }]);
        const output = session
          .getBranch()
          .flatMap((entry) => (entry.type === "item" ? [entry.item] : []))
          .find((item) => item.type === "function_call_output");
        expect(output).toMatchObject({
          type: "function_call_output",
          call_id: "call_1",
          output: 'remote release summary\n{\n  "source": "remote"\n}',
        });
      },
    );
  });

  test("WOW-R3: OAuth login flow stores tokens and updates MCP auth status", async () => {
    const projectRoot = createTempProjectRoot();
    const store = new McpOAuthTokenStore({ path: join(projectRoot, ".soba", "oauth-tokens.json") });
    const flow = await runMcpOAuthLoginFlow({
      plan: discoveryPlan("remote-docs"),
      clientId: "soba-cli",
      state: "release-state",
      pkce: pkcePair(),
      callbackServerFactory: fakeCallbackServerFactory({ type: "success", code: "secret-code", state: "release-state" }),
      fetchImpl: async (_input, init) => {
        expect(String(init?.body)).toContain("code=secret-code");
        return Response.json({
          access_token: "secret-access-token",
          token_type: "Bearer",
          refresh_token: "secret-refresh-token",
          expires_in: 3600,
          scope: "mcp.read",
        });
      },
    });
    expect(flow.type).toBe("success");

    const oauthClient = new McpOAuthClient({
      projectRoot,
      serverId: "remote-docs",
      plan: discoveryPlan("remote-docs"),
      clientId: "soba-cli",
      store,
    });
    if (flow.type === "success") {
      await oauthClient.saveTokens(flow.tokens, 10_000);
    }

    const auth = await oauthClient.authorization(20_000);
    const manager = new McpClientManager({
      servers: [remoteServerConfig({ url: "https://mcp.example.com/mcp", toolCalls: [] })],
      authController: {
        cachedStatus: () => ({ type: "oauth", state: auth.type === "authorized" ? "authenticated" : "auth_required", detail: "oauth", nextAction: null }),
      },
    });

    expect(auth.type).toBe("authorized");
    expect(manager.getStatus().servers[0]?.authState).toMatchObject({
      type: "oauth",
      state: "authenticated",
    });
  });

  test("WOW-R4: expired OAuth access token refreshes once without leaking token diagnostics", async () => {
    const projectRoot = createTempProjectRoot();
    const store = new McpOAuthTokenStore({ path: join(projectRoot, ".soba", "oauth-tokens.json") });
    await store.save(
      recordFromTokenSet({
        projectRoot,
        serverId: "remote-docs",
        issuer: "https://auth.example.com/",
        accessToken: "expired-access-token",
        refreshToken: "secret-refresh-token",
        expiresIn: -10,
        now: 10_000,
      }),
    );

    let refreshCount = 0;
    const client = new McpOAuthClient({
      projectRoot,
      serverId: "remote-docs",
      plan: discoveryPlan("remote-docs"),
      clientId: "soba-cli",
      store,
      refreshSkewMs: 0,
      fetchImpl: async (_input, init) => {
        refreshCount += 1;
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        return Response.json({
          access_token: "fresh-access-token",
          token_type: "Bearer",
          refresh_token: "fresh-refresh-token",
          expires_in: 3600,
        });
      },
    });

    const auth = await client.authorization(20_000);
    const diagnostics = JSON.stringify(client.diagnostics(auth));

    expect(refreshCount).toBe(1);
    expect(auth).toMatchObject({ type: "authorized", authorizationHeader: "Bearer fresh-access-token" });
    expect(diagnostics).not.toContain("fresh-access-token");
    expect(diagnostics).not.toContain("secret-refresh-token");
    expect(diagnostics).toContain("[REDACTED]");
  });

  test("WOW-R5: invalid refresh token recovers to auth_required with login next action", async () => {
    const projectRoot = createTempProjectRoot();
    const store = new McpOAuthTokenStore({ path: join(projectRoot, ".soba", "oauth-tokens.json") });
    await store.save(
      recordFromTokenSet({
        projectRoot,
        serverId: "remote-docs",
        issuer: "https://auth.example.com/",
        accessToken: "expired-access-token",
        refreshToken: "invalid-refresh-token",
        expiresIn: -10,
        now: 10_000,
      }),
    );

    const oauthClient = new McpOAuthClient({
      projectRoot,
      serverId: "remote-docs",
      plan: discoveryPlan("remote-docs"),
      clientId: "soba-cli",
      store,
      refreshSkewMs: 0,
      fetchImpl: async () => new Response("invalid_grant", { status: 400 }),
    });

    const auth = await oauthClient.authorization(20_000);
    expect(auth).toEqual({ type: "auth_required", reason: "refresh_failed" });
    await expect(store.load(projectRoot, "remote-docs", "https://auth.example.com/")).resolves.toBeNull();

    await withRemoteMcpServer(
      {
        tools: [{ name: "summary" }],
        unauthorized: true,
      },
      async (server) => {
        const manager = new McpClientManager({ servers: [remoteServerConfig(server)] });
        mcpManagers.push(manager);

        await expect(manager.start("remote-docs")).rejects.toMatchObject({ code: "auth_required" });
        expect(manager.getStatus().servers[0]?.authState).toMatchObject({
          type: "none",
          state: "auth_required",
          nextAction: "Run /mcp auth login remote-docs",
        });
      },
    );
  });

  function createTempProjectRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "soba-release-dod-"));
    projectRoots.push(root);
    return root;
  }
});

interface CapturingClient extends OpenResponsesClient {
  requests: CreateResponseParams[];
}

function makeCapturingClient(responses: ResponseResource[]): CapturingClient {
  let index = 0;
  const requests: CreateResponseParams[] = [];
  return {
    requests,
    getConfig: () => ({
      baseUrl: "",
      apiKey: "test",
      model: "gpt-4o",
      maxOutputTokens: 16_384,
      maxCompletionTokens: 0,
      contextWindow: 128_000,
      temperature: 0.7,
    }),
    updateConfig: () => undefined,
    create: mock(async (params: CreateResponseParams) => {
      requests.push(params);
      const response = responses[index] as ResponseResource;
      index = Math.min(index + 1, responses.length - 1);
      return response;
    }),
    createStream: mock(async function* () {}),
    compact: mock(async () => ({
      id: "comp_1",
      object: "response.compaction" as const,
      output: [],
      created_at: 1,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    })),
    getProviderIdentity: () => ({
      adapterId: "openai",
      endpointOrigin: "https://api.openai.com/v1",
      model: "gpt-4o",
    }),
    getProviderCapabilities: () => ({
      nativeCompaction: false,
      structuredOutput: true,
      developerMessages: false,
    }),
    classifyError: () => "unknown" as const,
    compactNative: mock(async () => {
      throw new Error("compactNative not implemented");
    }),
  };
}

function mockServerConfig(projectRoot: string, id: string, env: Record<string, string>): McpServerConfig {
  return {
    id,
    name: id,
    transport: "stdio",
    command: "bun",
    args: ["run", MOCK_MCP_SERVER_PATH],
    env,
    cwd: projectRoot,
    timeoutMs: 2_000,
    maxOutputBytes: 1024 * 1024,
    trustMode: "normal",
    enabled: true,
  };
}

interface RemoteMcpServerOptions {
  tools: McpTool[];
  callResult?: McpToolCallResult;
  unauthorized?: boolean;
}

interface RemoteMcpServerFixture {
  url: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
}

async function withRemoteMcpServer(options: RemoteMcpServerOptions, run: (server: RemoteMcpServerFixture) => Promise<void>): Promise<void> {
  const fixture: RemoteMcpServerFixture = {
    url: "",
    toolCalls: [],
  };
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method === "DELETE") {
        return new Response(null, { status: 202 });
      }
      if (options.unauthorized) {
        return new Response("unauthorized", { status: 401 });
      }

      const body = (await request.json()) as JsonRpcRequest;
      const headers = new Headers({ "content-type": "application/json" });

      if (body.method === "server/discover") {
        return Response.json(
          {
            jsonrpc: JSON_RPC_VERSION,
            id: body.id,
            result: {
              protocolVersions: [MCP_DRAFT_PROTOCOL_VERSION],
              capabilities: { tools: { listChanged: true } },
              serverInfo: { name: "remote release fixture" },
            },
          },
          { headers },
        );
      }

      if (body.method === "tools/list") {
        return Response.json({ jsonrpc: JSON_RPC_VERSION, id: body.id, result: { tools: options.tools } }, { headers });
      }

      if (body.method === "tools/call") {
        const params = isRecord(body.params) ? body.params : {};
        const name = typeof params.name === "string" ? params.name : "";
        const args = isRecord(params.arguments) ? params.arguments : {};
        fixture.toolCalls.push({ name, arguments: args });
        return Response.json(
          {
            jsonrpc: JSON_RPC_VERSION,
            id: body.id,
            result: options.callResult ?? {
              content: [{ type: "text", text: "ok" }],
              isError: false,
            },
          },
          { headers },
        );
      }

      return Response.json(
        {
          jsonrpc: JSON_RPC_VERSION,
          id: body.id,
          error: { code: -32601, message: "Method not found" },
        },
        { status: 404, headers },
      );
    },
  });

  fixture.url = new URL("/mcp", server.url).toString();
  try {
    await run(fixture);
  } finally {
    server.stop(true);
  }
}

function remoteServerConfig(server: RemoteMcpServerFixture): McpServerConfig {
  return {
    id: "remote-docs",
    name: "Remote Docs",
    transport: "streamableHttp",
    url: server.url,
    headers: {},
    auth: { type: "none" },
    timeoutMs: 500,
    maxOutputBytes: 1024 * 1024,
    trustMode: "normal",
    enabled: true,
  };
}

function discoveryPlan(serverId: string): McpOAuthDiscoveryPlan {
  return {
    serverId,
    resourceUrl: "https://mcp.example.com/mcp",
    resourceMetadataUrl: "https://mcp.example.com/.well-known/oauth-protected-resource",
    protectedResource: "https://mcp.example.com",
    issuer: "https://auth.example.com/",
    authorizationEndpoint: "https://auth.example.com/authorize",
    tokenEndpoint: "https://auth.example.com/token",
    scopes: ["mcp.read"],
  };
}

function pkcePair(): McpPkcePair {
  return {
    verifier: "release-verifier",
    challenge: "release-challenge",
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

function makeToolCallResponse(toolName: string, args: string): ResponseResource {
  return {
    ...baseResponse(),
    id: "resp_tool_1",
    output: [
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: toolName,
        arguments: args,
        status: "completed",
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeTextResponse(text: string): ResponseResource {
  return {
    ...baseResponse(),
    id: "resp_text_1",
    output: [
      {
        type: "message",
        id: "msg_1",
        status: "completed",
        role: "assistant",
        phase: "final_answer",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
  };
}

function baseResponse(): ResponseResource {
  return {
    id: "resp_base",
    object: "response",
    created_at: 1,
    completed_at: 2,
    status: "completed",
    incomplete_details: null,
    model: "gpt-4o",
    previous_response_id: null,
    instructions: null,
    output: [],
    error: null,
    tools: [],
    tool_choice: "auto",
    truncation: "disabled",
    parallel_tool_calls: true,
    text: {},
    top_p: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
    top_logprobs: 0,
    temperature: 1,
    reasoning: null,
    usage: {
      input_tokens: 100,
      output_tokens: 30,
      total_tokens: 130,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    max_output_tokens: null,
    max_tool_calls: null,
    store: false,
    background: false,
    service_tier: "default",
    metadata: {},
    safety_identifier: null,
    prompt_cache_key: null,
  };
}
