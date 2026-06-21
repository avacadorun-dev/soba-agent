import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenResponsesClient } from "../../../src/core/client/openresponses-client";
import type { CreateResponseParams, ResponseResource } from "../../../src/core/client/types";
import { AgentLoop } from "../../../src/core/loop/agent-loop";
import { MCP_DRAFT_PROTOCOL_VERSION, McpClient, type McpTool, type McpToolCallResult } from "../../../src/core/mcp/client";
import { McpClientManager } from "../../../src/core/mcp/client-manager";
import { MCP_SESSION_ID_HEADER } from "../../../src/core/mcp/http-session";
import { JSON_RPC_VERSION, type JsonRpcRequest } from "../../../src/core/mcp/json-rpc";
import { McpStreamableHttpTransport } from "../../../src/core/mcp/streamable-http-transport";
import { syncMcpToolsIntoRegistry } from "../../../src/core/mcp/tool-registry-sync";
import type { McpStreamableHttpServerConfig } from "../../../src/core/mcp/types";
import { SessionManager } from "../../../src/core/session/session-manager";
import { ToolRegistry } from "../../../src/core/tools/tool-registry";
import { TrustManager } from "../../../src/core/trust/trust-manager";

describe("Remote MCP tools through AgentLoop", () => {
  test("remote tool records the same function_call_output session shape without auth or session leaks", async () => {
    const secretToken = "secret-remote-token";
    const sessionId = "session-remote-123";
    const previousToken = process.env.REMOTE_MCP_TOKEN;
    process.env.REMOTE_MCP_TOKEN = secretToken;
    const tempDir = mkdtempSync(join(tmpdir(), "soba-remote-mcp-session-"));

    try {
      await withRemoteMcpServer(
        {
          tools: [{ name: "summarize" }],
          sessionId,
          callResult: {
            content: [{ type: "text", text: "remote summary" }],
            structuredContent: { citations: 2 },
            resultType: "structured",
            isError: false,
          },
        },
        async (server) => {
          const manager = new McpClientManager({
            servers: [
              {
                ...remoteServerConfig(server),
                auth: { type: "bearerEnv", env: "REMOTE_MCP_TOKEN" },
              },
            ],
          });
          await manager.start("remote-docs");
          const registry = new ToolRegistry();
          await syncMcpToolsIntoRegistry(registry, manager);
          const client = makeClient([makeToolCallResponse("mcp_remote_docs_summarize", '{"topic":"mcp"}'), makeTextResponse("done")]);
          const session = SessionManager.create("/tmp/remote-project", tempDir);
          const loop = new AgentLoop(client, session, registry, "/tmp/remote-project");

          const result = await loop.runTurn("summarize remote docs");

          expect(result.errors).toEqual([]);
          expect(server.seenAuthorization).toContain(`Bearer ${secretToken}`);
          expect(server.seenSessions).toContain(sessionId);
          const output = session
            .getBranch()
            .flatMap((entry) => (entry.type === "item" ? [entry.item] : []))
            .find((item) => item.type === "function_call_output");
          expect(output).toMatchObject({
            type: "function_call_output",
            call_id: "call_1",
            output: 'remote summary\n{\n  "citations": 2\n}',
          });

          const sessionJsonl = readFileSync(session.getSessionFile() as string, "utf-8");
          expect(sessionJsonl).toContain('"type":"function_call_output"');
          expect(sessionJsonl).not.toContain(secretToken);
          expect(sessionJsonl).not.toContain(sessionId);

          await manager.stopAll();
        },
      );
    } finally {
      if (previousToken === undefined) {
        delete process.env.REMOTE_MCP_TOKEN;
      } else {
        process.env.REMOTE_MCP_TOKEN = previousToken;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("dangerous remote tool uses the same trust prompt and denial path", async () => {
    await withRemoteMcpServer(
      {
        tools: [{ name: "delete_index" }],
      },
      async (server) => {
        const manager = new McpClientManager({
          servers: [
            {
              ...remoteServerConfig(server),
              trustMode: "dangerous",
            },
          ],
        });
        await manager.start("remote-docs");
        const registry = new ToolRegistry();
        const trustManager = new TrustManager();
        await syncMcpToolsIntoRegistry(registry, manager, { trustManager });
        const client = makeClient([makeToolCallResponse("mcp_remote_docs_delete_index", '{"force":true}'), makeTextResponse("denied")]);
        const session = SessionManager.inMemory("/tmp/remote-project");
        const loop = new AgentLoop(client, session, registry, "/tmp/remote-project", {}, trustManager);
        const confirmations: string[] = [];

        loop.onEvent((event) => {
          if (event.type === "dangerous_confirmation") {
            confirmations.push(event.description);
            event.resolve("deny");
          }
        });

        const result = await loop.runTurn("delete remote index");

        expect(confirmations).toEqual(['mcp_remote_docs_delete_index({"force":true})']);
        expect(server.toolCalls).toEqual([]);
        expect(result.errors.some((error) => error.type === "security_denial")).toBe(true);

        await manager.stopAll();
      },
    );
  });

  test("turn cancellation propagates through remote MCP HTTP transport", async () => {
    let abortObserved = false;
    let loop: AgentLoop;
    const config = remoteServerConfig({
      url: "http://127.0.0.1:1/mcp",
      toolCalls: [],
      seenAuthorization: [],
      seenSessions: [],
    });
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit | BunFetchRequestInit) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as JsonRpcRequest) : null;
      if (body?.method === "server/discover") {
        return Response.json({
          jsonrpc: JSON_RPC_VERSION,
          id: body.id,
          result: {
            protocolVersions: [MCP_DRAFT_PROTOCOL_VERSION],
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: "remote fixture" },
          },
        });
      }
      if (body?.method === "tools/list") {
        return Response.json({ jsonrpc: JSON_RPC_VERSION, id: body.id, result: { tools: [{ name: "slow" }] } });
      }
      if (body?.method === "tools/call") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              abortObserved = true;
              reject(new DOMException("The operation was aborted.", "AbortError"));
            },
            { once: true },
          );
          setTimeout(() => loop.abort(), 0);
        });
      }

      return Response.json({ jsonrpc: JSON_RPC_VERSION, id: body?.id ?? null, result: {} });
    }) as unknown as typeof fetch;
    const manager = new McpClientManager({
      servers: [config],
      createClient: (server) =>
        new McpClient({
          server,
          transportFactory: (onEvent) =>
            new McpStreamableHttpTransport({
              url: config.url,
              timeoutMs: 500,
              fetchImpl,
              onEvent,
            }),
        }),
    });
    await manager.start("remote-docs");
    const registry = new ToolRegistry();
    await syncMcpToolsIntoRegistry(registry, manager);
    const client = makeClient([makeToolCallResponse("mcp_remote_docs_slow", "{}"), makeTextResponse("cancelled")]);
    const session = SessionManager.inMemory("/tmp/remote-project");
    loop = new AgentLoop(client, session, registry, "/tmp/remote-project");

    const result = await loop.runTurn("call slow remote tool");

    expect(abortObserved).toBe(true);
    expect(result.errors.some((error) => error.type === "tool_error")).toBe(true);

    await manager.stopAll();
  });
});

interface RemoteMcpServerOptions {
  tools: McpTool[];
  callResult?: McpToolCallResult;
  sessionId?: string;
}

interface RemoteMcpServerFixture {
  url: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  seenAuthorization: string[];
  seenSessions: string[];
}

async function withRemoteMcpServer(options: RemoteMcpServerOptions, run: (server: RemoteMcpServerFixture) => Promise<void>): Promise<void> {
  const fixture: RemoteMcpServerFixture = {
    url: "",
    toolCalls: [],
    seenAuthorization: [],
    seenSessions: [],
  };
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method === "DELETE") {
        return new Response(null, { status: 202 });
      }

      const authorization = request.headers.get("authorization");
      if (authorization) {
        fixture.seenAuthorization.push(authorization);
      }
      const session = request.headers.get(MCP_SESSION_ID_HEADER);
      if (session) {
        fixture.seenSessions.push(session);
      }

      const body = (await request.json()) as JsonRpcRequest;
      const headers = new Headers({ "content-type": "application/json" });
      if (options.sessionId) {
        headers.set(MCP_SESSION_ID_HEADER, options.sessionId);
      }

      if (body.method === "server/discover") {
        return Response.json(
          {
            jsonrpc: JSON_RPC_VERSION,
            id: body.id,
            result: {
              protocolVersions: [MCP_DRAFT_PROTOCOL_VERSION],
              capabilities: { tools: { listChanged: true } },
              serverInfo: { name: "remote fixture" },
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

function remoteServerConfig(server: RemoteMcpServerFixture): McpStreamableHttpServerConfig {
  return {
    id: "remote-docs",
    name: "Remote Docs",
    transport: "streamableHttp",
    url: server.url,
    headers: {},
    auth: { type: "none" },
    timeoutMs: 500,
    maxOutputBytes: 1024,
    trustMode: "normal",
    enabled: true,
  };
}

function makeClient(responses: ResponseResource[]): OpenResponsesClient {
  let index = 0;
  return {
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
    create: mock(async (_params: CreateResponseParams) => {
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

function makeToolCallResponse(toolName: string, args: string): ResponseResource {
  return {
    ...baseResponse("resp_tool_1"),
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

function makeTextResponse(text: string): ResponseResource {
  return {
    ...baseResponse("resp_text_1"),
    output: [
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
  };
}

function baseResponse(id: string): ResponseResource {
  return {
    id,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
