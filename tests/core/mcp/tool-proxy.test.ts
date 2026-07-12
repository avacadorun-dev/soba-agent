import { describe, expect, test } from "bun:test";
import type { McpClient, McpTool, McpToolCallResult } from "../../../src/infrastructure/mcp/client";
import {
  buildMcpToolDefinitions,
  inferMcpToolSemantics,
  mapMcpInputSchema,
  normalizeMcpToolResult,
  proxyToolName,
} from "../../../src/infrastructure/mcp/tool-proxy";
import type { ToolDefinition } from "../../../src/kernel/tools/types";

describe("MCP tool proxy", () => {
  test("derives effects from MCP annotations without tool-name heuristics", () => {
    expect(inferMcpToolSemantics({ readOnlyHint: true })).toEqual({
      effects: ["inspect"],
      parallelSafe: true,
      restrictedMode: "allow",
    });
    expect(inferMcpToolSemantics({ destructiveHint: true }).effects).toEqual(["mutation"]);
    expect(inferMcpToolSemantics(undefined).restrictedMode).toBe("deny");
  });

  test("proxy exposes expected names", async () => {
    const source = new FakeProxySource({
      alpha: [{ name: "echo", description: "Echo input" }],
      beta: [{ name: "search" }],
    });

    const tools = await buildMcpToolDefinitions(source);

    expect(tools.map((tool) => tool.name)).toEqual(["mcp_alpha_echo", "mcp_beta_search"]);
    expect(tools.map((tool) => tool.label)).toEqual(["mcp.alpha.echo", "mcp.beta.search"]);
    expect(tools.map((tool) => tool.toolType)).toEqual(["function", "function"]);
  });

  test("schema mapping for simple object schema", () => {
    const schema = mapMcpInputSchema({
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "integer" },
        exact: { type: "boolean" },
      },
      required: ["query"],
      additionalProperties: false,
    });

    expect(schema).toEqual({
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number" },
        exact: { type: "boolean" },
      },
      required: ["query"],
      additionalProperties: false,
    });
  });

  test("schema mapping for unsupported or unknown schema degrades safely", () => {
    expect(mapMcpInputSchema({ type: "string" })).toEqual({
      type: "object",
      properties: {},
      additionalProperties: true,
    });
    expect(
      mapMcpInputSchema({
        type: "object",
        properties: {
          unknown: { type: "null" },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        unknown: {
          type: "object",
          properties: {},
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    });
  });

  test("successful tool call is normalized", async () => {
    const source = new FakeProxySource({
      alpha: [{ name: "echo", inputSchema: { type: "object", properties: { value: { type: "number" } } } }],
    });
    source.setResult("alpha", "echo", {
      content: [{ type: "text", text: "ok" }],
      structuredContent: { value: 1 },
      resultType: "structured",
      ttlMs: 100,
      cacheScope: "session",
      isError: false,
    });
    const [tool] = await buildMcpToolDefinitions(source);

    const result = await execute(tool, { value: 1 });

    expect(result).toMatchObject({
      isError: false,
      content: [{ type: "text", text: 'ok\n{\n  "value": 1\n}' }],
      details: {
        mcp: {
          isError: false,
          resultType: "structured",
          ttlMs: 100,
          cacheScope: "session",
          structuredContent: { value: 1 },
          truncated: false,
        },
      },
    });
    expect(source.calls).toEqual([{ serverId: "alpha", toolName: "echo", args: { value: 1 } }]);
  });

  test("error tool call is normalized and preserves machine-readable information", async () => {
    const source = new FakeProxySource({
      alpha: [{ name: "fail" }],
    });
    source.setResult("alpha", "fail", {
      content: [{ type: "text", text: "tool failed" }],
      isError: true,
      structuredContent: { code: "bad_input" },
    });
    const [tool] = await buildMcpToolDefinitions(source);

    const result = await execute(tool);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("tool failed");
    expect(result.details).toMatchObject({
      mcp: {
        isError: true,
        structuredContent: { code: "bad_input" },
      },
    });
  });

  test("client call exception is normalized as controlled error", async () => {
    const source = new FakeProxySource({
      alpha: [{ name: "fail" }],
    });
    source.setError("alpha", "fail", Object.assign(new Error("boom"), { code: "request_failed" }));
    const [tool] = await buildMcpToolDefinitions(source);

    const result = await execute(tool);
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(result.isError).toBe(true);
    expect(payload).toEqual({
      error: {
        name: "Error",
        message: "boom",
        code: "request_failed",
        serverId: "alpha",
        toolName: "fail",
        proxyName: "mcp_alpha_fail",
      },
    });
    expect(result.details).toEqual(payload);
  });

  test("large output is truncated with marker", () => {
    const result = normalizeMcpToolResult(
      {
        content: [{ type: "text", text: "A".repeat(200) }],
        isError: false,
      },
      { maxOutputBytes: 80 },
    );

    expect(result.isError).toBe(false);
    expect(Buffer.byteLength(result.content[0]?.text ?? "", "utf-8")).toBeLessThanOrEqual(120);
    expect(result.content[0]?.text).toContain("[MCP output truncated");
    expect(result.details).toMatchObject({
      mcp: {
        truncated: true,
        originalBytes: 200,
      },
    });
  });

  test("server/tool name collision handling is deterministic", async () => {
    const source = new FakeProxySource({
      "a.b": [{ name: "c" }],
      a: [{ name: "b.c" }],
    });

    const first = await buildMcpToolDefinitions(source);
    const second = await buildMcpToolDefinitions(source);

    expect(first.map((tool) => tool.name)).toHaveLength(2);
    expect(new Set(first.map((tool) => tool.name)).size).toBe(2);
    expect(first[0]?.name).toBe(proxyToolName("a.b", "c"));
    expect(first[1]?.name).toMatch(/^mcp_a_b_c__[a-f0-9]{8}$/);
    expect(second.map((tool) => tool.name)).toEqual(first.map((tool) => tool.name));
  });
});

class FakeProxySource {
  readonly calls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }> = [];
  private readonly clients = new Map<string, FakeMcpClient>();

  constructor(toolsByServer: Record<string, McpTool[]>) {
    for (const [serverId, tools] of Object.entries(toolsByServer)) {
      this.clients.set(serverId, new FakeMcpClient(serverId, tools, this.calls));
    }
  }

  getServerIds(): string[] {
    return [...this.clients.keys()];
  }

  async getClient(serverId: string): Promise<McpClient> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Unknown server: ${serverId}`);
    }

    return client as unknown as McpClient;
  }

  setResult(serverId: string, toolName: string, result: McpToolCallResult): void {
    this.client(serverId).setResult(toolName, result);
  }

  setError(serverId: string, toolName: string, error: unknown): void {
    this.client(serverId).setError(toolName, error);
  }

  private client(serverId: string): FakeMcpClient {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Unknown server: ${serverId}`);
    }

    return client;
  }
}

class FakeMcpClient {
  private readonly serverId: string;
  private readonly tools: McpTool[];
  private readonly calls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }>;
  private readonly results = new Map<string, McpToolCallResult>();
  private readonly errors = new Map<string, unknown>();

  constructor(
    serverId: string,
    tools: McpTool[],
    calls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }>,
  ) {
    this.serverId = serverId;
    this.tools = tools;
    this.calls = calls;
  }

  async listTools(): Promise<McpTool[]> {
    return this.tools;
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    this.calls.push({ serverId: this.serverId, toolName, args });
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

async function execute(tool: ToolDefinition<Record<string, unknown>> | undefined, args: Record<string, unknown> = {}) {
  if (!tool) {
    throw new Error("Expected tool definition.");
  }

  return tool.execute(args, { cwd: "/tmp" });
}
