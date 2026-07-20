/**
 * ContextMeter tests.
 *
 * Covers plan A.3:
 * - Provider usage watermark recording and precedence
 * - Trailing token estimation
 * - Fingerprint invalidation on prompt/tools/skills change
 * - Estimated fallback when no valid watermark
 * - Hard limit boundary calculation
 */

import { describe, expect, test } from "bun:test";
import { ContextMeter } from "../../../src/engine/compaction/context-meter";
import { SessionManager } from "../../../src/infrastructure/persistence/sessions/session-manager";
import { estimateTokens } from "../../../src/kernel/session/estimation";
import type { SessionEntry, SessionItemEntry } from "../../../src/kernel/transcript/types";

// ─── Helpers ───

function makeItemEntry(id: string, parentId: string | null, text: string): SessionEntry {
  return {
    type: "item",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
    },
  } as SessionItemEntry;
}

function makeBranch(texts: string[]): SessionEntry[] {
  return texts.map((text, i) => makeItemEntry(`e${i}`, i === 0 ? null : `e${i - 1}`, text));
}

// ─── ContextMeter tests ───

describe("ContextMeter — hard limit", () => {
  test("hardLimit = contextWindow - maxOutputTokens - safetyReserveTokens", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    expect(meter.hardLimit).toBe(128_000 - 16_384 - 8_192);
  });

  test("hardLimit is exposed as a getter", () => {
    const meter = new ContextMeter(64_000, 8_000, 4_000);
    expect(meter.hardLimit).toBe(52_000);
  });
});

describe("ContextMeter — estimated source (no watermark)", () => {
  test("snapshot without watermark returns source=estimated", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const branch = makeBranch(["Hello world"]);
    const snap = meter.snapshot(branch, "fp1", 1000, 500);
    expect(snap.source).toBe("estimated");
  });

  test("estimated snapshot: providerInputTokens=0", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const branch = makeBranch(["Hello world"]);
    const snap = meter.snapshot(branch, "fp1", 1000, 500);
    expect(snap.providerInputTokens).toBe(0);
  });

  test("estimated snapshot: effectiveTokens includes system + tools + session", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const branch = makeBranch(["Hello world"]);
    const snap = meter.snapshot(branch, "fp1", 1000, 500);
    expect(snap.effectiveTokens).toBeGreaterThan(1500); // system(1000) + tools(500) + session
    expect(snap.effectiveTokens).toBe(snap.estimatedTrailingTokens);
  });

  test("estimated snapshot includes additionalNonSessionTokens", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const branch = makeBranch(["Hi"]);
    const snapWithout = meter.snapshot(branch, "fp1", 0, 0, 0);
    const snapWith = meter.snapshot(branch, "fp1", 0, 0, 5000);
    expect(snapWith.effectiveTokens).toBe(snapWithout.effectiveTokens + 5000);
  });

  test("estimated snapshot measures the same portable capsule prefix as buildInput", () => {
    const session = SessionManager.inMemoryV2();
    const compactedId = session.appendItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Old request that is now compacted" }],
    });
    const keptId = session.appendItem({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Recent retained context" }],
    });
    session.appendContextCapsule({
      checkpointId: "ck_123456789abc",
      trigger: "auto_threshold",
      strategy: "portable_only",
      quality: "portable",
      portableState: {
        goal: "Continue the compacted task",
        constraints: ["Keep the capsule in the measured request"],
        completed: ["Read the old request"],
        inProgress: [],
        pending: ["Finish the task"],
        decisions: [],
        blockers: [],
        nextSteps: ["Use recent context"],
      },
      artifacts: {
        readFiles: ["src/example.ts"],
        modifiedFiles: [],
        verificationCommands: [],
        verificationStatus: "unknown",
      },
      activatedSkills: [],
      provenance: {
        firstCompactedEntryId: compactedId,
        firstKeptEntryId: keptId,
        sourceEntryIds: [compactedId],
      },
      metrics: {
        effectiveTokensBefore: 1_000,
        estimatedTokensAfter: 400,
        reclaimedTokens: 600,
        savingsRatio: 0.6,
        generationDurationMs: 10,
      },
    });
    session.appendItem({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Fresh tail after the capsule" }],
    });

    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const snapshot = meter.snapshot(session.getBranch(), "fp1", 1_000, 500);
    const expected = 1_500 + estimateTokens(session.buildInput().items);

    expect(snapshot.effectiveTokens).toBe(expected);
    expect(snapshot.effectiveTokens).toBeGreaterThan(1_500 + estimateTokens(session.buildInput().items.slice(1)));
  });

  test("estimated snapshot measures a compatible native capsule exactly", () => {
    const session = SessionManager.inMemoryV2();
    const compactedId = session.appendItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Old native request" }],
    });
    const keptId = session.appendItem({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Native retained tail" }],
    });
    session.appendContextCapsule({
      checkpointId: "ck_abcdef123456",
      trigger: "hard_limit",
      strategy: "native_portable",
      quality: "native",
      portableState: {
        goal: "Continue natively",
        constraints: [],
        completed: [],
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
      nativeContinuation: {
        provider: { adapterId: "test", endpointOrigin: "https://example.test", model: "native" },
        compatibilityKey: "native-key",
        items: [{
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: "Opaque compatible native continuation" }],
        }],
      },
      provenance: {
        firstCompactedEntryId: compactedId,
        firstKeptEntryId: keptId,
        sourceEntryIds: [compactedId],
      },
      metrics: {
        effectiveTokensBefore: 1_000,
        estimatedTokensAfter: 400,
        reclaimedTokens: 600,
        savingsRatio: 0.6,
        generationDurationMs: 10,
      },
    });

    const meter = new ContextMeter(128_000, 16_384, 8_192, "native-key");
    const snapshot = meter.snapshot(session.getBranch(), "fp1", 1_000, 500);

    expect(snapshot.effectiveTokens).toBe(
      1_500 + estimateTokens(session.buildInput("native-key").items),
    );
  });
});

describe("ContextMeter — provider usage watermark", () => {
  test("after recordProviderUsage, snapshot returns source=provider_usage", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const branch = makeBranch(["Hello", "World"]);
    meter.recordProviderUsage(50_000, "e1", "fp1");

    const snap = meter.snapshot(branch, "fp1", 1000, 500);
    expect(snap.source).toBe("provider_usage");
  });

  test("provider_usage snapshot: providerInputTokens matches recorded value", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const branch = makeBranch(["Hello"]);
    meter.recordProviderUsage(45_000, "e0", "fp1");

    const snap = meter.snapshot(branch, "fp1", 0, 0);
    expect(snap.providerInputTokens).toBe(45_000);
  });

  test("provider_usage snapshot: effectiveTokens = providerInputTokens + trailingTokens", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const branch = makeBranch(["Hello", "World", "More text here"]);
    // Measured through e1 (index 1), e2 is trailing
    meter.recordProviderUsage(40_000, "e1", "fp1");

    const snap = meter.snapshot(branch, "fp1", 0, 0);
    expect(snap.source).toBe("provider_usage");
    expect(snap.effectiveTokens).toBeGreaterThan(40_000); // 40k + trailing e2
    expect(snap.effectiveTokens).toBe(snap.providerInputTokens + snap.estimatedTrailingTokens);
  });

  test("watermark with measuredThroughEntryId=null: all items are trailing", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const branch = makeBranch(["A", "B", "C"]);
    meter.recordProviderUsage(30_000, null, "fp1");

    const snap = meter.snapshot(branch, "fp1", 0, 0);
    expect(snap.source).toBe("provider_usage");
    expect(snap.estimatedTrailingTokens).toBeGreaterThan(0);
  });

  test("watermark entry not in current branch: falls back to full estimate", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const branch = makeBranch(["A", "B"]);
    // Record watermark for entry that's not in branch
    meter.recordProviderUsage(30_000, "nonexistent-id", "fp1");

    const snap = meter.snapshot(branch, "fp1", 0, 0);
    expect(snap.source).toBe("provider_usage");
    expect(snap.estimatedTrailingTokens).toBeGreaterThan(0);
  });
});

describe("ContextMeter — fingerprint invalidation", () => {
  test("different fingerprint invalidates provider watermark", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const branch = makeBranch(["Hello"]);
    meter.recordProviderUsage(50_000, "e0", "fp1");

    // Different fingerprint (system prompt / tools changed)
    const snap = meter.snapshot(branch, "fp2", 1000, 500);
    expect(snap.source).toBe("estimated");
  });

  test("invalidateWatermark forces estimated source", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const branch = makeBranch(["Hello"]);
    meter.recordProviderUsage(50_000, "e0", "fp1");

    meter.invalidateWatermark();
    const snap = meter.snapshot(branch, "fp1", 0, 0);
    expect(snap.source).toBe("estimated");
    expect(snap.providerInputTokens).toBe(0);
  });

  test("invalidateWatermark clears watermark getter", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    meter.recordProviderUsage(50_000, "e0", "fp1");
    expect(meter.watermark).toBeDefined();

    meter.invalidateWatermark();
    expect(meter.watermark).toBeUndefined();
  });
});

describe("ContextMeter — snapshot fields", () => {
  test("snapshot includes contextWindow, maxOutputTokens, safetyReserveTokens", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const snap = meter.snapshot([], "fp", 0, 0);
    expect(snap.contextWindow).toBe(128_000);
    expect(snap.maxOutputTokens).toBe(16_384);
    expect(snap.safetyReserveTokens).toBe(8_192);
  });

  test("snapshot includes hardLimit", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const snap = meter.snapshot([], "fp", 0, 0);
    expect(snap.hardLimit).toBe(128_000 - 16_384 - 8_192);
  });

  test("snapshot includes systemPromptTokens and toolSchemaTokens", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const snap = meter.snapshot([], "fp", 2000, 800);
    expect(snap.systemPromptTokens).toBe(2000);
    expect(snap.toolSchemaTokens).toBe(800);
  });

  test("historicalTokens is non-negative", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const branch = makeBranch(["A", "B", "C"]);
    const snap = meter.snapshot(branch, "fp", 0, 0);
    expect(snap.historicalTokens).toBeGreaterThanOrEqual(0);
  });

  test("watermark is included in provider_usage snapshot", () => {
    const meter = new ContextMeter(128_000, 16_384, 8_192);
    const branch = makeBranch(["Hello"]);
    meter.recordProviderUsage(50_000, "e0", "fp1");
    const snap = meter.snapshot(branch, "fp1", 0, 0);
    expect(snap.watermark?.measuredThroughEntryId).toBe("e0");
    expect(snap.watermark?.requestFingerprint).toBe("fp1");
  });
});
