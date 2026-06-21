import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenResponsesClient } from "../../../src/core/client/openresponses-client";
import type { ResponseResource } from "../../../src/core/client/types";
import { AgentLoop } from "../../../src/core/loop/agent-loop";
import { SessionManager } from "../../../src/core/session/session-manager";
import { ToolRegistry } from "../../../src/core/tools/tool-registry";
import type { ToolDefinition, ToolResult } from "../../../src/core/tools/types";

describe("AgentLoop auto-verifier integration", () => {
  test("model cannot finish successfully before Auto-Verifier opportunity", async () => {
    await withFixture(async (cwd) => {
      await writePackageJson(cwd, { scripts: { test: "bun test" } });
      const executedCommands: string[] = [];
      const client = createMockClient([
        makeToolCallResponse("edit", { path: "src/parser.ts" }, "edit_1"),
        makeFinishResponse(),
      ]);
      const tools = new ToolRegistry();
      tools.register(makeTool("edit", "edited"));
      tools.register(makeBashTool(executedCommands));
      const session = SessionManager.inMemory(cwd);
      const loop = new AgentLoop(client, session, tools, cwd);

      const result = await loop.runTurn("Fix bug in parser");

      expect(result.errors).toEqual([]);
      expect(executedCommands).toEqual(["bun test"]);
      expect(result.evidenceSummary?.verificationKinds.has("test")).toBe(true);
      expect(result.evidenceSummary?.needsVerification).toBe(false);
      expect(result.items.some((item) => item.type === "local_shell_call_output")).toBe(true);
    });
  });
});

function makeToolCallResponse(name: string, args: Record<string, unknown>, callId: string): ResponseResource {
  return makeResponse([
    {
      type: "function_call",
      id: `fc_${callId}`,
      call_id: callId,
      name,
      arguments: JSON.stringify(args),
      status: "completed",
    },
  ]);
}

function makeFinishResponse(): ResponseResource {
  return makeToolCallResponse(
    "finish",
    {
      summary: "Parser bug fixed and verified.",
      status: "completed",
      criteria: [{ criterion: "Parser change was verified" }],
    },
    "finish_1",
  );
}

function makeResponse(output: ResponseResource["output"]): ResponseResource {
  return {
    id: `resp_${crypto.randomUUID().slice(0, 8)}`,
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
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
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
    })),
    classifyError: mock(() => "unknown" as const),
    compactNative: mock(async () => {
      throw new Error("compactNative not implemented");
    }),
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

function makeTool(name: string, resultText: string): ToolDefinition<Record<string, unknown>> {
  return {
    name,
    label: name,
    description: `Mock ${name}`,
    parameters: { type: "object", properties: {} },
    toolType: "function",
    async execute(): Promise<ToolResult> {
      return { content: [{ type: "text", text: resultText }], isError: false };
    },
  };
}

function makeBashTool(executedCommands: string[]): ToolDefinition<Record<string, unknown>> {
  return {
    name: "bash",
    label: "bash",
    description: "Mock bash",
    parameters: { type: "object", properties: {} },
    toolType: "function",
    async execute(args): Promise<ToolResult> {
      if (typeof args.command === "string") executedCommands.push(args.command);
      return { content: [{ type: "text", text: "tests passed" }], isError: false };
    },
  };
}

async function withFixture(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "soba-loop-auto-verifier-"));
  try {
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function writePackageJson(cwd: string, packageJson: Record<string, unknown>): Promise<void> {
  await writeFile(join(cwd, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
}
