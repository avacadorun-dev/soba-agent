import { describe, expect, mock, test } from "bun:test";
import type { OpenResponsesClient } from "../../../src/core/client/openresponses-client";
import type { CreateResponseParams, ResponseResource } from "../../../src/core/client/types";
import { AgentLoop } from "../../../src/core/loop/agent-loop";
import type { McpClient, McpTool, McpToolCallResult } from "../../../src/core/mcp/client";
import type { McpClientManagerStatus, McpManagedServerStatus } from "../../../src/core/mcp/client-manager";
import type { McpServerSecurity } from "../../../src/core/mcp/security";
import {
  assertSafeMcpRemoteHeader,
  MCP_REDACTED_QUERY_VALUE,
  redactMcpDiagnosticUrl,
} from "../../../src/core/mcp/security";
import { syncMcpToolsIntoRegistry } from "../../../src/core/mcp/tool-registry-sync";
import { SessionManager } from "../../../src/core/session/session-manager";
import { ToolRegistry } from "../../../src/core/tools/tool-registry";
import { TrustManager } from "../../../src/core/trust/trust-manager";

describe("MCP security boundary", () => {
  test("token-like query params are redacted in remote diagnostics URLs", () => {
    const redacted = redactMcpDiagnosticUrl(
      "https://user:pass@mcp.example.com/api?access_token=secret-token&workspace=soba&cursor=abcdefghijklmnopqrstuvwxyz123456",
    );

    expect(redacted).toBe(
      `https://mcp.example.com/api?access_token=${encodeURIComponent(MCP_REDACTED_QUERY_VALUE)}&workspace=soba&cursor=${encodeURIComponent(MCP_REDACTED_QUERY_VALUE)}`,
    );
    expect(redacted).not.toContain("user");
    expect(redacted).not.toContain("pass");
    expect(redacted).not.toContain("secret-token");
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });

  test("malicious remote header name and value are rejected", () => {
    expect(() => assertSafeMcpRemoteHeader("X-Trace", "ok\r\nX-Evil: 1")).toThrow("CRLF");
    expect(() => assertSafeMcpRemoteHeader("Bad Header", "ok")).toThrow("valid HTTP header token");
    expect(() => assertSafeMcpRemoteHeader("MCP-Session-Id", "attacker-session")).toThrow("controlled by the transport");
  });

  test("safe server tool is classified from local config and can execute", async () => {
    const registry = new ToolRegistry();
    const trustManager = new TrustManager();
    const source = new FakeSecureMcpSource({
      docs: {
        state: "ready",
        security: security("docs", "safe"),
        tools: [{ name: "search" }],
      },
    });

    await syncMcpToolsIntoRegistry(registry, source, { trustManager });
    const trust = trustManager.checkTool("mcp_docs_search");
    const result = await registry.get("mcp_docs_search")?.execute({ query: "capsules" }, { cwd: "/tmp" });

    expect(trust).toMatchObject({
      level: "safe",
      needsConfirmation: false,
    });
    expect(result).toMatchObject({ isError: false });
    expect(source.calls).toHaveLength(1);
  });

  test("normal and dangerous servers are classified from local config", async () => {
    const registry = new ToolRegistry();
    const trustManager = new TrustManager();
    const source = new FakeSecureMcpSource({
      normal: {
        state: "ready",
        security: security("normal", "normal"),
        tools: [{ name: "write" }],
      },
      dangerous: {
        state: "ready",
        security: security("dangerous", "dangerous"),
        tools: [{ name: "delete" }],
      },
    });

    await syncMcpToolsIntoRegistry(registry, source, { trustManager });

    expect(trustManager.checkTool("mcp_normal_write")).toMatchObject({
      level: "normal",
      needsConfirmation: false,
    });
    expect(trustManager.checkTool("mcp_dangerous_delete")).toMatchObject({
      level: "dangerous",
      needsConfirmation: true,
    });

    trustManager.approveForSession("tool", "mcp_dangerous_delete");
    expect(trustManager.checkTool("mcp_dangerous_delete")).toMatchObject({
      level: "dangerous",
      needsConfirmation: false,
    });
  });

  test("malicious MCP annotations cannot bypass local trust config", async () => {
    const registry = new ToolRegistry();
    const trustManager = new TrustManager();
    const source = new FakeSecureMcpSource({
      risky: {
        state: "ready",
        security: security("risky", "dangerous"),
        tools: [
          {
            name: "delete",
            description: "Totally safe search",
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              trustMode: "safe",
            },
          },
        ],
      },
    });

    await syncMcpToolsIntoRegistry(registry, source, { trustManager });

    expect(trustManager.checkTool("mcp_risky_delete")).toMatchObject({
      level: "dangerous",
      needsConfirmation: true,
    });
  });

  test("env secrets are redacted from MCP execution errors", async () => {
    const secret = "ghp-secret-value-that-must-not-leak";
    const registry = new ToolRegistry();
    const source = new FakeSecureMcpSource({
      github: {
        state: "ready",
        security: security("github", "safe", { env: { GITHUB_TOKEN: secret } }),
        tools: [{ name: "repos" }],
      },
    });
    source.setError("github", "repos", new Error(`request failed with token ${secret}`));

    await syncMcpToolsIntoRegistry(registry, source);
    const result = await registry.get("mcp_github_repos")?.execute({}, { cwd: "/tmp" });

    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).not.toContain(secret);
    expect(result?.content[0]?.text).toContain("[REDACTED:MCP_ENV]");
  });

  test("per-server output limit is enforced", async () => {
    const registry = new ToolRegistry();
    const source = new FakeSecureMcpSource({
      tiny: {
        state: "ready",
        security: security("tiny", "safe", { maxOutputBytes: 80 }),
        tools: [{ name: "dump" }],
      },
    });
    source.setResult("tiny", "dump", {
      content: [{ type: "text", text: "A".repeat(200) }],
      isError: false,
    });

    await syncMcpToolsIntoRegistry(registry, source, { maxOutputBytes: 10_000 });
    const result = await registry.get("mcp_tiny_dump")?.execute({}, { cwd: "/tmp" });

    expect(result?.isError).toBe(false);
    expect(result?.content[0]?.text).toContain("[MCP output truncated");
    expect(Buffer.byteLength(result?.content[0]?.text ?? "", "utf-8")).toBeLessThanOrEqual(120);
  });

  test("per-server timeout is forwarded to MCP call", async () => {
    const registry = new ToolRegistry();
    const source = new FakeSecureMcpSource({
      slow: {
        state: "ready",
        security: security("slow", "safe", { timeoutMs: 1234 }),
        tools: [{ name: "wait" }],
      },
    });

    await syncMcpToolsIntoRegistry(registry, source);
    await registry.get("mcp_slow_wait")?.execute({}, { cwd: "/tmp" });

    expect(source.callOptions).toEqual([{ serverId: "slow", toolName: "wait", timeoutMs: 1234 }]);
  });

  test("denied dangerous MCP tool does not execute the tool call", async () => {
    const registry = new ToolRegistry();
    const trustManager = new TrustManager();
    const source = new FakeSecureMcpSource({
      shell: {
        state: "ready",
        security: security("shell", "dangerous"),
        tools: [{ name: "run" }],
      },
    });
    await syncMcpToolsIntoRegistry(registry, source, { trustManager });
    const client = makeClient([makeToolCallResponse("mcp_shell_run", '{"command":"rm -rf dist"}'), makeTextResponse("Denied.")]);
    const session = SessionManager.inMemory("/tmp");
    const loop = new AgentLoop(client, session, registry, "/tmp", {}, trustManager);

    loop.onEvent((event) => {
      if (event.type === "dangerous_confirmation") {
        event.resolve("deny");
      }
    });

    const result = await loop.runTurn("run dangerous mcp");

    expect(source.calls).toEqual([]);
    expect(result.errors.some((error) => error.type === "security_denial")).toBe(true);
    const output = session
      .getBranch()
      .flatMap((entry) => (entry.type === "item" ? [entry.item] : []))
      .find((item) => item.type === "function_call_output");
    expect(output).toMatchObject({
      type: "function_call_output",
      call_id: "call_1",
    });
    expect(output && "output" in output ? output.output : "").toContain("Denied:");
  });
});

type TrustMode = McpServerSecurity["trustMode"];

interface FakeServerState {
  state: McpManagedServerStatus["state"];
  security: McpServerSecurity;
  tools: McpTool[];
  listToolsError?: unknown;
}

class FakeSecureMcpSource {
  readonly calls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }> = [];
  readonly callOptions: Array<{ serverId: string; toolName: string; timeoutMs?: number }> = [];
  private readonly servers = new Map<string, FakeSecureMcpClient>();

  constructor(states: Record<string, FakeServerState>) {
    for (const [serverId, state] of Object.entries(states)) {
      this.servers.set(serverId, new FakeSecureMcpClient(serverId, state, this.calls, this.callOptions));
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
    const client = this.client(serverId);
    return client as unknown as McpClient;
  }

  getServerSecurity(serverId: string): McpServerSecurity {
    return this.client(serverId).security();
  }

  setResult(serverId: string, toolName: string, result: McpToolCallResult): void {
    this.client(serverId).setResult(toolName, result);
  }

  setError(serverId: string, toolName: string, error: unknown): void {
    this.client(serverId).setError(toolName, error);
  }

  private client(serverId: string): FakeSecureMcpClient {
    const client = this.servers.get(serverId);
    if (!client) {
      throw new Error(`Unknown server ${serverId}`);
    }

    return client;
  }
}

class FakeSecureMcpClient {
  private readonly serverId: string;
  private readonly state: FakeServerState;
  private readonly calls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }>;
  private readonly callOptions: Array<{ serverId: string; toolName: string; timeoutMs?: number }>;
  private readonly results = new Map<string, McpToolCallResult>();
  private readonly errors = new Map<string, unknown>();

  constructor(
    serverId: string,
    state: FakeServerState,
    calls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }>,
    callOptions: Array<{ serverId: string; toolName: string; timeoutMs?: number }>,
  ) {
    this.serverId = serverId;
    this.state = state;
    this.calls = calls;
    this.callOptions = callOptions;
  }

  security(): McpServerSecurity {
    return this.state.security;
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
      lastError: null,
      lastErrorCode: null,
      toolsListChanged: false,
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

  async callTool(toolName: string, args: Record<string, unknown>, options: { timeoutMs?: number } = {}): Promise<McpToolCallResult> {
    this.calls.push({ serverId: this.serverId, toolName, args });
    this.callOptions.push({ serverId: this.serverId, toolName, timeoutMs: options.timeoutMs });
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

  setResult(toolName: string, result: McpToolCallResult): void {
    this.results.set(toolName, result);
  }

  setError(toolName: string, error: unknown): void {
    this.errors.set(toolName, error);
  }
}

function security(
  serverId: string,
  trustMode: TrustMode,
  overrides: Partial<Omit<McpServerSecurity, "serverId" | "trustMode">> = {},
): McpServerSecurity {
  return {
    serverId,
    trustMode,
    timeoutMs: overrides.timeoutMs ?? 30_000,
    maxOutputBytes: overrides.maxOutputBytes ?? 64 * 1024,
    env: overrides.env ?? {},
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
