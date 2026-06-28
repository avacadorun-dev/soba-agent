import { afterEach, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MCP_DRAFT_PROTOCOL_VERSION, MCP_RELEASED_PROTOCOL_VERSION, McpClient, McpClientError } from "../../../src/infrastructure/mcp/client";
import { McpStdioTransport } from "../../../src/infrastructure/mcp/stdio-transport";
import type { McpServerConfig } from "../../../src/infrastructure/mcp/types";

const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/mcp/mock-mcp-server.ts");

interface RunningMockClient {
  client: McpClient;
  transport: McpStdioTransport;
  stderr: string[];
}

const runningClients: RunningMockClient[] = [];

describe("MCP subprocess integration", () => {
  afterEach(async () => {
    await Promise.allSettled(runningClients.map(({ client }) => client.stop({ timeoutMs: 50 })));
    await Promise.allSettled(runningClients.map(({ transport }) => transport.shutdown({ timeoutMs: 50 })));
    runningClients.length = 0;
  });

  test("client discovers modern subprocess fixture", async () => {
    const { client } = await startMockClient();

    expect(client.getState()).toMatchObject({
      state: "ready",
      lifecycle: "modern",
      protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
      serverInfo: { name: "soba-mock-mcp", scenario: "modern" },
    });
  });

  test("client falls back to legacy initialize fixture", async () => {
    const { client } = await startMockClient({ scenario: "legacy" });

    expect(client.getState()).toMatchObject({
      state: "ready",
      lifecycle: "legacy",
      protocolVersion: MCP_RELEASED_PROTOCOL_VERSION,
      serverInfo: { name: "soba-mock-mcp", scenario: "legacy" },
    });
  });

  test("paginated tools/list returns the full tool list", async () => {
    const { client } = await startMockClient({ pageSize: 2 });

    const tools = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["echo", "fail", "slow", "mutate-tools", "crash"]);
  });

  test("tools/call success round-trips structured content", async () => {
    const { client } = await startMockClient();

    await expect(client.callTool("echo", { value: 123 })).resolves.toMatchObject({
      structuredContent: { value: 123 },
      isError: false,
    });
  });

  test("tools/call error is surfaced as controlled request failure", async () => {
    const { client } = await startMockClient();

    await expect(client.callTool("fail")).rejects.toMatchObject({
      name: "McpClientError",
      code: "request_failed",
    });
  });

  test("long tools/call times out without orphaning subprocess", async () => {
    const { client, transport } = await startMockClient({ slowCallMs: 150 });

    await expect(client.callTool("slow", {}, { timeoutMs: 20 })).rejects.toMatchObject({
      name: "McpClientError",
      code: "request_failed",
    });

    expect(transport.pid).toBeGreaterThan(0);
  });

  test("cancellation aborts a long tools/call", async () => {
    const { client } = await startMockClient({ slowCallMs: 150 });
    const controller = new AbortController();

    const result = client.callTool("slow", {}, { signal: controller.signal });
    controller.abort();

    await expect(result).rejects.toMatchObject({
      name: "McpClientError",
      code: "request_failed",
    });
  });

  test("subprocess crash is observed by the client", async () => {
    const { client, stderr } = await startMockClient();

    await expect(client.callTool("crash")).rejects.toBeInstanceOf(McpClientError);
    await waitFor(() => (client.getState().state === "crashed" ? true : undefined));

    expect(client.getState()).toMatchObject({
      state: "crashed",
    });
    expect(stderr.join("")).toContain("intentional crash");
  });

  test("restart scenario is available through a fresh subprocess client", async () => {
    const first = await startMockClient();
    await first.client.stop({ timeoutMs: 50 });

    const second = await startMockClient();

    expect(first.transport.pid).not.toBe(second.transport.pid);
    expect(second.client.getState()).toMatchObject({
      state: "ready",
      lifecycle: "modern",
    });
  });

  test("list-changed notification invalidates client tool cache", async () => {
    const { client } = await startMockClient();

    const before = await client.listTools();
    await client.callTool("mutate-tools");
    await waitFor(() => (client.getState().toolsListChanged ? true : undefined));
    const after = await client.listTools();

    expect(before.map((tool) => tool.name)).not.toContain("dynamic-5");
    expect(after.map((tool) => tool.name)).toContain("dynamic-5");
    expect(client.getState().toolsListChanged).toBe(false);
  });
});

async function startMockClient(
  options: {
    scenario?: "modern" | "legacy";
    pageSize?: number;
    slowCallMs?: number;
  } = {},
): Promise<RunningMockClient> {
  let transport: McpStdioTransport | null = null;
  const stderr: string[] = [];
  const server = testServerConfig(500);
  const client = new McpClient({
    server,
    requestTimeoutMs: 500,
    transportFactory: (onEvent) => {
      transport = new McpStdioTransport({
        command: "bun",
        args: ["run", FIXTURE_PATH],
        env: {
          SOBA_MOCK_MCP_SCENARIO: options.scenario ?? "modern",
          ...(options.pageSize ? { SOBA_MOCK_MCP_PAGE_SIZE: String(options.pageSize) } : {}),
          ...(options.slowCallMs ? { SOBA_MOCK_MCP_SLOW_CALL_MS: String(options.slowCallMs) } : {}),
        },
        shutdownTimeoutMs: 100,
        onMessage: () => undefined,
        onStderr: (chunk) => {
          stderr.push(chunk);
        },
        onEvent,
      });
      return transport;
    },
  });

  await client.start();
  if (!transport) {
    throw new Error("MCP stdio transport was not created.");
  }

  const running = {
    client,
    transport,
    stderr,
  };
  runningClients.push(running);
  return running;
}

function testServerConfig(timeoutMs: number): McpServerConfig {
  return {
    id: "mock",
    name: "Mock MCP",
    transport: "stdio",
    command: "bun",
    args: ["run", FIXTURE_PATH],
    env: {},
    cwd: process.cwd(),
    timeoutMs,
    maxOutputBytes: 1024 * 1024,
    trustMode: "normal",
    enabled: true,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(read: () => T | undefined, timeoutMs = 500): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = read();
    if (value !== undefined) {
      return value;
    }

    await delay(5);
  }

  throw new Error(`Timed out after ${timeoutMs}ms.`);
}
