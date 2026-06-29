/**
 * TriggerPolicy tests.
 *
 * Covers plan A.3:
 * - Hard limit boundary detection
 * - ROI policy: minTokensForAutoCompact, minReclaimableTokens, minSavingsRatio
 * - auto: false disables turn_complete and milestone but not hard_limit/overflow
 * - user_request ignores minima but returns no-op when nothing to reclaim
 * - Config invariant validation
 */

import { describe, expect, test } from "bun:test";
import type { ContextSnapshot } from "../../../src/engine/compaction/context-meter";
import {
  DEFAULT_COMPACTION_CONFIG,
  TriggerPolicy,
  validateCompactionConfig,
} from "../../../src/engine/compaction/trigger-policy";

// ─── Helpers ───

function makeSnapshot(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    source: "estimated",
    providerInputTokens: 0,
    estimatedTrailingTokens: 50_000,
    effectiveTokens: 50_000,
    historicalTokens: 50_000,
    systemPromptTokens: 2_000,
    toolSchemaTokens: 500,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    safetyReserveTokens: 8_192,
    hardLimit: 128_000 - 16_384 - 8_192, // 103_424
    ...overrides,
  };
}

// ─── Default config ───

describe("DEFAULT_COMPACTION_CONFIG", () => {
  test("has expected defaults", () => {
    expect(DEFAULT_COMPACTION_CONFIG.auto).toBe(true);
    expect(DEFAULT_COMPACTION_CONFIG.compactOnTurnComplete).toBe(true);
    expect(DEFAULT_COMPACTION_CONFIG.compactOnMilestone).toBe(true);
    expect(DEFAULT_COMPACTION_CONFIG.minTokensForAutoCompact).toBe(32_000);
    expect(DEFAULT_COMPACTION_CONFIG.minReclaimableTokens).toBe(12_000);
    expect(DEFAULT_COMPACTION_CONFIG.minSavingsRatio).toBe(0.25);
    expect(DEFAULT_COMPACTION_CONFIG.keepRecentTokens).toBe(20_000);
    expect(DEFAULT_COMPACTION_CONFIG.safetyReserveTokens).toBe(8_192);
    expect(DEFAULT_COMPACTION_CONFIG.backgroundTimeoutMs).toBe(15_000);
  });
});

// ─── Hard limit ───

describe("TriggerPolicy.evaluateHardLimit", () => {
  test("returns shouldCompact=true when effectiveTokens > hardLimit", () => {
    const policy = new TriggerPolicy();
    const snap = makeSnapshot({ effectiveTokens: 110_000, hardLimit: 103_424 });
    const decision = policy.evaluateHardLimit(snap);
    expect(decision.shouldCompact).toBe(true);
    expect(decision.trigger).toBe("hard_limit");
  });

  test("returns shouldCompact=false when effectiveTokens <= hardLimit", () => {
    const policy = new TriggerPolicy();
    const snap = makeSnapshot({ effectiveTokens: 50_000, hardLimit: 103_424 });
    const decision = policy.evaluateHardLimit(snap);
    expect(decision.shouldCompact).toBe(false);
    expect(decision.trigger).toBeNull();
  });

  test("hard limit boundary: exactly at limit is not triggered", () => {
    const policy = new TriggerPolicy();
    const snap = makeSnapshot({ effectiveTokens: 103_424, hardLimit: 103_424 });
    const decision = policy.evaluateHardLimit(snap);
    expect(decision.shouldCompact).toBe(false);
  });

  test("hard limit is not disabled by auto: false", () => {
    const policy = new TriggerPolicy({ auto: false });
    const snap = makeSnapshot({ effectiveTokens: 110_000, hardLimit: 103_424 });
    const decision = policy.evaluateHardLimit(snap);
    expect(decision.shouldCompact).toBe(true);
    expect(decision.trigger).toBe("hard_limit");
  });

  test("estimatedReclaimableTokens is positive when triggered", () => {
    const policy = new TriggerPolicy({ keepRecentTokens: 20_000 });
    const snap = makeSnapshot({ effectiveTokens: 110_000, hardLimit: 103_424 });
    const decision = policy.evaluateHardLimit(snap);
    expect(decision.estimatedReclaimableTokens).toBeGreaterThan(0);
    expect(decision.estimatedSavingsRatio).toBeGreaterThan(0);
  });
});

// ─── Turn complete (background) ───

describe("TriggerPolicy.evaluateTurnComplete", () => {
  test("returns shouldCompact=true when ROI passes", () => {
    const policy = new TriggerPolicy({
      minTokensForAutoCompact: 32_000,
      minReclaimableTokens: 12_000,
      minSavingsRatio: 0.25,
      keepRecentTokens: 20_000,
    });
    // effectiveTokens=50k, reclaimable=30k, ratio=0.6
    const snap = makeSnapshot({ effectiveTokens: 50_000 });
    const decision = policy.evaluateTurnComplete(snap);
    expect(decision.shouldCompact).toBe(true);
    expect(decision.trigger).toBe("turn_complete");
  });

  test("returns shouldCompact=false when auto=false", () => {
    const policy = new TriggerPolicy({ auto: false });
    const snap = makeSnapshot({ effectiveTokens: 50_000 });
    const decision = policy.evaluateTurnComplete(snap);
    expect(decision.shouldCompact).toBe(false);
    expect(decision.trigger).toBeNull();
  });

  test("returns shouldCompact=false when compactOnTurnComplete=false", () => {
    const policy = new TriggerPolicy({ compactOnTurnComplete: false });
    const snap = makeSnapshot({ effectiveTokens: 50_000 });
    const decision = policy.evaluateTurnComplete(snap);
    expect(decision.shouldCompact).toBe(false);
  });

  test("returns shouldCompact=false when effectiveTokens < minTokensForAutoCompact", () => {
    const policy = new TriggerPolicy({ minTokensForAutoCompact: 32_000 });
    const snap = makeSnapshot({ effectiveTokens: 20_000 });
    const decision = policy.evaluateTurnComplete(snap);
    expect(decision.shouldCompact).toBe(false);
    expect(decision.reason).toContain("minTokensForAutoCompact");
  });

  test("returns shouldCompact=false when reclaimable < minReclaimableTokens", () => {
    const policy = new TriggerPolicy({
      minTokensForAutoCompact: 32_000,
      minReclaimableTokens: 40_000, // very high threshold
      keepRecentTokens: 20_000,
    });
    const snap = makeSnapshot({ effectiveTokens: 50_000 }); // reclaimable=30k < 40k
    const decision = policy.evaluateTurnComplete(snap);
    expect(decision.shouldCompact).toBe(false);
    expect(decision.reason).toContain("minReclaimableTokens");
  });

  test("returns shouldCompact=false when savingsRatio < minSavingsRatio", () => {
    const policy = new TriggerPolicy({
      minTokensForAutoCompact: 32_000,
      minReclaimableTokens: 1_000,
      minSavingsRatio: 0.9, // very high threshold
      keepRecentTokens: 20_000,
    });
    const snap = makeSnapshot({ effectiveTokens: 50_000 }); // ratio=0.6 < 0.9
    const decision = policy.evaluateTurnComplete(snap);
    expect(decision.shouldCompact).toBe(false);
    expect(decision.reason).toContain("minSavingsRatio");
  });
});

// ─── Milestone ───

describe("TriggerPolicy.evaluateMilestone", () => {
  test("returns shouldCompact=true when ROI passes and auto=true", () => {
    const policy = new TriggerPolicy({
      minTokensForAutoCompact: 32_000,
      minReclaimableTokens: 12_000,
      minSavingsRatio: 0.25,
      keepRecentTokens: 20_000,
    });
    const snap = makeSnapshot({ effectiveTokens: 50_000 });
    const decision = policy.evaluateMilestone(snap);
    expect(decision.shouldCompact).toBe(true);
    expect(decision.trigger).toBe("milestone");
  });

  test("returns shouldCompact=false when auto=false", () => {
    const policy = new TriggerPolicy({ auto: false });
    const snap = makeSnapshot({ effectiveTokens: 50_000 });
    const decision = policy.evaluateMilestone(snap);
    expect(decision.shouldCompact).toBe(false);
  });

  test("returns shouldCompact=false when compactOnMilestone=false", () => {
    const policy = new TriggerPolicy({ compactOnMilestone: false });
    const snap = makeSnapshot({ effectiveTokens: 50_000 });
    const decision = policy.evaluateMilestone(snap);
    expect(decision.shouldCompact).toBe(false);
  });
});

// ─── User request ───

describe("TriggerPolicy.evaluateUserRequest", () => {
  test("returns shouldCompact=true ignoring auto minima", () => {
    const policy = new TriggerPolicy({ auto: false });
    const snap = makeSnapshot({ effectiveTokens: 25_000 }); // below minTokensForAutoCompact
    const decision = policy.evaluateUserRequest(snap);
    expect(decision.shouldCompact).toBe(true);
    expect(decision.trigger).toBe("user_request");
  });

  test("returns shouldCompact=false (no-op) when nothing to reclaim", () => {
    const policy = new TriggerPolicy({ keepRecentTokens: 20_000 });
    // effectiveTokens <= keepRecentTokens → nothing to reclaim
    const snap = makeSnapshot({ effectiveTokens: 15_000 });
    const decision = policy.evaluateUserRequest(snap);
    expect(decision.shouldCompact).toBe(false);
    expect(decision.trigger).toBeNull();
  });

  test("returns shouldCompact=false when effectiveTokens == keepRecentTokens", () => {
    const policy = new TriggerPolicy({ keepRecentTokens: 20_000 });
    const snap = makeSnapshot({ effectiveTokens: 20_000 });
    const decision = policy.evaluateUserRequest(snap);
    expect(decision.shouldCompact).toBe(false);
  });
});

// ─── Context overflow ───

describe("TriggerPolicy.evaluateContextOverflow", () => {
  test("always returns shouldCompact=true regardless of auto", () => {
    const policy = new TriggerPolicy({ auto: false });
    const snap = makeSnapshot({ effectiveTokens: 50_000 });
    const decision = policy.evaluateContextOverflow(snap);
    expect(decision.shouldCompact).toBe(true);
    expect(decision.trigger).toBe("context_overflow");
  });

  test("returns correct reason", () => {
    const policy = new TriggerPolicy();
    const snap = makeSnapshot();
    const decision = policy.evaluateContextOverflow(snap);
    expect(decision.reason).toContain("overflow");
  });
});

// ─── setAuto runtime toggle ───

describe("TriggerPolicy.setAuto", () => {
  test("setAuto(false) disables turn_complete", () => {
    const policy = new TriggerPolicy({ auto: true });
    const snap = makeSnapshot({ effectiveTokens: 50_000 });
    expect(policy.evaluateTurnComplete(snap).shouldCompact).toBe(true);

    policy.setAuto(false);
    expect(policy.evaluateTurnComplete(snap).shouldCompact).toBe(false);
  });

  test("setAuto(false) does not disable hard_limit", () => {
    const policy = new TriggerPolicy({ auto: true });
    policy.setAuto(false);
    const snap = makeSnapshot({ effectiveTokens: 110_000, hardLimit: 103_424 });
    expect(policy.evaluateHardLimit(snap).shouldCompact).toBe(true);
  });

  test("setAuto(true) re-enables turn_complete", () => {
    const policy = new TriggerPolicy({ auto: false });
    const snap = makeSnapshot({ effectiveTokens: 50_000 });
    expect(policy.evaluateTurnComplete(snap).shouldCompact).toBe(false);

    policy.setAuto(true);
    expect(policy.evaluateTurnComplete(snap).shouldCompact).toBe(true);
  });
});

// ─── Config validation ───

describe("validateCompactionConfig", () => {
  test("valid config passes", () => {
    const result = validateCompactionConfig(DEFAULT_COMPACTION_CONFIG, 128_000, 16_384);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("contextWindow <= 0 is invalid", () => {
    const result = validateCompactionConfig(DEFAULT_COMPACTION_CONFIG, 0, 16_384);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("contextWindow"))).toBe(true);
  });

  test("maxOutputTokens <= 0 is invalid", () => {
    const result = validateCompactionConfig(DEFAULT_COMPACTION_CONFIG, 128_000, 0);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("maxOutputTokens"))).toBe(true);
  });

  test("maxOutputTokens + safetyReserveTokens >= contextWindow is invalid", () => {
    // 120_000 + 10_000 = 130_000 >= 128_000
    const config = { ...DEFAULT_COMPACTION_CONFIG, safetyReserveTokens: 10_000 };
    const result = validateCompactionConfig(config, 128_000, 120_000);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("safetyReserveTokens"))).toBe(true);
  });

  test("keepRecentTokens >= hardLimit is invalid", () => {
    // hardLimit = 128_000 - 16_384 - 8_192 = 103_424
    const config = { ...DEFAULT_COMPACTION_CONFIG, keepRecentTokens: 110_000 };
    const result = validateCompactionConfig(config, 128_000, 16_384);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("keepRecentTokens"))).toBe(true);
  });

  test("safetyReserveTokens < 0 is invalid", () => {
    const config = { ...DEFAULT_COMPACTION_CONFIG, safetyReserveTokens: -1 };
    const result = validateCompactionConfig(config, 128_000, 16_384);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("safetyReserveTokens"))).toBe(true);
  });

  test("multiple violations are all reported", () => {
    const config = { ...DEFAULT_COMPACTION_CONFIG, safetyReserveTokens: -1, keepRecentTokens: 200_000 };
    const result = validateCompactionConfig(config, 0, 0);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

// ─── CLI args: --no-auto-compact ───

describe("CLI --no-auto-compact flag", () => {
  test("parseArgs recognises --no-auto-compact", () => {
    const { parseArgs } = require("../../../src/apps/cli/args");
    const args = parseArgs(["--no-auto-compact"]);
    expect(args.noAutoCompact).toBe(true);
  });

  test("noAutoCompact defaults to false", () => {
    const { parseArgs } = require("../../../src/apps/cli/args");
    const args = parseArgs([]);
    expect(args.noAutoCompact).toBe(false);
  });
});
