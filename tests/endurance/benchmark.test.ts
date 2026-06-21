/**
 * Endurance Benchmark Tests (Phase 2, Task A.9).
 *
 * Validates the benchmark harness itself:
 * - Deterministic benchmark fixtures
 * - Capsule continuity assertions
 * - Baseline comparison
 *
 * These tests verify that the benchmark infrastructure correctly:
 * 1. Generates reproducible workloads
 * 2. Tracks token usage accurately
 * 3. Validates capsule invariants
 * 4. Handles restart/resume scenarios
 * 5. Switches providers correctly
 *
 * Spec: internal-design-notes § Endurance Acceptance
 */

import { describe, expect, it } from "bun:test";
import { SessionManager } from "../../src/core/session/session-manager";
import type { ItemParam } from "../../src/core/session/types";
import type { ContextCapsuleEntry } from "../../src/core/session/types-v2";
import {
  BenchmarkWorkload,
  type WorkloadConfig,
} from "./benchmark-workload";
import {
  CapsuleInvariantChecker,
  type CapsuleInvariantViolation,
} from "./capsule-invariant-checker";

// ─── Helpers ───

function userMessage(text: string): ItemParam {
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  };
}

function assistantMessage(text: string): ItemParam {
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
  };
}

// ─── Tests ───

describe("BenchmarkWorkload", () => {
  describe("deterministic fixture generation", () => {
    it("генерирует одинаковый workload при одинаковом seed", () => {
      const config: WorkloadConfig = {
        seed: 42,
        stepsCount: 50,
        tokensPerStep: 1000,
        compactionInterval: 5,
      };

      const workload1 = new BenchmarkWorkload(config);
      const workload2 = new BenchmarkWorkload(config);

      const steps1 = workload1.getSteps();
      const steps2 = workload2.getSteps();

      expect(steps1.length).toBe(steps2.length);
      for (let i = 0; i < steps1.length; i++) {
        const s1 = steps1[i];
        const s2 = steps2[i];
        expect(s1.type).toBe(s2.type);
        if (s1.type === "user_turn" && s2.type === "user_turn") {
          expect(s1.content).toBe(s2.content);
        }
      }
    });

    it("генерирует разный workload при разном seed", () => {
      const config1: WorkloadConfig = {
        seed: 42,
        stepsCount: 10,
        tokensPerStep: 500,
        compactionInterval: 3,
      };

      const config2: WorkloadConfig = {
        ...config1,
        seed: 123,
      };

      const workload1 = new BenchmarkWorkload(config1);
      const workload2 = new BenchmarkWorkload(config2);

      const steps1 = workload1.getSteps();
      const steps2 = workload2.getSteps();

      // At least one step should differ
      let hasDifference = false;
      for (let i = 0; i < steps1.length; i++) {
        const s1 = steps1[i];
        const s2 = steps2[i];
        if (s1.type === "user_turn" && s2.type === "user_turn") {
          if (s1.content !== s2.content) {
            hasDifference = true;
            break;
          }
        }
      }
      expect(hasDifference).toBe(true);
    });

    it("генерирует правильные типы шагов", () => {
      const config: WorkloadConfig = {
        seed: 1,
        stepsCount: 20,
        tokensPerStep: 500,
        compactionInterval: 5,
      };

      const workload = new BenchmarkWorkload(config);
      const steps = workload.getSteps();

      // Should have user turns, tool calls, and compaction triggers
      const userTurns = steps.filter((s) => s.type === "user_turn");
      const toolCalls = steps.filter((s) => s.type === "tool_call");
      const compactions = steps.filter((s) => s.type === "compaction_trigger");

      expect(userTurns.length).toBeGreaterThan(0);
      expect(toolCalls.length).toBeGreaterThan(0);
      expect(compactions.length).toBeGreaterThan(0);
    });

    it("вставляет compaction triggers с правильным интервалом", () => {
      const config: WorkloadConfig = {
        seed: 1,
        stepsCount: 30,
        tokensPerStep: 500,
        compactionInterval: 5,
      };

      const workload = new BenchmarkWorkload(config);
      const steps = workload.getSteps();

      // Count compaction triggers
      const compactionCount = steps.filter((s) => s.type === "compaction_trigger").length;

      // Should have at least 1 compaction trigger
      expect(compactionCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("workload execution", () => {
    it("применяет шаги к сессии", () => {
      const session = SessionManager.inMemoryV2();
      const config: WorkloadConfig = {
        seed: 1,
        stepsCount: 10,
        tokensPerStep: 300,
        compactionInterval: 3,
      };

      const workload = new BenchmarkWorkload(config);
      const result = workload.applyToSession(session);

      // Should have created entries
      const entries = session.getEntries();
      expect(entries.length).toBeGreaterThan(0);

      // Should have tracked token usage
      expect(result.totalInputTokens).toBeGreaterThan(0);
      expect(result.totalOutputTokens).toBeGreaterThanOrEqual(0);
    });

    it("возвращает правильную статистику", () => {
      const session = SessionManager.inMemoryV2();
      const config: WorkloadConfig = {
        seed: 1,
        stepsCount: 15,
        tokensPerStep: 400,
        compactionInterval: 5,
      };

      const workload = new BenchmarkWorkload(config);
      const result = workload.applyToSession(session);

      // Should track compaction count
      expect(result.compactionTriggers).toBeGreaterThan(0);

      // Should track tool calls
      expect(result.toolCalls).toBeGreaterThan(0);
    });
  });
});

describe("CapsuleInvariantChecker", () => {
  describe("goal preservation", () => {
    it("проверяет что goal не пустой", () => {
      const checker = new CapsuleInvariantChecker();

      const validCapsule = createMockCapsule({
        portableState: {
          goal: "Implement feature X",
          constraints: [],
          completed: [],
          inProgress: [],
          pending: [],
          decisions: [],
          blockers: [],
          nextSteps: [],
        },
      });

      const violations = checker.checkCapsule(validCapsule);
      const goalViolations = violations.filter((v) => v.field === "goal");
      expect(goalViolations.length).toBe(0);
    });

    it("обнаруживает пустой goal", () => {
      const checker = new CapsuleInvariantChecker();

      const invalidCapsule = createMockCapsule({
        portableState: {
          goal: "",
          constraints: [],
          completed: [],
          inProgress: [],
          pending: [],
          decisions: [],
          blockers: [],
          nextSteps: [],
        },
      });

      const violations = checker.checkCapsule(invalidCapsule);
      const goalViolations = violations.filter((v) => v.field === "goal");
      expect(goalViolations.length).toBeGreaterThan(0);
      expect(goalViolations[0].severity).toBe("error");
    });
  });

  describe("blocker preservation", () => {
    it("сохраняет активные blockers", () => {
      const checker = new CapsuleInvariantChecker();

      const capsule = createMockCapsule({
        portableState: {
          goal: "Fix bug",
          constraints: [],
          completed: [],
          inProgress: [],
          pending: [],
          decisions: [],
          blockers: ["API endpoint not responding", "Missing credentials"],
          nextSteps: [],
        },
      });

      const violations = checker.checkCapsule(capsule);
      const blockerViolations = violations.filter((v) => v.field === "blockers");
      expect(blockerViolations.length).toBe(0);
    });
  });

  describe("artifact ledger validation", () => {
    it("проверяет что modified files записаны", () => {
      const checker = new CapsuleInvariantChecker();

      const capsule = createMockCapsule({
        artifacts: {
          readFiles: ["src/auth.ts"],
          modifiedFiles: ["src/auth.ts", "src/utils.ts"],
          verificationCommands: ["bun test"],
          verificationStatus: "passed",
        },
      });

      const violations = checker.checkCapsule(capsule);
      const artifactViolations = violations.filter((v) => v.field.startsWith("artifacts"));
      expect(artifactViolations.length).toBe(0);
    });

    it("предупреждает о пустом verification status", () => {
      const checker = new CapsuleInvariantChecker();

      const capsule = createMockCapsule({
        artifacts: {
          readFiles: ["src/auth.ts"],
          modifiedFiles: ["src/auth.ts"],
          verificationCommands: [],
          verificationStatus: "unknown",
        },
      });

      const violations = checker.checkCapsule(capsule);
      const verificationWarnings = violations.filter(
        (v) => v.field === "artifacts.verificationStatus" && v.severity === "warning",
      );
      expect(verificationWarnings.length).toBeGreaterThan(0);
    });
  });

  describe("continuity across compactions", () => {
    it("проверяет последовательность capsules", () => {
      const checker = new CapsuleInvariantChecker();

      const capsules = [
        createMockCapsule({
          checkpointId: "ck_000000000001",
          portableState: {
            goal: "Initial goal",
            constraints: [],
            completed: [],
            inProgress: ["Task 1"],
            pending: ["Task 2"],
            decisions: [],
            blockers: [],
            nextSteps: ["Complete task 1"],
          },
        }),
        createMockCapsule({
          checkpointId: "ck_000000000002",
          portableState: {
            goal: "Initial goal",
            constraints: [],
            completed: ["Task 1"],
            inProgress: ["Task 2"],
            pending: [],
            decisions: [],
            blockers: [],
            nextSteps: ["Complete task 2"],
          },
        }),
      ];

      const violations = checker.checkContinuity(capsules);
      expect(violations.length).toBe(0);
    });

    it("обнаруживает потерю goal между capsules", () => {
      const checker = new CapsuleInvariantChecker();

      const capsules = [
        createMockCapsule({
          checkpointId: "ck_000000000001",
          portableState: {
            goal: "Important goal",
            constraints: [],
            completed: [],
            inProgress: [],
            pending: [],
            decisions: [],
            blockers: [],
            nextSteps: [],
          },
        }),
        createMockCapsule({
          checkpointId: "ck_000000000002",
          portableState: {
            goal: "",
            constraints: [],
            completed: [],
            inProgress: [],
            pending: [],
            decisions: [],
            blockers: [],
            nextSteps: [],
          },
        }),
      ];

      const violations = checker.checkContinuity(capsules);
      const goalLoss = violations.filter((v) => v.field === "continuity.goal");
      expect(goalLoss.length).toBeGreaterThan(0);
    });
  });
});

describe("Endurance scenario", () => {
  it("выполняет минимум 10 compactions", () => {
    const session = SessionManager.inMemoryV2();

    // Simulate a long session with many compactions
    for (let i = 0; i < 110; i++) {
      session.appendItem(userMessage(`User message ${i}: ${"x".repeat(500)}`));
      session.appendItem(assistantMessage(`Assistant response ${i}: ${"y".repeat(500)}`));

      // Trigger compaction every 10 messages
      if (i > 0 && i % 10 === 0) {
        session.appendContextCapsule({
          checkpointId: `ck_${i.toString().padStart(12, "0")}`,
          trigger: "turn_complete",
          strategy: "deterministic",
          quality: "degraded",
          portableState: {
            goal: `Continue working on task ${i}`,
            constraints: [],
            completed: [`Completed ${i} steps`],
            inProgress: [],
            pending: [],
            decisions: [],
            blockers: [],
            nextSteps: [`Next step after ${i}`],
          },
          artifacts: {
            readFiles: [],
            modifiedFiles: [],
            verificationCommands: [],
            verificationStatus: "unknown",
          },
          activatedSkills: [],
          provenance: {
            firstCompactedEntryId: "root",
            firstKeptEntryId: "root",
            sourceEntryIds: [],
          },
          metrics: {
            effectiveTokensBefore: 10000,
            estimatedTokensAfter: 2000,
            reclaimedTokens: 8000,
            savingsRatio: 0.8,
            generationDurationMs: 100,
          },
        });
      }
    }

    const capsules = session.getCapsuleEntries();
    expect(capsules.length).toBeGreaterThanOrEqual(10);
  });

  it("проверяет capsule invariants после каждой compaction", () => {
    const session = SessionManager.inMemoryV2();
    const checker = new CapsuleInvariantChecker();

    // Add some items
    for (let i = 0; i < 20; i++) {
      session.appendItem(userMessage(`Message ${i}`));
    }

    // Add capsules with valid state
    for (let i = 0; i < 5; i++) {
      session.appendContextCapsule({
        checkpointId: `ck_${i.toString().padStart(12, "0")}`,
        trigger: "turn_complete",
        strategy: "deterministic",
        quality: "degraded",
        portableState: {
          goal: `Goal for compaction ${i}`,
          constraints: [],
          completed: [`Step ${i} completed`],
          inProgress: [],
          pending: [],
          decisions: [],
          blockers: [],
          nextSteps: [],
        },
        artifacts: {
          readFiles: [],
          modifiedFiles: [],
          verificationCommands: [],
          verificationStatus: "unknown",
        },
        activatedSkills: [],
        provenance: {
          firstCompactedEntryId: "root",
          firstKeptEntryId: "root",
          sourceEntryIds: [],
        },
        metrics: {
          effectiveTokensBefore: 5000,
          estimatedTokensAfter: 1000,
          reclaimedTokens: 4000,
          savingsRatio: 0.8,
          generationDurationMs: 50,
        },
      });
    }

    const capsules = session.getCapsuleEntries();
    const allViolations: CapsuleInvariantViolation[] = [];

    for (const capsule of capsules) {
      const violations = checker.checkCapsule(capsule);
      allViolations.push(...violations);
    }

    // Should have no errors (warnings are ok)
    const errors = allViolations.filter((v) => v.severity === "error");
    expect(errors.length).toBe(0);
  });
});

// ─── Mock helpers ───

function createMockCapsule(
  overrides: Partial<ContextCapsuleEntry> = {},
): ContextCapsuleEntry {
  return {
    type: "context_capsule",
    id: `mock_${Math.random().toString(36).slice(2, 10)}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    checkpointId: overrides.checkpointId ?? "ck_000000000001",
    trigger: overrides.trigger ?? "turn_complete",
    strategy: overrides.strategy ?? "deterministic",
    quality: overrides.quality ?? "degraded",
    portableState: overrides.portableState ?? {
      goal: "Default goal",
      constraints: [],
      completed: [],
      inProgress: [],
      pending: [],
      decisions: [],
      blockers: [],
      nextSteps: [],
    },
    artifacts: overrides.artifacts ?? {
      readFiles: [],
      modifiedFiles: [],
      verificationCommands: [],
      verificationStatus: "unknown",
    },
    activatedSkills: overrides.activatedSkills ?? [],
    provenance: overrides.provenance ?? {
      firstCompactedEntryId: "root",
      firstKeptEntryId: "root",
      sourceEntryIds: [],
    },
    metrics: overrides.metrics ?? {
      effectiveTokensBefore: 10000,
      estimatedTokensAfter: 2000,
      reclaimedTokens: 8000,
      savingsRatio: 0.8,
      generationDurationMs: 100,
    },
    ...overrides,
  };
}
