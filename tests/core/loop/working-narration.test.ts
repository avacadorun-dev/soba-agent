import { describe, expect, mock, test } from "bun:test";
import { evaluateCompletion } from "../../../src/engine/completion/completion-gate";
import { AgentLoop } from "../../../src/engine/turn/agent-loop";
import {
  createWorkingNarration,
  sanitizeWorkingNarrationMessage,
} from "../../../src/engine/turn/narration";
import type { AgentEvent } from "../../../src/engine/turn/types";
import type { ProviderErrorKind } from "../../../src/infrastructure/llm/openai/types";
import type { OpenResponsesClient } from "../../../src/infrastructure/llm/openresponses/openresponses-client";
import { SessionManager } from "../../../src/infrastructure/persistence/sessions/session-manager";
import type { ResponseResource } from "../../../src/kernel/model/openresponses-types";
import { ToolRegistry } from "../../../src/kernel/tools/tool-registry";
import type { ToolDefinition, ToolResult } from "../../../src/kernel/tools/types";

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

function makeToolCallResponse(name: string, args: Record<string, unknown>, callId: string): ResponseResource {
  return makeResponse(
    [
      {
        type: "function_call",
        id: `fc_${callId}`,
        call_id: callId,
        name,
        arguments: JSON.stringify(args),
        status: "completed",
      },
    ],
    `resp_${callId}`,
  );
}

function makeFinishResponse(callId = "finish_call"): ResponseResource {
  return makeToolCallResponse(
    "finish",
    {
      summary: "Roadmap docs updated and verified.",
      status: "completed",
      criteria: [{ criterion: "Docs changes were verified" }],
    },
    callId,
  );
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

function makeTool(name: string, resultText: string): ToolDefinition {
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

describe("Working Narration", () => {
  test("docs roadmap task emits typed narration around context, mutation, verification and completion", async () => {
    const client = createMockClient([
      makeToolCallResponse("edit", { path: "docs/roadmap.md" }, "edit_1"),
      makeToolCallResponse("bash", { command: "bun test tests/evals/agent-loop" }, "verify_1"),
      makeFinishResponse(),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeTool("edit", "edited docs"));
    tools.register(makeTool("bash", "tests passed"));
    const loop = new AgentLoop(client, session, tools, "/test", { emitEvents: true });
    const events: AgentEvent[] = [];
    loop.onEvent((event) => events.push(event));

    await loop.runTurn("Обнови дорожную карту и выведи её на отдельную страницу доков");

    const narration = events.filter((event): event is Extract<AgentEvent, { type: "working_narration" }> => {
      return event.type === "working_narration";
    });
    expect(narration.map((event) => event.eventType)).toEqual([
      "context_scan",
      "observation",
      "plan",
      "edit_intent",
      "verification",
      "completion",
    ]);
    expect(narration.find((event) => event.eventType === "verification")?.evidenceIds).toEqual(["verify_1"]);
  });

  test("does not narrate package installation as verification evidence", async () => {
    const client = createMockClient([
      makeToolCallResponse("edit", { path: "src/app.ts" }, "edit_1"),
      makeToolCallResponse("bash", { command: "bun install" }, "install_1"),
      makeToolCallResponse("bash", { command: "bun test" }, "verify_1"),
      makeFinishResponse(),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeTool("edit", "edited app"));
    tools.register(makeTool("bash", "command passed"));
    const loop = new AgentLoop(client, session, tools, "/test", { emitEvents: true });
    const events: AgentEvent[] = [];
    loop.onEvent((event) => events.push(event));

    await loop.runTurn("Создай с нуля TypeScript/Bun CLI-проект");

    const narration = events.filter((event): event is Extract<AgentEvent, { type: "working_narration" }> => {
      return event.type === "working_narration";
    });
    const verification = narration.find((event) => event.eventType === "verification");

    expect(verification?.evidenceIds).toEqual(["verify_1"]);
    expect(verification?.message).toContain("project verification command");
    expect(verification?.evidenceIds).not.toContain("install_1");
  });

  test("sanitizes private reasoning, prompt text and secrets from narration", () => {
    expect(sanitizeWorkingNarrationMessage("my chain of thought is hidden")).toContain("redacted");
    expect(sanitizeWorkingNarrationMessage("system prompt says do X")).toContain("redacted");
    expect(sanitizeWorkingNarrationMessage("api_key fake-secret123456789")).toContain("redacted");
  });

  test("narration can carry evidence references but does not count as verification evidence", () => {
    const narration = createWorkingNarration({
      eventType: "verification",
      message: "Verification evidence is available.",
      evidenceIds: ["verify_1"],
    });
    const decision = evaluateCompletion(
      {
        summary: "Done",
        status: "completed",
        criteria: [{ criterion: "Mutation verified" }],
        acknowledgedErrorIds: [],
      },
      {
        errors: [],
        successfulToolCallIds: new Set(narration.evidenceIds),
        verificationEvidenceCallIds: new Set(),
        needsVerification: true,
        hasUsedTools: true,
        hasMutatedFiles: true,
      },
    );

    expect(decision.accepted).toBe(false);
    if (!decision.accepted) {
      expect(decision.reasons).toContain("Project files changed after the latest successful verification.");
      expect(decision.reasons).toContain(
        "A completed outcome after file changes requires evidence from a verification call after the latest change.",
      );
    }
  });
});
