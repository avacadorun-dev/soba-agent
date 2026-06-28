import { describe, expect, test } from "bun:test";
import { createToolOutcomeFingerprint, LoopGuard, type ToolOutcome } from "../src/engine/turn/loop-guard";

function outcome(step: string, result = "ok"): ToolOutcome[] {
  return [{ toolName: "read", arguments: JSON.stringify({ path: step }), result, isError: false }];
}

describe("LoopGuard", () => {
  test("позволяет продолжать при уникальном прогрессе", () => {
    const guard = new LoopGuard({
      maxAgentIterations: 100,
      maxStalledIterations: 2,
      maxStallRecoveryAttempts: 1,
      maxRunDurationMs: 0,
    });

    expect(guard.observeToolIteration(outcome("a")).action).toBe("continue");
    expect(guard.observeToolIteration(outcome("b")).action).toBe("continue");
    expect(guard.observeToolIteration(outcome("c")).action).toBe("continue");
  });

  test("просит сменить стратегию после одинаковых tool-итераций", () => {
    const guard = new LoopGuard({
      maxAgentIterations: 100,
      maxStalledIterations: 2,
      maxStallRecoveryAttempts: 1,
      maxRunDurationMs: 0,
    });

    expect(guard.observeToolIteration(outcome("same")).action).toBe("continue");
    expect(guard.observeToolIteration(outcome("same")).action).toBe("continue");
    expect(guard.observeToolIteration(outcome("same")).action).toBe("recover");
  });

  test("останавливается если recovery не помог", () => {
    const guard = new LoopGuard({
      maxAgentIterations: 100,
      maxStalledIterations: 1,
      maxStallRecoveryAttempts: 1,
      maxRunDurationMs: 0,
    });

    guard.observeToolIteration(outcome("same"));
    expect(guard.observeToolIteration(outcome("same")).action).toBe("recover");
    guard.observeToolIteration(outcome("same"));
    expect(guard.observeToolIteration(outcome("same")).action).toBe("stop");
  });

  test("считает серию разных ошибочных вызовов отсутствием прогресса", () => {
    const guard = new LoopGuard({
      maxAgentIterations: 0,
      maxStalledIterations: 2,
      maxStallRecoveryAttempts: 1,
      maxRunDurationMs: 0,
    });

    const failed = (path: string): ToolOutcome[] => [
      { toolName: "read", arguments: JSON.stringify({ path }), result: "not found", isError: true },
    ];
    expect(guard.observeToolIteration(failed("a")).action).toBe("continue");
    expect(guard.observeToolIteration(failed("b")).action).toBe("continue");
    expect(guard.observeToolIteration(failed("c")).action).toBe("recover");
  });

  test("сбрасывает историю recovery после устойчивого прогресса", () => {
    const guard = new LoopGuard({
      maxAgentIterations: 0,
      maxStalledIterations: 2,
      maxStallRecoveryAttempts: 1,
      maxRunDurationMs: 0,
    });

    guard.observeToolIteration(outcome("same"));
    guard.observeToolIteration(outcome("same"));
    expect(guard.observeToolIteration(outcome("same")).action).toBe("recover");
    guard.observeToolIteration(outcome("progress-a"));
    guard.observeToolIteration(outcome("progress-b"));
    guard.observeToolIteration(outcome("same"));
    guard.observeToolIteration(outcome("same"));
    expect(guard.observeToolIteration(outcome("same")).action).toBe("recover");
  });

  test("аварийный предел и time budget остаются последней защитой", () => {
    const iterations = new LoopGuard({
      maxAgentIterations: 3,
      maxStalledIterations: 0,
      maxStallRecoveryAttempts: 0,
      maxRunDurationMs: 0,
    });
    expect(iterations.checkLimits(3).action).toBe("stop");

    const duration = new LoopGuard({
      maxAgentIterations: 0,
      maxStalledIterations: 0,
      maxStallRecoveryAttempts: 0,
      maxRunDurationMs: 1000,
    });
    expect(duration.checkLimits(0, Date.now() + 2000).action).toBe("stop");
  });

  test("fingerprint нормализует незначащие пробелы", () => {
    expect(createToolOutcomeFingerprint(outcome("a", "one   two"))).toBe(
      createToolOutcomeFingerprint(outcome("a", "one two")),
    );
  });
});
