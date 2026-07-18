import { describe, expect, mock, test } from "bun:test";
import type { ContextManager } from "../../../src/engine/compaction/context-manager";
import type { ContextSnapshot } from "../../../src/engine/compaction/context-meter";
import type { BackgroundScheduler } from "../../../src/engine/compaction/scheduler";
import { AgentLoop } from "../../../src/engine/turn/agent-loop";
import type { OpenResponsesClient } from "../../../src/infrastructure/llm/openresponses/openresponses-client";
import { SessionManager } from "../../../src/infrastructure/persistence/sessions/session-manager";
import { checkpointTool } from "../../../src/infrastructure/tools/local/checkpoint";
import type { ResponseResource } from "../../../src/kernel/model/openresponses-types";
import { ToolRegistry } from "../../../src/kernel/tools/tool-registry";

describe("AgentLoop checkpoint integration", () => {
  test("successful checkpoint output creates ledger evidence and plan_pivot updates work plan state", async () => {
    const client = createMockClient([
      makeToolCallResponse("checkpoint", {
        kind: "plan_pivot",
        reason: "Parser API is too broad",
        nextDirection: "Split parser IO from validation",
        completed: ["Inspected parser entrypoint"],
        pending: ["Extract validation module"],
      }, "checkpoint_1"),
      makeFinishResponse(),
    ]);
    const tools = new ToolRegistry();
    tools.register(checkpointTool);
    const loop = new AgentLoop(client, SessionManager.inMemory("/tmp/soba-checkpoint"), tools, "/tmp/soba-checkpoint");

    const result = await loop.runTurn("Continue the parser refactor");

    expect(result.errors).toEqual([]);
    expect(result.checkpointState).toEqual({
      lastKind: "plan_pivot",
      reason: "Parser API is too broad",
      nextDirection: "Split parser IO from validation",
      completed: ["Inspected parser entrypoint"],
      pending: ["Extract validation module"],
      updatedAt: expect.any(String),
    });
    const checkpointEvidence = result.evidenceSummary?.entries.find((entry) => entry.kind === "checkpoint");
    expect(checkpointEvidence?.checkpointKind).toBe("plan_pivot");
    expect(checkpointEvidence?.nextDirection).toBe("Split parser IO from validation");
    expect(checkpointEvidence?.summary).toContain("Parser API is too broad");
  });

  test("milestone checkpoint is compacted at the next preflight without background scheduler", async () => {
    const client = createMockClient([
      makeToolCallResponse("checkpoint", {
        kind: "milestone",
        reason: "Task implementation completed",
        completed: ["Added command detector"],
        pending: ["Run verification"],
      }, "checkpoint_1"),
      makeFinishResponse(),
    ]);
    const tools = new ToolRegistry();
    tools.register(checkpointTool);
    const contextManager = makeFakeContextManager(true);
    const scheduler = makeFakeScheduler();
    const loop = new AgentLoop(
      client,
      SessionManager.inMemory("/tmp/soba-checkpoint"),
      tools,
      "/tmp/soba-checkpoint",
      undefined,
      undefined,
      undefined,
      contextManager,
      scheduler,
    );

    const result = await loop.runTurn("Continue the phase task");

    expect(result.errors).toEqual([]);
    expect(scheduler.schedule).not.toHaveBeenCalled();
    expect(contextManager.executePlan).toHaveBeenCalledTimes(1);
    expect((contextManager.createPlan as ReturnType<typeof mock>).mock.calls[0]?.[0]).toMatchObject({ trigger: "milestone" });
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
      summary: "Checkpoint task state recorded.",
      status: "completed",
      criteria: [{ criterion: "Checkpoint state was recorded" }],
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

function makeFakeContextManager(shouldCompactMilestone: boolean): ContextManager {
  const policy = {
    evaluateHardLimit: mock(() => ({ shouldCompact: false, trigger: null, reason: "ok", estimatedReclaimableTokens: 0, estimatedSavingsRatio: 0 })),
    evaluateAutoThreshold: mock(() => ({ shouldCompact: false, trigger: null, reason: "below", estimatedReclaimableTokens: 0, estimatedSavingsRatio: 0 })),
    evaluateMilestone: mock(() => ({ shouldCompact: shouldCompactMilestone, trigger: shouldCompactMilestone ? "milestone" : null, reason: "checkpoint", estimatedReclaimableTokens: 20_000, estimatedSavingsRatio: 0.5 })),
    evaluateTurnComplete: mock(() => ({ shouldCompact: false, trigger: null, reason: "below", estimatedReclaimableTokens: 0, estimatedSavingsRatio: 0 })),
    evaluateContextOverflow: mock(() => ({ shouldCompact: true, trigger: "context_overflow", reason: "overflow", estimatedReclaimableTokens: 20_000, estimatedSavingsRatio: 0.5 })),
    getSoftLimit: mock(() => 80_000),
  };
  return {
    recordProviderUsage: mock(() => {}),
    getSnapshot: mock(() => makeSnapshot()),
    getPolicy: mock(() => policy),
    createPlan: mock((input) => ({ ...input, operationId: "op_checkpoint", expectedLeafId: "leaf" })),
    executePlan: mock(async () => ({
      status: "completed", trigger: "milestone", strategy: "deterministic", quality: "degraded",
      checkpointId: "ctx_1", metrics: { effectiveTokensBefore: 40_000, estimatedTokensAfter: 20_000,
        reclaimedTokens: 20_000, savingsRatio: 0.5, generationDurationMs: 1 }, validation: null,
      reason: "completed", operationId: "op_checkpoint", durationMs: 1, required: false,
    })),
  } as unknown as ContextManager;
}

function makeFakeScheduler(): BackgroundScheduler {
  return {
    isRunning: mock(() => false),
    cancel: mock(() => {}),
    schedule: mock(() => {}),
  } as unknown as BackgroundScheduler;
}

function makeSnapshot(): ContextSnapshot {
  return {
    source: "estimated",
    providerInputTokens: 0,
    estimatedTrailingTokens: 40_000,
    effectiveTokens: 40_000,
    historicalTokens: 40_000,
    systemPromptTokens: 1_000,
    toolSchemaTokens: 100,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    safetyReserveTokens: 8_192,
    hardLimit: 103_424,
  };
}
