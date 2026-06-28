import { describe, expect, mock, test } from "bun:test";
import { AgentLoop } from "../../../src/engine/turn/agent-loop";
import type { OpenResponsesClient } from "../../../src/infrastructure/llm/openresponses/openresponses-client";
import type { McpClient, McpTool, McpToolCallResult } from "../../../src/infrastructure/mcp/client";
import type { McpClientManagerStatus, McpManagedServerStatus } from "../../../src/infrastructure/mcp/client-manager";
import { syncMcpToolsIntoRegistry } from "../../../src/infrastructure/mcp/tool-registry-sync";
import { SessionManager } from "../../../src/infrastructure/persistence/sessions/session-manager";
import type { CreateResponseParams, ResponseResource } from "../../../src/kernel/model/openresponses-types";
import { ToolRegistry } from "../../../src/kernel/tools/tool-registry";
import type { ToolDefinition } from "../../../src/kernel/tools/types";

describe("ToolRegistry MCP integration", () => {
  test("built-in tool still executes after MCP sync", async () => {
    const registry = new ToolRegistry();
    registry.register(makeBuiltinTool("read"));
    const source = new FakeMcpSource({
      alpha: {
        state: "ready",
        tools: [{ name: "echo" }],
      },
    });

    await syncMcpToolsIntoRegistry(registry, source);
    const result = await registry.get("read")?.execute({ input: "x" }, { cwd: "/tmp" });

    expect(result).toEqual({
      content: [{ type: "text", text: "builtin:read" }],
      isError: false,
    });
    expect(registry.getNames()).toEqual(["read", "mcp_alpha_echo"]);
  });

  test("MCP tool appears after server ready and is model-visible", async () => {
    const registry = new ToolRegistry();
    registry.register(makeBuiltinTool("read"));
    const source = new FakeMcpSource({
      alpha: {
        state: "ready",
        tools: [{ name: "echo", inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } }],
      },
    });

    const sync = await syncMcpToolsIntoRegistry(registry, source);

    expect(sync).toMatchObject({ removed: 0, registered: ["mcp_alpha_echo"], skipped: [] });
    expect(registry.has("mcp_alpha_echo")).toBe(true);
    const toolNames = registry.getOpenResponsesTools().map((tool) => (tool.type === "function" ? tool.name : tool.type));
    expect(toolNames).toContain("mcp_alpha_echo");
    expect(toolNames.every((name) => /^[a-zA-Z0-9_-]+$/.test(name))).toBe(true);
  });

  test("MCP tool disappears after stop or crash while built-ins stay registered", async () => {
    const registry = new ToolRegistry();
    registry.register(makeBuiltinTool("read"));
    const source = new FakeMcpSource({
      alpha: {
        state: "ready",
        tools: [{ name: "echo" }],
      },
    });
    await syncMcpToolsIntoRegistry(registry, source);

    source.setState("alpha", "crashed");
    const sync = await syncMcpToolsIntoRegistry(registry, source);

    expect(sync.removed).toBe(1);
    expect(sync.registered).toEqual([]);
    expect(registry.has("mcp_alpha_echo")).toBe(false);
    expect(registry.has("read")).toBe(true);
  });

  test("MCP execution result is stored through the same AgentLoop session pathway", async () => {
    const registry = new ToolRegistry();
    const source = new FakeMcpSource({
      alpha: {
        state: "ready",
        tools: [{ name: "echo" }],
      },
    });
    source.setResult("alpha", "echo", {
      content: [{ type: "text", text: "mcp-ok" }],
      isError: false,
    });
    await syncMcpToolsIntoRegistry(registry, source);
    const client = makeClient([makeToolCallResponse("mcp_alpha_echo", '{"value":1}'), makeTextResponse("done")]);
    const session = SessionManager.inMemory("/tmp");
    const loop = new AgentLoop(client, session, registry, "/tmp");

    const result = await loop.runTurn("call mcp");

    expect(result.errors).toEqual([]);
    const branchItems = session.getBranch().flatMap((entry) => (entry.type === "item" ? [entry.item] : []));
    expect(branchItems.map((item) => item.type)).toEqual(["message", "function_call", "function_call_output", "message"]);
    const output = branchItems.find((item) => item.type === "function_call_output");
    expect(output).toMatchObject({
      type: "function_call_output",
      call_id: "call_1",
      output: "mcp-ok",
    });
  });

  test("MCP execution timeout returns controlled tool error and does not break built-ins", async () => {
    const registry = new ToolRegistry();
    registry.register(makeBuiltinTool("read"));
    const source = new FakeMcpSource({
      alpha: {
        state: "ready",
        tools: [{ name: "slow" }],
      },
    });
    source.setError("alpha", "slow", Object.assign(new Error("request timed out"), { code: "request_failed" }));
    await syncMcpToolsIntoRegistry(registry, source);

    const result = await registry.get("mcp_alpha_slow")?.execute({}, { cwd: "/tmp" });
    const readResult = await registry.get("read")?.execute({}, { cwd: "/tmp" });

    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain('"code": "request_failed"');
    expect(readResult).toMatchObject({ isError: false });
  });

  test("list-changed refresh does not create duplicate tool names", async () => {
    const registry = new ToolRegistry();
    const source = new FakeMcpSource({
      alpha: {
        state: "ready",
        tools: [{ name: "echo" }],
        toolsListChanged: true,
      },
    });

    await syncMcpToolsIntoRegistry(registry, source);
    source.setTools("alpha", [{ name: "echo" }, { name: "search" }]);
    await syncMcpToolsIntoRegistry(registry, source);

    expect(registry.getNames().filter((name) => name.startsWith("mcp_"))).toEqual(["mcp_alpha_echo", "mcp_alpha_search"]);
  });

  test("failure of one MCP server does not break built-ins or other MCP servers", async () => {
    const registry = new ToolRegistry();
    registry.register(makeBuiltinTool("read"));
    const source = new FakeMcpSource({
      broken: {
        state: "ready",
        tools: [{ name: "bad" }],
        listToolsError: new Error("list failed"),
      },
      healthy: {
        state: "ready",
        tools: [{ name: "ok" }],
      },
    });

    const sync = await syncMcpToolsIntoRegistry(registry, source);

    expect(sync.registered).toEqual(["mcp_healthy_ok"]);
    expect(sync.skipped).toEqual([{ serverId: "broken", reason: "list failed" }]);
    expect(registry.has("read")).toBe(true);
  });
});

interface FakeServerState {
  state: McpManagedServerStatus["state"];
  tools: McpTool[];
  toolsListChanged?: boolean;
  listToolsError?: unknown;
}

class FakeMcpSource {
  private readonly servers = new Map<string, FakeMcpClient>();

  constructor(states: Record<string, FakeServerState>) {
    for (const [serverId, state] of Object.entries(states)) {
      this.servers.set(serverId, new FakeMcpClient(serverId, state));
    }
  }

  getServerIds(): string[] {
    return [...this.servers.keys()];
  }

  getStatus(): McpClientManagerStatus {
    const servers = [...this.servers.values()].map((client) => client.status());
    return {
      servers,
      counts: {
        idle: servers.filter((server) => server.state === "idle").length,
        starting: servers.filter((server) => server.state === "starting").length,
        ready: servers.filter((server) => server.state === "ready").length,
        degraded: servers.filter((server) => server.state === "degraded").length,
        stopping: servers.filter((server) => server.state === "stopping").length,
        stopped: servers.filter((server) => server.state === "stopped").length,
        crashed: servers.filter((server) => server.state === "crashed").length,
      },
    };
  }

  async getClient(serverId: string): Promise<McpClient> {
    const client = this.servers.get(serverId);
    if (!client) {
      throw new Error(`Unknown server ${serverId}`);
    }

    return client as unknown as McpClient;
  }

  setState(serverId: string, state: McpManagedServerStatus["state"]): void {
    this.client(serverId).setState(state);
  }

  setTools(serverId: string, tools: McpTool[]): void {
    this.client(serverId).setTools(tools);
  }

  setResult(serverId: string, toolName: string, result: McpToolCallResult): void {
    this.client(serverId).setResult(toolName, result);
  }

  setError(serverId: string, toolName: string, error: unknown): void {
    this.client(serverId).setError(toolName, error);
  }

  private client(serverId: string): FakeMcpClient {
    const client = this.servers.get(serverId);
    if (!client) {
      throw new Error(`Unknown server ${serverId}`);
    }

    return client;
  }
}

class FakeMcpClient {
  private readonly serverId: string;
  private state: FakeServerState;
  private readonly results = new Map<string, McpToolCallResult>();
  private readonly errors = new Map<string, unknown>();

  constructor(serverId: string, state: FakeServerState) {
    this.serverId = serverId;
    this.state = state;
  }

  status(): McpManagedServerStatus {
    return {
      id: this.serverId,
      name: this.serverId,
      enabled: true,
      started: this.state.state !== "idle",
      state: this.state.state,
      lifecycle: this.state.state === "ready" ? "modern" : null,
      protocolVersion: this.state.state === "ready" ? "2026-07-28" : null,
      lastError: this.state.state === "crashed" ? "crashed" : null,
      lastErrorCode: this.state.state === "crashed" ? "process_exit" : null,
      toolsListChanged: this.state.toolsListChanged ?? false,
      crashRestartCount: 0,
      restartExhausted: false,
    };
  }

  async listTools(): Promise<McpTool[]> {
    if (this.state.listToolsError) {
      throw this.state.listToolsError;
    }

    return this.state.tools;
  }

  async callTool(toolName: string, _args: Record<string, unknown>): Promise<McpToolCallResult> {
    if (this.errors.has(toolName)) {
      throw this.errors.get(toolName);
    }

    return (
      this.results.get(toolName) ?? {
        content: [{ type: "text", text: "ok" }],
        isError: false,
      }
    );
  }

  setState(state: McpManagedServerStatus["state"]): void {
    this.state = { ...this.state, state };
  }

  setTools(tools: McpTool[]): void {
    this.state = { ...this.state, tools, toolsListChanged: true };
  }

  setResult(toolName: string, result: McpToolCallResult): void {
    this.results.set(toolName, result);
  }

  setError(toolName: string, error: unknown): void {
    this.errors.set(toolName, error);
  }
}

function makeBuiltinTool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: `Tool ${name}`,
    parameters: {
      type: "object",
      properties: {},
    },
    toolType: "function",
    async execute() {
      return {
        content: [{ type: "text", text: `builtin:${name}` }],
        isError: false,
      };
    },
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
    id: "resp_tool_1",
    object: "response",
    created_at: 1,
    completed_at: 2,
    status: "completed",
    incomplete_details: null,
    model: "gpt-4o",
    previous_response_id: null,
    instructions: null,
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

function makeTextResponse(text: string): ResponseResource {
  return {
    ...makeToolCallResponse("unused", "{}"),
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
