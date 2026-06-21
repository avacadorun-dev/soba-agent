import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSON_RPC_VERSION } from "../../../src/core/mcp/json-rpc";
import { McpStdioTransport, McpStdioTransportError } from "../../../src/core/mcp/stdio-transport";
import type { McpTransportEvent } from "../../../src/core/mcp/transport";

const ECHO_SERVER = String.raw`
process.stdin.setEncoding("utf8");

let buffer = "";
process.stderr.write("mock-server: ready\n");

process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const index = buffer.indexOf("\n");
    if (index === -1) {
      break;
    }

    const line = buffer.slice(0, index).replace(/\r$/, "");
    buffer = buffer.slice(index + 1);
    if (line.length === 0) {
      continue;
    }

    const message = JSON.parse(line);
    process.stderr.write("mock-server: " + message.method + "\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        method: message.method,
        params: message.params ?? null
      }
    }) + "\n");
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});
`;

const STUBBORN_SERVER = String.raw`
process.stdin.resume();
setInterval(() => {}, 1000);
`;

const CRASH_SERVER = String.raw`
process.stderr.write("crashing now\n");
process.exit(42);
`;

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

describe("MCP stdio transport", () => {
  let tempDir: string;
  const transports: McpStdioTransport[] = [];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "soba-mcp-stdio-"));
  });

  afterEach(async () => {
    await Promise.allSettled(transports.map((transport) => transport.shutdown({ timeoutMs: 20 })));
    transports.length = 0;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("starts mock process", async () => {
    const scriptPath = await writeScript("echo-server.ts", ECHO_SERVER);
    const transport = createTransport(scriptPath);

    transport.start();

    expect(transport.pid).toBeGreaterThan(0);
    expect(transport.status).toBe("running");
  });

  test("sends JSON-RPC message and receives stdout-framed response", async () => {
    const scriptPath = await writeScript("echo-server.ts", ECHO_SERVER);
    const messages: string[] = [];
    const transport = createTransport(scriptPath, { messages });
    transport.start();

    await transport.send({
      jsonrpc: JSON_RPC_VERSION,
      id: 1,
      method: "tools/list",
      params: { cursor: "next" },
    });

    const response = await waitFor(() => messages[0]);
    expect(JSON.parse(response)).toEqual({
      jsonrpc: JSON_RPC_VERSION,
      id: 1,
      result: {
        method: "tools/list",
        params: { cursor: "next" },
      },
    });
  });

  test("stderr is isolated from protocol message stream", async () => {
    const scriptPath = await writeScript("echo-server.ts", ECHO_SERVER);
    const messages: string[] = [];
    const stderr: string[] = [];
    const transport = createTransport(scriptPath, { messages, stderr });
    transport.start();

    await transport.send({
      jsonrpc: JSON_RPC_VERSION,
      id: "stderr-check",
      method: "tools/call",
    });

    await waitFor(() => messages[0]);
    await waitFor(() => (stderr.join("").includes("mock-server: tools/call") ? stderr.join("") : undefined));

    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain("mock-server");
    expect(stderr.join("")).toContain("mock-server: ready");
    expect(stderr.join("")).toContain("mock-server: tools/call");
  });

  test("emits typed message log and state events", async () => {
    const scriptPath = await writeScript("echo-server.ts", ECHO_SERVER);
    const events: McpTransportEvent[] = [];
    const transport = createTransport(scriptPath, { events });
    transport.start();

    await transport.send({
      jsonrpc: JSON_RPC_VERSION,
      id: "events",
      method: "tools/list",
    });

    await waitFor(() => events.find((event) => event.type === "message"));
    await waitFor(() => events.find((event) => event.type === "log"));

    expect(events).toContainEqual({ type: "state", state: "running" });
    expect(events.some((event) => event.type === "message")).toBe(true);
    expect(events.some((event) => event.type === "log" && event.message.includes("mock-server"))).toBe(true);
  });

  test("graceful shutdown exits process without forced kill", async () => {
    const scriptPath = await writeScript("echo-server.ts", ECHO_SERVER);
    const transport = createTransport(scriptPath);
    transport.start();

    const exit = await transport.shutdown({ timeoutMs: 200 });

    expect(exit).toEqual({
      code: 0,
      forced: false,
    });
    expect(transport.status).toBe("closed");
  });

  test("close is idempotent and aliases shutdown", async () => {
    const scriptPath = await writeScript("echo-server.ts", ECHO_SERVER);
    const transport = createTransport(scriptPath);
    transport.start();

    const first = await transport.close({ timeoutMs: 200 });
    const second = await transport.close({ timeoutMs: 200 });

    expect(first).toEqual({
      code: 0,
      forced: false,
    });
    expect(second).toEqual({
      code: 0,
      forced: false,
    });
    expect(transport.status).toBe("closed");
  });

  test("shutdown timeout forces process kill", async () => {
    const scriptPath = await writeScript("stubborn-server.ts", STUBBORN_SERVER);
    const transport = createTransport(scriptPath);
    transport.start();

    const exit = await transport.shutdown({ timeoutMs: 10 });

    expect(exit.forced).toBe(true);
    expect(transport.status).toBe("closed");
  });

  test("abort during shutdown kills process and rejects with controlled error", async () => {
    const scriptPath = await writeScript("stubborn-server.ts", STUBBORN_SERVER);
    const controller = new AbortController();
    const transport = createTransport(scriptPath);
    transport.start();

    setTimeout(() => controller.abort(), 10);

    await expect(transport.shutdown({ signal: controller.signal, timeoutMs: 500 })).rejects.toMatchObject({
      name: "McpTransportError",
      code: "aborted",
      kind: "stdio",
    });
    expect((await transport.waitForExit()).forced).toBe(true);
    expect(transport.status).toBe("closed");
  });

  test("process crash surfaces controlled error", async () => {
    const scriptPath = await writeScript("crash-server.ts", CRASH_SERVER);
    const errors: McpStdioTransportError[] = [];
    const stderr: string[] = [];
    const transport = createTransport(scriptPath, { errors, stderr });

    transport.start();
    const exit = await transport.waitForExit();

    expect(exit.code).toBe(42);
    expect(stderr.join("")).toContain("crashing now");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: "process_exit",
      exitCode: 42,
    });
  });

  test("spawn failure throws controlled error", () => {
    const transport = new McpStdioTransport({
      command: "/definitely/not/a/real/mcp-server",
      onMessage: () => undefined,
    });

    expect(() => transport.start()).toThrow(McpStdioTransportError);
    expect(() => transport.start()).toThrow("Failed to start MCP stdio process");
  });

  test("send with aborted signal rejects before writing", async () => {
    const scriptPath = await writeScript("echo-server.ts", ECHO_SERVER);
    const messages: string[] = [];
    const controller = new AbortController();
    const transport = createTransport(scriptPath, { messages });
    transport.start();
    controller.abort();

    await expect(
      transport.send(
        {
          jsonrpc: JSON_RPC_VERSION,
          id: 1,
          method: "tools/list",
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      code: "aborted",
    });
    expect(messages).toEqual([]);
  });

  test("diagnostics include transport kind without leaking env values", () => {
    const secret = "secret_from_env";
    const transport = new McpStdioTransport({
      command: "bun",
      env: {
        MCP_TOKEN: secret,
      },
      onMessage: () => undefined,
    });

    const diagnosticsJson = JSON.stringify(transport.diagnostics());
    expect(transport.diagnostics()).toMatchObject({
      kind: "stdio",
      state: "idle",
    });
    expect(diagnosticsJson).not.toContain(secret);
    expect(diagnosticsJson).not.toContain("MCP_TOKEN");
  });

  async function writeScript(name: string, source: string): Promise<string> {
    const path = join(tempDir, name);
    await Bun.write(path, source);
    return path;
  }

  function createTransport(
    scriptPath: string,
    captures: {
      messages?: string[];
      stderr?: string[];
      errors?: McpStdioTransportError[];
      events?: McpTransportEvent[];
    } = {},
  ): McpStdioTransport {
    const transport = new McpStdioTransport({
      command: "bun",
      args: ["run", scriptPath],
      cwd: tempDir,
      shutdownTimeoutMs: 100,
      onMessage: (message) => {
        captures.messages?.push(message);
      },
      onStderr: (chunk) => {
        captures.stderr?.push(chunk);
      },
      onError: (error) => {
        captures.errors?.push(error);
      },
      onEvent: (event) => {
        captures.events?.push(event);
      },
    });
    transports.push(transport);
    return transport;
  }
});
