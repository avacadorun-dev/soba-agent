import { describe, expect, test } from "bun:test";
import { contextCapsuleToMemoryInput } from "../../src/kernel/memory/context-capsule";
import type { ContextCapsuleEntry } from "../../src/kernel/transcript/types-v2";

describe("contextCapsuleToMemoryInput", () => {
  test("maps context capsule provenance into project memory input", () => {
    const input = contextCapsuleToMemoryInput(makeCapsule(), "sess_123");

    expect(input).toMatchObject({
      id: "mem_ck_123456789abc",
      type: "discovery",
      context: {
        task: "Continue auth refactor with proof receipts",
        sessionId: "sess_123",
        timestamp: "2026-06-30T10:20:30.000Z",
      },
      priority: "medium",
      tags: ["context-capsule", "checkpoint", "user_request", "deterministic", "portable"],
      related: [],
    });
    expect(input.summary).toContain("ck_123456789abc");
    expect(input.summary.length).toBeLessThanOrEqual(160);
    expect(input.summary).toContain("Completed: Added proof persistence");
    expect(input.detail).toContain("Context capsule: ck_123456789abc");
    expect(input.detail).toContain("Completed: Added proof persistence");
    expect(input.detail).toContain("Metrics: 10000 -> 2500 tokens, reclaimed 7500.");
  });

  test("uses high priority for hard-limit capsules and low priority for degraded capsules", () => {
    expect(contextCapsuleToMemoryInput(makeCapsule({ trigger: "hard_limit" })).priority).toBe("high");
    expect(contextCapsuleToMemoryInput(makeCapsule({ quality: "degraded" })).priority).toBe("low");
  });
});

function makeCapsule(overrides: Partial<ContextCapsuleEntry> = {}): ContextCapsuleEntry {
  return {
    type: "context_capsule",
    id: "entry_1",
    parentId: "parent_1",
    timestamp: "2026-06-30T10:20:30.000Z",
    checkpointId: "ck_123456789abc",
    trigger: "user_request",
    strategy: "deterministic",
    quality: "portable",
    portableState: {
      goal: "Continue auth refactor with proof receipts",
      constraints: ["Bun only"],
      completed: ["Added proof persistence"],
      inProgress: ["Mirroring capsules"],
      pending: ["Run gates"],
      decisions: [{ decision: "Memory mirrors are advisory", rationale: "Session capsule is authoritative" }],
      blockers: [],
      nextSteps: ["Commit after gates"],
    },
    artifacts: {
      readFiles: ["src/application/commands/capsule.ts"],
      modifiedFiles: ["src/application/commands/capsule.ts"],
      verificationCommands: ["bun test tests/apps/cli/commands.test.ts"],
      verificationStatus: "passed",
    },
    activatedSkills: [],
    provenance: {
      firstCompactedEntryId: "entry_0",
      firstKeptEntryId: "entry_1",
      sourceEntryIds: ["entry_0"],
    },
    metrics: {
      effectiveTokensBefore: 10_000,
      estimatedTokensAfter: 2_500,
      reclaimedTokens: 7_500,
      savingsRatio: 0.75,
      generationDurationMs: 120,
    },
    ...overrides,
  };
}
