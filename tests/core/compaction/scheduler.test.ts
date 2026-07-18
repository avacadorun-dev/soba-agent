import { describe, expect, mock, test } from "bun:test";
import type { ContextManager } from "../../../src/engine/compaction/context-manager";
import { BackgroundScheduler } from "../../../src/engine/compaction/scheduler";
import { SessionManager } from "../../../src/infrastructure/persistence/sessions/session-manager";

describe("BackgroundScheduler compatibility shim", () => {
  test("schedule stores intent without invoking ContextManager", async () => {
    const session = SessionManager.inMemoryV2();
    const compactScheduled = mock(async () => { throw new Error("must not run"); });
    const scheduler = new BackgroundScheduler(
      session,
      { compactScheduled } as unknown as ContextManager,
      { backgroundTimeoutMs: 1 },
    );

    scheduler.schedule("turn_complete", snapshot(), 10, 5, "turn_1");
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(compactScheduled).not.toHaveBeenCalled();
    expect(scheduler.isRunning()).toBe(false);
    expect(scheduler.getCurrentOperation()?.trigger).toBe("turn_complete");
  });

  test("intent snapshot is immutable and can be consumed once", () => {
    const scheduler = makeScheduler();
    const source = snapshot();
    scheduler.schedule("milestone", source, 10, 5, "turn_1");
    source.effectiveTokens = 1;

    expect(scheduler.takePendingOperation()?.snapshot.effectiveTokens).toBe(900);
    expect(scheduler.takePendingOperation()).toBeNull();
  });

  test("new intent replaces the previous pending intent", () => {
    const cancelled = mock(() => {});
    const scheduler = makeScheduler({ onOperationCancelled: cancelled });
    scheduler.schedule("turn_complete", snapshot(), 10, 5, "turn_1");
    scheduler.schedule("plan_pivot", snapshot(), 10, 5, "turn_1");

    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(scheduler.getCurrentOperation()?.trigger).toBe("plan_pivot");
  });
});

function makeScheduler(events?: ConstructorParameters<typeof BackgroundScheduler>[2]["events"]) {
  return new BackgroundScheduler(
    SessionManager.inMemoryV2(),
    {} as ContextManager,
    { backgroundTimeoutMs: 15_000, events },
  );
}

function snapshot() {
  return {
    source: "estimated" as const,
    providerInputTokens: 0,
    estimatedTrailingTokens: 900,
    effectiveTokens: 900,
    historicalTokens: 900,
    systemPromptTokens: 10,
    toolSchemaTokens: 5,
    contextWindow: 1_200,
    maxOutputTokens: 100,
    safetyReserveTokens: 100,
    hardLimit: 1_000,
  };
}
