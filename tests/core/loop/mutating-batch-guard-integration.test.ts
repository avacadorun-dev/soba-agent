import { describe, expect, mock, test } from "bun:test";
import { AgentLoop } from "../../../src/engine/turn/agent-loop";
import type { ProviderErrorKind } from "../../../src/infrastructure/llm/openai/types";
import type { OpenResponsesClient } from "../../../src/infrastructure/llm/openresponses/openresponses-client";
import { SessionManager } from "../../../src/infrastructure/persistence/sessions/session-manager";
import type { ResponseResource } from "../../../src/kernel/model/openresponses-types";
import { ToolRegistry } from "../../../src/kernel/tools/tool-registry";
import type { ToolDefinition, ToolResult } from "../../../src/kernel/tools/types";

describe("Mutating batch guard", () => {
  test("UC-AL-10 cannot edit and run dependent test in one unobserved response", async () => {
    const executed: string[] = [];
    const client = createMockClient([
      makeToolCallGroup([
        makeFunctionCall("edit", { path: "src/cli.ts", edits: [{ oldText: "a", newText: "b" }] }, "edit_bad"),
        makeFunctionCall("bash", { command: "bun test tests/cli" }, "verify_bad"),
      ]),
      makeToolCallGroup([
        makeFunctionCall("edit", { path: "src/cli.ts", edits: [{ oldText: "a", newText: "b" }] }, "edit_ok"),
      ]),
      makeToolCallGroup([makeFunctionCall("bash", { command: "bun test tests/cli" }, "verify_ok")]),
      makeFinishResponse(),
    ]);
    const tools = new ToolRegistry();
    tools.register(makeTool("edit", executed));
    tools.register(makeTool("bash", executed));
    const loop = new AgentLoop(client, SessionManager.inMemory("/test"), tools, "/test");

    const result = await loop.runTurn("Почини ошибку в CLI");
    const outputs = result.items
      .filter((item) => item.type === "function_call_output")
      .map((item) => (typeof item.output === "string" ? item.output : ""));

    expect(executed).toEqual(["edit", "bash"]);
    expect(outputs.some((output) => output.includes("mutating_batch_requires_observation"))).toBe(true);
    expect(result.errors.every((error) => error.status !== "active")).toBe(true);
  });

  test("repeated rejected mutation batch injects loop-guard recovery instruction", async () => {
    const executed: string[] = [];
    const repeatedBatch = makeToolCallGroup([
      makeFunctionCall("edit", { path: "src/cli.ts", edits: [{ oldText: "a", newText: "b" }] }, "edit_bad"),
      makeFunctionCall("bash", { command: "bun test tests/cli" }, "verify_bad"),
    ]);
    const client = createMockClient([
      repeatedBatch,
      repeatedBatch,
      makeToolCallGroup([
        makeFunctionCall("edit", { path: "src/cli.ts", edits: [{ oldText: "a", newText: "b" }] }, "edit_ok"),
      ]),
      makeToolCallGroup([makeFunctionCall("bash", { command: "bun test tests/cli" }, "verify_ok")]),
      makeFinishResponse(),
    ]);
    const tools = new ToolRegistry();
    tools.register(makeTool("edit", executed));
    tools.register(makeTool("bash", executed));
    const loop = new AgentLoop(client, SessionManager.inMemory("/test"), tools, "/test", {
      maxStalledIterations: 4,
      maxStallRecoveryAttempts: 1,
    });

    const result = await loop.runTurn("Почини ошибку в CLI");

    expect(executed).toEqual(["edit", "bash"]);
    expect(
      result.items.some(
        (item) =>
          item.type === "message" &&
          item.role === "user" &&
          item.content.some(
            (content) =>
              content.type === "input_text" &&
              content.text.includes("mutating_batch_requires_observation"),
          ),
      ),
    ).toBe(true);
  });

  test("multiple safe reads can run together", async () => {
    const executed: string[] = [];
    const client = createMockClient([
      makeToolCallGroup([
        makeFunctionCall("read", { path: "a.ts" }, "read_a"),
        makeFunctionCall("inspect_file", { path: "b.ts", startLine: 1, endLine: 5 }, "inspect_b"),
      ]),
      makeFinishResponse(),
    ]);
    const tools = new ToolRegistry();
    tools.register(makeTool("read", executed));
    tools.register(makeTool("inspect_file", executed));
    const loop = new AgentLoop(client, SessionManager.inMemory("/test"), tools, "/test");

    const result = await loop.runTurn("Inspect files");

    expect(executed).toEqual(["read", "inspect_file"]);
    expect(result.errors).toEqual([]);
  });

  test("write followed by unrelated read runs but does not satisfy verification before observation", async () => {
    const executed: string[] = [];
    const client = createMockClient([
      makeToolCallGroup([
        makeFunctionCall("write", { path: "src/generated.ts", content: "export const value = 1;\n" }, "write_1"),
        makeFunctionCall("read", { path: "README.md" }, "read_1"),
      ]),
      makeFinishResponse("finish_rejected"),
      makeToolCallGroup([makeFunctionCall("bash", { command: "bun test tests/generated.test.ts" }, "verify_1")]),
      makeFinishResponse("finish_ok"),
    ]);
    const tools = new ToolRegistry();
    tools.register(makeTool("write", executed));
    tools.register(makeTool("read", executed));
    tools.register(makeTool("bash", executed));
    const loop = new AgentLoop(client, SessionManager.inMemory("/test"), tools, "/test");

    const result = await loop.runTurn("Generate code");
    const outputs = result.items
      .filter((item) => item.type === "function_call_output")
      .map((item) => (typeof item.output === "string" ? item.output : ""));

    expect(executed).toEqual(["write", "read", "bash"]);
    expect(outputs.some((output) => output.includes("Finish rejected by completion gate"))).toBe(true);
    expect(outputs.some((output) => output.includes("Code files changed without accepted command verification"))).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

function makeTool(name: string, executed: string[]): ToolDefinition {
  return {
    name,
    label: name,
    description: `Mock ${name}`,
    parameters: { type: "object", properties: {} },
    toolType: "function",
    async execute(): Promise<ToolResult> {
      executed.push(name);
      return { content: [{ type: "text", text: `${name} ok` }], isError: false };
    },
  };
}

function createMockClient(responses: ResponseResource[]): OpenResponsesClient {
  let index = 0;
  return {
    create: mock(async () => {
      const response = responses[index];
      index += 1;
      if (!response) throw new Error("No mock response left");
      return response;
    }),
    createStream: mock(async function* () {}),
    compact: mock(async () => ({
      id: "comp_test",
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
    getProviderIdentity: mock(() => ({
      adapterId: "test",
      endpointOrigin: "https://test.example",
      model: "test-model",
    })),
    getProviderCapabilities: mock(() => ({
      nativeCompaction: false,
      structuredOutput: true,
      developerMessages: false,
      continuationCompatibilityKey: "test::https://test.example::test-model",
    })),
    classifyError: mock((): ProviderErrorKind => "unknown"),
    compactNative: mock(async () => ({
      provider: {
        adapterId: "test",
        endpointOrigin: "https://test.example",
        model: "test-model",
      },
      compatibilityKey: "test-key",
      items: [],
    })),
    getConfig: mock(() => ({
      baseUrl: "https://test.example",
      apiKey: "test-key",
      model: "test-model",
      maxOutputTokens: 4096,
      maxCompletionTokens: 0,
      contextWindow: 128000,
      temperature: 0.7,
    })),
    updateConfig: mock(() => {}),
  };
}

function makeToolCallGroup(output: ResponseResource["output"]): ResponseResource {
  return makeResponse(output, `resp_${Math.random().toString(36).slice(2)}`);
}

function makeFunctionCall(name: string, args: Record<string, unknown>, callId: string): ResponseResource["output"][number] {
  return {
    type: "function_call",
    id: `fc_${callId}`,
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
    status: "completed",
  };
}

function makeFinishResponse(callId = "finish_call"): ResponseResource {
  return makeToolCallGroup([
    makeFunctionCall(
      "finish",
      {
        summary: "Done and verified.",
        status: "completed",
        criteria: [{ criterion: "Work completed with evidence" }],
      },
      callId,
    ),
  ]);
}

function makeResponse(output: ResponseResource["output"], id: string): ResponseResource {
  return {
    id,
    object: "response",
    created_at: 1,
    completed_at: 2,
    status: "completed",
    incomplete_details: null,
    model: "test-model",
    previous_response_id: null,
    instructions: null,
    output,
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
    usage: null,
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
