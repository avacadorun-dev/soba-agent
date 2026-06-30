import { describe, expect, mock, test } from "bun:test";
import type { ContextManager, PreInferenceCheckResult } from "../../../src/engine/compaction/context-manager";
import type { ContextSnapshot } from "../../../src/engine/compaction/context-meter";
import type { BackgroundScheduler } from "../../../src/engine/compaction/scheduler";
import { ContextController } from "../../../src/engine/context/context-controller";
import type { AgentEvent } from "../../../src/engine/turn/types";
import type { ResponseResource } from "../../../src/kernel/model/openresponses-types";

describe("ContextController", () => {
  test("pre-inference check emits compaction events and returns manager result", async () => {
    const events: AgentEvent[] = [];
    const outcome = makeCompactionOutcome();
    const manager = makeContextManager({
      preInferenceCheck: mock(async () => ({
        canProceed: true,
        compactionPerformed: true,
        outcome,
      })),
    });
    const controller = new ContextController({
      contextManager: manager,
      emit: (event) => events.push(event),
    });

    const result = await controller.performPreInferenceCheck(makeMetrics("pre"));

    expect(result.canProceed).toBe(true);
    expect(events.map((event) => event.type)).toEqual(["compaction_start", "compaction_done"]);
    expect(events[1]).toMatchObject({ type: "compaction_done", reason: "pre_inference", tokensSaved: 600 });
  });

  test("pre-inference failure emits context_error", async () => {
    const events: AgentEvent[] = [];
    const manager = makeContextManager({
      preInferenceCheck: mock(async () => ({
        canProceed: false,
        compactionPerformed: false,
        error: "too large",
      })),
    });
    const controller = new ContextController({
      contextManager: manager,
      emit: (event) => events.push(event),
    });

    const result = await controller.performPreInferenceCheck(makeMetrics("pre"));

    expect(result.canProceed).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "context_error", error: "too large" });
  });

  test("overflow recovery emits recovery events and reports retry decision", async () => {
    const events: AgentEvent[] = [];
    const manager = makeContextManager({
      handleContextOverflow: mock(async () => ({
        recovered: true,
        shouldRetry: true,
        outcome: makeCompactionOutcome(),
      })),
    });
    const controller = new ContextController({
      contextManager: manager,
      emit: (event) => events.push(event),
    });

    const result = await controller.recoverContextOverflow(makeMetrics("overflow"));

    expect(result).toMatchObject({ recovered: true, shouldRetry: true });
    expect(events.map((event) => event.type)).toEqual(["compaction_start", "compaction_done"]);
    expect(events[0]).toMatchObject({ type: "compaction_start", reason: "overflow_recovery" });
  });

  test("records provider usage and reads effective context tokens", () => {
    const manager = makeContextManager({
      recordProviderUsage: mock(() => {}),
      getSnapshot: mock(() => ({ ...makeSnapshot(), effectiveTokens: 1234 })),
    });
    const controller = new ContextController({ contextManager: manager });

    controller.recordProviderUsage(makeResponse(777), "turn_1", "entry_1");
    const effectiveTokens = controller.getEffectiveContextTokens(makeMetrics("ctx"));

    expect(manager.recordProviderUsage).toHaveBeenCalledWith(777, "entry_1", "turn_1");
    expect(effectiveTokens).toBe(1234);
  });

  test("schedules latest milestone when auto compact is enabled", () => {
    const scheduler = makeScheduler();
    const manager = makeContextManager({
      evaluateMilestone: mock(() => ({ shouldCompact: true, snapshot: makeSnapshot() })),
    });
    const controller = new ContextController({
      contextManager: manager,
      backgroundScheduler: scheduler,
    });

    const decision = controller.scheduleLatestMilestone({
      checkpointEvents: [
        { kind: "milestone", reason: "first" },
        { kind: "plan_pivot", reason: "pivot" },
        { kind: "milestone", reason: "latest" },
      ],
      metrics: makeMetrics("milestone"),
    });

    expect(decision).toMatchObject({ evaluated: true, shouldCompact: true, reason: "latest" });
    expect(scheduler.schedule).toHaveBeenCalledWith("milestone", expect.any(Object), 10, 5, "milestone");
  });

  test("does not schedule milestone or turn complete when auto compact is disabled", () => {
    const scheduler = makeScheduler();
    const manager = makeContextManager({
      evaluateMilestone: mock(() => ({ shouldCompact: true, snapshot: makeSnapshot() })),
      evaluateTurnComplete: mock(() => ({ shouldCompact: true, snapshot: makeSnapshot() })),
    });
    const controller = new ContextController({
      contextManager: manager,
      backgroundScheduler: scheduler,
      autoCompactEnabled: () => false,
    });

    const milestone = controller.scheduleLatestMilestone({
      checkpointEvents: [{ kind: "milestone", reason: "done" }],
      metrics: makeMetrics("milestone"),
    });
    const turnComplete = controller.scheduleTurnComplete({
      responseStatus: "completed",
      errorCount: 0,
      metrics: makeMetrics("turn"),
    });

    expect(milestone.evaluated).toBe(false);
    expect(turnComplete.evaluated).toBe(false);
    expect(scheduler.schedule).not.toHaveBeenCalled();
  });

  test("schedules turn-complete compaction only for successful turns", () => {
    const scheduler = makeScheduler();
    const manager = makeContextManager({
      evaluateTurnComplete: mock(() => ({ shouldCompact: true, snapshot: makeSnapshot() })),
    });
    const controller = new ContextController({
      contextManager: manager,
      backgroundScheduler: scheduler,
    });

    const skipped = controller.scheduleTurnComplete({
      responseStatus: "failed",
      errorCount: 0,
      metrics: makeMetrics("turn"),
    });
    const scheduled = controller.scheduleTurnComplete({
      responseStatus: "completed",
      errorCount: 0,
      metrics: makeMetrics("turn"),
    });

    expect(skipped.evaluated).toBe(false);
    expect(scheduled).toMatchObject({ evaluated: true, shouldCompact: true, trigger: "turn_complete" });
    expect(scheduler.schedule).toHaveBeenCalledTimes(1);
    expect(scheduler.schedule).toHaveBeenCalledWith("turn_complete", expect.any(Object), 10, 5, "turn");
  });

  test("cancels running background compaction on new turn", () => {
    const scheduler = makeScheduler({ isRunning: true });
    const controller = new ContextController({ backgroundScheduler: scheduler });

    controller.cancelBackgroundCompaction("new turn started");

    expect(scheduler.cancel).toHaveBeenCalledWith("new turn started");
  });
});

function makeMetrics(requestFingerprint: string) {
  return {
    systemPromptTokens: 10,
    toolSchemaTokens: 5,
    requestFingerprint,
  };
}

function makeCompactionOutcome(): NonNullable<PreInferenceCheckResult["outcome"]> {
  return {
    compacted: true,
    trigger: "hard_limit",
    strategy: "deterministic",
    quality: "degraded",
    checkpointId: "ctx_1",
    metrics: {
      effectiveTokensBefore: 1500,
      estimatedTokensAfter: 900,
      reclaimedTokens: 600,
      savingsRatio: 0.4,
      generationDurationMs: 25,
    },
    validation: null,
    reason: "compacted",
  };
}

function makeContextManager(overrides: Partial<ContextManager> = {}): ContextManager {
  return {
    preInferenceCheck: mock(async () => ({ canProceed: true, compactionPerformed: false })),
    handleContextOverflow: mock(async () => ({ recovered: false, shouldRetry: false })),
    recordProviderUsage: mock(() => {}),
    getSnapshot: mock(() => makeSnapshot()),
    evaluateMilestone: mock(() => ({ shouldCompact: false, snapshot: makeSnapshot() })),
    evaluateTurnComplete: mock(() => ({ shouldCompact: false, snapshot: makeSnapshot() })),
    ...overrides,
  } as unknown as ContextManager;
}

function makeScheduler(options: { isRunning?: boolean } = {}): BackgroundScheduler {
  return {
    isRunning: mock(() => options.isRunning ?? false),
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

function makeResponse(inputTokens: number): ResponseResource {
  return {
    id: "resp_test",
    object: "response",
    created_at: 1,
    completed_at: 2,
    status: "completed",
    incomplete_details: null,
    model: "test-model",
    previous_response_id: null,
    instructions: null,
    output: [],
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
      input_tokens: inputTokens,
      output_tokens: 10,
      total_tokens: inputTokens + 10,
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
