import { describe, expect, mock, test } from "bun:test";
import type { CompactionOutcome, CompactionPlan, ContextManager } from "../../../src/engine/compaction/context-manager";
import type { ContextSnapshot } from "../../../src/engine/compaction/context-meter";
import { TriggerPolicy } from "../../../src/engine/compaction/trigger-policy";
import { ContextController } from "../../../src/engine/context/context-controller";
import type { AgentEvent } from "../../../src/engine/turn/types";
import type { ResponseResource } from "../../../src/kernel/model/openresponses-types";

describe("ContextController preflight barrier", () => {
  test("emits start before generation resolves and blocks inference barrier", async () => {
    const events: AgentEvent[] = [];
    let resolve!: (outcome: CompactionOutcome) => void;
    const deferred = new Promise<CompactionOutcome>((done) => { resolve = done; });
    const manager = makeManager({ executePlan: mock(() => deferred) });
    const controller = new ContextController({ contextManager: manager, emit: (event) => events.push(event) });

    controller.scheduleTurnComplete({ responseStatus: "completed", errorCount: 0, metrics: metrics(1) });
    const barrier = controller.performPreInferenceCheck(metrics(2));

    expect(events.map((event) => event.type)).toEqual(["compaction_start"]);
    let settled = false;
    void barrier.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolve(outcome("completed"));
    const result = await barrier;
    expect(result).toMatchObject({ canProceed: true, compactionPerformed: true });
    expect(events.map((event) => event.type)).toEqual(["compaction_start", "compaction_done"]);
  });

  test("hard-limit failure is fail closed", async () => {
    const events: AgentEvent[] = [];
    const manager = makeManager({
      getSnapshot: mock(() => snapshot(1_100)),
      executePlan: mock(async () => outcome("failed", true)),
    });
    const controller = new ContextController({ contextManager: manager, emit: (event) => events.push(event) });

    const result = await controller.performPreInferenceCheck(metrics(1));

    expect(result.canProceed).toBe(false);
    expect(events.map((event) => event.type)).toEqual([
      "compaction_start",
      "compaction_failed",
      "context_error",
    ]);
  });

  test("soft failure continues below hard limit and attempts only once per turn", async () => {
    const manager = makeManager({ executePlan: mock(async () => outcome("failed")) });
    const controller = new ContextController({ contextManager: manager });
    controller.scheduleTurnComplete({ responseStatus: "completed", errorCount: 0, metrics: metrics(1) });

    const first = await controller.performPreInferenceCheck(metrics(2));
    const second = await controller.performPreInferenceCheck(metrics(2));

    expect(first.canProceed).toBe(true);
    expect(second.canProceed).toBe(true);
    expect(manager.executePlan).toHaveBeenCalledTimes(1);
  });

  test("milestone and plan pivot outrank turn_complete and are consumed once", () => {
    const controller = new ContextController({ contextManager: makeManager() });
    controller.scheduleTurnComplete({ responseStatus: "completed", errorCount: 0, metrics: metrics(1) });
    controller.scheduleLatestMilestone({
      checkpointEvents: [{ kind: "milestone", reason: "checkpoint" }, { kind: "plan_pivot", reason: "pivot" }],
      metrics: metrics(1),
    });
    controller.scheduleTurnComplete({ responseStatus: "completed", errorCount: 0, metrics: metrics(1) });

    expect(controller.getPendingTrigger()).toBe("plan_pivot");
  });

  test("auto=false disables soft intent but not hard-limit barrier", async () => {
    const manager = makeManager({
      getSnapshot: mock(() => snapshot(1_100)),
      executePlan: mock(async () => outcome("failed", true)),
    });
    const controller = new ContextController({ contextManager: manager, autoCompactEnabled: () => false });

    expect(controller.scheduleTurnComplete({ responseStatus: "completed", errorCount: 0, metrics: metrics(1) }).evaluated).toBe(false);
    expect((await controller.performPreInferenceCheck(metrics(1))).canProceed).toBe(false);
    expect(manager.executePlan).toHaveBeenCalledTimes(1);
  });

  test("overflow recovery is limited to one compact per turn", async () => {
    const manager = makeManager({ executePlan: mock(async () => outcome("completed", true)) });
    const controller = new ContextController({ contextManager: manager });

    expect((await controller.recoverContextOverflow(metrics(4))).shouldRetry).toBe(true);
    expect((await controller.recoverContextOverflow(metrics(4))).shouldRetry).toBe(false);
    expect(manager.executePlan).toHaveBeenCalledTimes(1);
  });

  test("records provider usage and exposes measured context", () => {
    const manager = makeManager();
    const controller = new ContextController({ contextManager: manager });
    controller.recordProviderUsage(response(777), "turn_1", "entry_1");
    expect(manager.recordProviderUsage).toHaveBeenCalledWith(777, "entry_1", "turn_1");
    expect(controller.getEffectiveContextTokens(metrics(1))).toBe(900);
  });
});

function makeManager(overrides: Partial<ContextManager> = {}): ContextManager {
  const policy = new TriggerPolicy({
    minTokensForAutoCompact: 1,
    minReclaimableTokens: 1,
    minSavingsRatio: 0,
    keepRecentTokens: 100,
    autoCompactThresholdRatio: 0.8,
  });
  let sequence = 0;
  return {
    getSnapshot: mock(() => snapshot(900)),
    getPolicy: mock(() => policy),
    createPlan: mock((input: Omit<CompactionPlan, "operationId" | "expectedLeafId">) => ({
      ...input,
      operationId: `op_${++sequence}`,
      expectedLeafId: "leaf",
    }) as CompactionPlan),
    executePlan: mock(async () => outcome("completed")),
    recordProviderUsage: mock(() => {}),
    ...overrides,
  } as unknown as ContextManager;
}

function snapshot(effectiveTokens: number): ContextSnapshot {
  return {
    source: "estimated",
    providerInputTokens: 0,
    estimatedTrailingTokens: effectiveTokens,
    effectiveTokens,
    historicalTokens: effectiveTokens,
    systemPromptTokens: 10,
    toolSchemaTokens: 5,
    contextWindow: 1_200,
    maxOutputTokens: 100,
    safetyReserveTokens: 100,
    hardLimit: 1_000,
  };
}

function outcome(status: CompactionOutcome["status"], required = false): CompactionOutcome {
  return {
    status,
    trigger: required ? "hard_limit" : "turn_complete",
    strategy: status === "completed" ? "deterministic" : null,
    quality: status === "completed" ? "degraded" : null,
    checkpointId: status === "completed" ? "ctx_1" : null,
    metrics: status === "completed" ? {
      effectiveTokensBefore: 900,
      estimatedTokensAfter: 300,
      reclaimedTokens: 600,
      savingsRatio: 2 / 3,
      generationDurationMs: 20,
    } : null,
    validation: null,
    reason: status,
    operationId: "op_1",
    durationMs: 20,
    required,
  };
}

function metrics(turnIndex: number) {
  return { systemPromptTokens: 10, toolSchemaTokens: 5, requestFingerprint: `turn_${turnIndex}`, turnIndex };
}

function response(inputTokens: number): ResponseResource {
  return {
    id: "resp", object: "response", created_at: 0, completed_at: 0, status: "completed",
    incomplete_details: null, model: "test", previous_response_id: null, instructions: null,
    output: [], error: null, tools: [], tool_choice: "auto", truncation: "disabled",
    parallel_tool_calls: true, text: {}, top_p: 1, presence_penalty: 0, frequency_penalty: 0,
    top_logprobs: 0, temperature: 1, reasoning: null,
    usage: { input_tokens: inputTokens, output_tokens: 0, total_tokens: inputTokens,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
    max_output_tokens: null, max_tool_calls: null, store: false, background: false,
    service_tier: "default", metadata: {}, safety_identifier: null, prompt_cache_key: null,
  };
}
