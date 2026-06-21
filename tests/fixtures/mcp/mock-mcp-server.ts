import { MCP_DRAFT_PROTOCOL_VERSION, MCP_RELEASED_PROTOCOL_VERSION } from "../../../src/core/mcp/client";
import { JSON_RPC_ERROR_CODES, JSON_RPC_VERSION, type JsonRpcId, type JsonRpcRequest } from "../../../src/core/mcp/json-rpc";

type Scenario = "modern" | "legacy";

interface MockTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

const scenario = parseScenario(process.env.SOBA_MOCK_MCP_SCENARIO);
const pageSize = parsePositiveInt(process.env.SOBA_MOCK_MCP_PAGE_SIZE);
const slowCallDelayMs = parsePositiveInt(process.env.SOBA_MOCK_MCP_SLOW_CALL_MS) ?? 200;

const tools: MockTool[] = [
  { name: "echo", description: "Echoes arguments.", inputSchema: { type: "object" } },
  { name: "fail", description: "Returns a JSON-RPC tool error." },
  { name: "slow", description: "Responds after a configurable delay." },
  { name: "mutate-tools", description: "Adds a tool and emits list_changed." },
  { name: "crash", description: "Terminates the process with exit code 42." },
];

let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  void drainBuffer();
});

process.stdin.on("end", () => {
  process.exit(0);
});

async function drainBuffer(): Promise<void> {
  while (true) {
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex === -1) {
      return;
    }

    const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
    buffer = buffer.slice(newlineIndex + 1);
    if (line.length === 0) {
      continue;
    }

    await handleLine(line);
  }
}

async function handleLine(line: string): Promise<void> {
  let request: unknown;
  try {
    request = JSON.parse(line) as unknown;
  } catch {
    writeError(null, JSON_RPC_ERROR_CODES.parseError, "Invalid JSON.");
    return;
  }

  if (!isJsonRpcRequest(request)) {
    return;
  }

  await handleRequest(request);
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  switch (request.method) {
    case "server/discover":
      handleDiscover(request);
      return;
    case "initialize":
      writeResult(request.id, {
        protocolVersion: MCP_RELEASED_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "soba-mock-mcp", scenario },
      });
      return;
    case "tools/list":
      handleToolsList(request);
      return;
    case "tools/call":
      await handleToolsCall(request);
      return;
    default:
      writeError(request.id, JSON_RPC_ERROR_CODES.methodNotFound, `Method not found: ${request.method}.`);
  }
}

function handleDiscover(request: JsonRpcRequest): void {
  if (scenario === "legacy") {
    writeError(request.id, JSON_RPC_ERROR_CODES.methodNotFound, "server/discover is not supported.");
    return;
  }

  writeResult(request.id, {
    protocolVersions: [MCP_DRAFT_PROTOCOL_VERSION, MCP_RELEASED_PROTOCOL_VERSION],
    capabilities: { tools: { listChanged: true } },
    serverInfo: { name: "soba-mock-mcp", scenario },
  });
}

function handleToolsList(request: JsonRpcRequest): void {
  const cursor = isRecord(request.params) && typeof request.params.cursor === "string" ? Number.parseInt(request.params.cursor, 10) : 0;
  if (!pageSize) {
    writeResult(request.id, { tools });
    return;
  }

  const start = Number.isFinite(cursor) && cursor > 0 ? cursor : 0;
  const page = tools.slice(start, start + pageSize);
  const nextCursor = start + pageSize < tools.length ? String(start + pageSize) : undefined;

  writeResult(request.id, {
    tools: page,
    ...(nextCursor ? { nextCursor } : {}),
  });
}

async function handleToolsCall(request: JsonRpcRequest): Promise<void> {
  const params = isRecord(request.params) ? request.params : {};
  const name = typeof params.name === "string" ? params.name : "";
  const args = isRecord(params.arguments) ? params.arguments : {};

  switch (name) {
    case "echo":
      writeResult(request.id, {
        content: [{ type: "text", text: JSON.stringify(args) }],
        structuredContent: args,
        isError: false,
      });
      return;
    case "fail":
      writeError(request.id, JSON_RPC_ERROR_CODES.internalError, "Mock tool failed.");
      return;
    case "slow":
      await delay(slowCallDelayMs);
      writeResult(request.id, {
        content: [{ type: "text", text: "slow-ok" }],
        isError: false,
      });
      return;
    case "mutate-tools":
      tools.push({ name: `dynamic-${tools.length}`, description: "Added during test." });
      writeNotification("notifications/tools/list_changed");
      writeResult(request.id, {
        content: [{ type: "text", text: "mutated" }],
        isError: false,
      });
      return;
    case "crash":
      process.stderr.write("mock-mcp-server: intentional crash\n");
      process.exit(42);
      return;
    default:
      writeError(request.id, JSON_RPC_ERROR_CODES.invalidParams, `Unknown mock tool: ${name}.`);
  }
}

function writeResult(id: JsonRpcId, result: unknown): void {
  writeMessage({
    jsonrpc: JSON_RPC_VERSION,
    id,
    result,
  });
}

function writeError(id: JsonRpcId | null, code: number, message: string): void {
  writeMessage({
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: {
      code,
      message,
    },
  });
}

function writeNotification(method: string): void {
  writeMessage({
    jsonrpc: JSON_RPC_VERSION,
    method,
  });
}

function writeMessage(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function parseScenario(value: string | undefined): Scenario {
  return value === "legacy" ? "legacy" : "modern";
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return isRecord(value) && value.jsonrpc === JSON_RPC_VERSION && typeof value.method === "string" && ("id" in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
