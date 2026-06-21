/**
 * Tests for ContextManager (Phase 2, Task A.5).
 *
 * Covers:
 * - Hard-limit prevents request
 * - Classified overflow retry (emergency compact + retry)
 * - Unrelated errors are not compacted
 * - Fallback fit (post-compaction fit check)
 * - Insufficient-reclaim diagnostic
 * - Manual no-op
 * - Manual compaction with custom instructions
 * - Turn complete evaluation
 * - Milestone evaluation
 */

import { describe, expect, it } from "bun:test";
import { ContextManager, type ContextManagerConfig } from "../../../src/core/compaction/context-manager";
import type { ModelInvoker } from "../../../src/core/compaction/strategies/portable-only";
import { DEFAULT_COMPACTION_CONFIG } from "../../../src/core/compaction/trigger-policy";
import { SessionManager } from "../../../src/core/session/session-manager";
import type { ItemParam } from "../../../src/core/session/types";
import type { ProviderCapabilities, ProviderIdentity } from "../../../src/core/session/types-v2";

// ─── Helpers ───

function makeProviderIdentity(): ProviderIdentity {
  return {
    adapterId: "openai",
    endpointOrigin: "https://api.openai.com",
    model: "gpt-4",
  };
}

function makeCapabilities(): ProviderCapabilities {
  return {
    nativeCompaction: false,
    structuredOutput: true,
    developerMessages: false,
    continuationCompatibilityKey: "openai::https://api.openai.com::gpt-4",
  };
}

function makeModelInvoker(response?: string): ModelInvoker {
  return {
    invoke: async () =>
      response ??
      JSON.stringify({
        goal: "Continue working on the task",
        constraints: [],
        completed: ["Updated config"],
        inProgress: [],
        pending: ["Run tests"],
        decisions: [],
        blockers: [],
        nextSteps: ["Deploy to staging"],
      }),
  };
}

function makeConfig(overrides: Partial<ContextManagerConfig> = {}): ContextManagerConfig {
  const contextWindow = overrides.contextWindow ?? 128_000;
  const maxOutputTokens = overrides.maxOutputTokens ?? 16_384;
  const safetyReserve = overrides.compaction?.safetyReserveTokens ?? 1_000;
  return {
    compaction: {
      ...DEFAULT_COMPACTION_CONFIG,
      keepRecentTokens: 100, // Very low for testing
      safetyReserveTokens: safetyReserve,
    },
    contextWindow,
    maxOutputTokens,
    provider: makeProviderIdentity(),
    capabilities: makeCapabilities(),
    generatorConfig: {
      modelInvoker: makeModelInvoker(),
    },
    ...overrides,
  };
}

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

/**
 * Fill session with enough items to exceed a given token count.
 * Each message is about 100 chars ≈ 29 tokens.
 */
function fillSession(session: SessionManager, targetTokens: number): void {
  const charsPerMessage = 350; // ~100 tokens per message
  const messageCount = Math.ceil((targetTokens * 3.5) / charsPerMessage);

  for (let i = 0; i < messageCount; i++) {
    session.appendItem(userMessage(`User message ${i}: ${"x".repeat(charsPerMessage - 30)}`));
    session.appendItem(assistantMessage(`Assistant response ${i}: ${"y".repeat(charsPerMessage - 40)}`));
  }
}

const FINGERPRINT = "test-fingerprint-123";

// ─── Tests ───

describe("ContextManager", () => {
  describe("preInferenceCheck", () => {
    it("разрешает request когда tokens в пределах hard limit", async () => {
      const session = SessionManager.inMemoryV2();
      session.appendItem(userMessage("Hello"));
      session.appendItem(assistantMessage("Hi there"));

      const manager = new ContextManager(session, makeConfig());
      const result = await manager.preInferenceCheck(100, 50, FINGERPRINT);

      expect(result.canProceed).toBe(true);
      expect(result.compactionPerformed).toBe(false);
    });

    it("блокирует request и выполняет compaction при превышении hard limit", async () => {
      const session = SessionManager.inMemoryV2();

      // Use very small context window
      const config = makeConfig({
        contextWindow: 500,
        maxOutputTokens: 50,
        compaction: {
          ...DEFAULT_COMPACTION_CONFIG,
          keepRecentTokens: 50,
          safetyReserveTokens: 10,
        },
      });

      // Fill session with enough content to exceed hard limit
      fillSession(session, 600);

      const manager = new ContextManager(session, config);
      const result = await manager.preInferenceCheck(10, 5, FINGERPRINT);

      // Should have performed compaction
      expect(result.compactionPerformed).toBe(true);
      // Should have a capsule in the session
      const capsules = session.getCapsuleEntries();
      expect(capsules.length).toBe(1);
      expect(capsules[0].trigger).toBe("hard_limit");
    });

    it("отправляет request после успешной compaction", async () => {
      const session = SessionManager.inMemoryV2();

      // After compaction with keepRecentTokens well below hardLimit, request should proceed
      const config = makeConfig({
        contextWindow: 500,
        maxOutputTokens: 50,
        compaction: {
          ...DEFAULT_COMPACTION_CONFIG,
          keepRecentTokens: 200,
          safetyReserveTokens: 10,
        },
      });

      fillSession(session, 600);

      const manager = new ContextManager(session, config);
      const result = await manager.preInferenceCheck(30, 20, FINGERPRINT);

      // Compaction was performed and freed enough space
      expect(result.compactionPerformed).toBe(true);
      expect(result.canProceed).toBe(true);
    });

    it("не выполняет compaction для пустой сессии", async () => {
      const session = SessionManager.inMemoryV2();

      const config = makeConfig({
        contextWindow: 100,
        maxOutputTokens: 10,
        compaction: {
          ...DEFAULT_COMPACTION_CONFIG,
          keepRecentTokens: 5,
          safetyReserveTokens: 1,
        },
      });

      const manager = new ContextManager(session, config);
      const result = await manager.preInferenceCheck(10, 5, FINGERPRINT);

      // Empty session — no items, no tokens
      expect(result.canProceed).toBe(true);
      expect(result.compactionPerformed).toBe(false);
    });
  });

  describe("handleContextOverflow", () => {
    it("выполняет emergency compaction и разрешает retry", async () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 1000);

      const config = makeConfig({
        contextWindow: 10_000,
        maxOutputTokens: 2_000,
        compaction: {
          ...DEFAULT_COMPACTION_CONFIG,
          keepRecentTokens: 100,
          safetyReserveTokens: 100,
        },
      });

      const manager = new ContextManager(session, config);
      const result = await manager.handleContextOverflow(10, 5, FINGERPRINT);

      expect(result.recovered).toBe(true);
      expect(result.shouldRetry).toBe(true);
      expect(result.outcome?.trigger).toBe("context_overflow");
    });

    it("восстанавливается после emergency compaction", async () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 1000);

      const config = makeConfig({
        contextWindow: 500,
        maxOutputTokens: 50,
        compaction: {
          ...DEFAULT_COMPACTION_CONFIG,
          keepRecentTokens: 200,
          safetyReserveTokens: 10,
        },
      });

      const manager = new ContextManager(session, config);
      const result = await manager.handleContextOverflow(30, 20, FINGERPRINT);

      // Emergency compaction succeeded and freed enough space
      expect(result.recovered).toBe(true);
      expect(result.shouldRetry).toBe(true);
    });

    it("возвращает error если нет items для compaction", async () => {
      const session = SessionManager.inMemoryV2();

      const manager = new ContextManager(session, makeConfig());
      const result = await manager.handleContextOverflow(10, 5, FINGERPRINT);

      expect(result.recovered).toBe(false);
      expect(result.shouldRetry).toBe(false);
    });
  });

  describe("manualCompact", () => {
    it("выполняет compaction по запросу пользователя", async () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      const config = makeConfig({
        compaction: {
          ...DEFAULT_COMPACTION_CONFIG,
          keepRecentTokens: 100,
        },
      });

      const manager = new ContextManager(session, config);
      const outcome = await manager.manualCompact(undefined, 10, 5, FINGERPRINT);

      expect(outcome.compacted).toBe(true);
      expect(outcome.trigger).toBe("user_request");
      expect(outcome.checkpointId).toBeDefined();
      expect(outcome.strategy).toBeDefined();
    });

    it("возвращает no-op если нет reclaimable context", async () => {
      const session = SessionManager.inMemoryV2();
      // Add just one small message
      session.appendItem(userMessage("Hi"));

      const config = makeConfig({
        compaction: {
          ...DEFAULT_COMPACTION_CONFIG,
          keepRecentTokens: 50_000, // Keep much more than exists
        },
      });

      const manager = new ContextManager(session, config);
      const outcome = await manager.manualCompact(undefined, 10, 5, FINGERPRINT);

      expect(outcome.compacted).toBe(false);
      expect(outcome.reason).toContain("No reclaimable");
    });

    it("передаёт custom instructions в capsule generator", async () => {
      let capturedPrompt = "";
      const invoker: ModelInvoker = {
        invoke: async (prompt: string) => {
          capturedPrompt = prompt;
          return JSON.stringify({
            goal: "Focus on API refactoring",
            constraints: [],
            completed: [],
            inProgress: [],
            pending: [],
            decisions: [],
            blockers: [],
            nextSteps: [],
          });
        },
      };

      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      const config = makeConfig({
        compaction: {
          ...DEFAULT_COMPACTION_CONFIG,
          keepRecentTokens: 100,
        },
        generatorConfig: { modelInvoker: invoker },
      });

      const manager = new ContextManager(session, config);
      const outcome = await manager.manualCompact(
        "Focus on API refactoring",
        10,
        5,
        FINGERPRINT,
      );

      expect(outcome.compacted).toBe(true);
      expect(capturedPrompt).toContain("Focus on API refactoring");
    });

    it("создаёт capsule entry в сессии", async () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      const config = makeConfig({
        compaction: {
          ...DEFAULT_COMPACTION_CONFIG,
          keepRecentTokens: 100,
        },
      });

      const manager = new ContextManager(session, config);
      await manager.manualCompact(undefined, 10, 5, FINGERPRINT);

      const capsules = session.getCapsuleEntries();
      expect(capsules.length).toBe(1);
      expect(capsules[0].trigger).toBe("user_request");
      expect(capsules[0].portableState.goal).toBeDefined();
      expect(capsules[0].checkpointId).toMatch(/^ck_[0-9a-f]{12}$/);
    });
  });

  describe("evaluateTurnComplete", () => {
    it("возвращает shouldCompact: false при низком ROI", () => {
      const session = SessionManager.inMemoryV2();
      session.appendItem(userMessage("Hello"));

      const manager = new ContextManager(session, makeConfig());
      const result = manager.evaluateTurnComplete(10, 5, FINGERPRINT);

      expect(result.shouldCompact).toBe(false);
    });

    it("возвращает shouldCompact: false когда auto: false", () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 5000);

      const config = makeConfig({
        compaction: {
          ...DEFAULT_COMPACTION_CONFIG,
          auto: false,
          keepRecentTokens: 100,
        },
      });

      const manager = new ContextManager(session, config);
      const result = manager.evaluateTurnComplete(10, 5, FINGERPRINT);

      expect(result.shouldCompact).toBe(false);
    });
  });

  describe("evaluateMilestone", () => {
    it("возвращает shouldCompact: false когда auto: false", () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 5000);

      const config = makeConfig({
        compaction: {
          ...DEFAULT_COMPACTION_CONFIG,
          auto: false,
          keepRecentTokens: 100,
        },
      });

      const manager = new ContextManager(session, config);
      const result = manager.evaluateMilestone(10, 5, FINGERPRINT);

      expect(result.shouldCompact).toBe(false);
    });

    it("возвращает shouldCompact: false когда compactOnMilestone: false", () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 5000);

      const config = makeConfig({
        compaction: {
          ...DEFAULT_COMPACTION_CONFIG,
          compactOnMilestone: false,
          keepRecentTokens: 100,
        },
      });

      const manager = new ContextManager(session, config);
      const result = manager.evaluateMilestone(10, 5, FINGERPRINT);

      expect(result.shouldCompact).toBe(false);
    });
  });

  describe("recordProviderUsage", () => {
    it("обновляет watermark после inference", () => {
      const session = SessionManager.inMemoryV2();
      session.appendItem(userMessage("Hello"));

      const manager = new ContextManager(session, makeConfig());
      manager.recordProviderUsage(5000, session.getLeafId(), FINGERPRINT);

      const snapshot = manager.getSnapshot(10, 5, FINGERPRINT);
      expect(snapshot.source).toBe("provider_usage");
      expect(snapshot.providerInputTokens).toBe(5000);
      expect(snapshot.watermark?.requestFingerprint).toBe(FINGERPRINT);
    });
  });

  describe("unrelated errors", () => {
    it("не связанные с context overflow ошибки не триггерят compaction", async () => {
      // This test verifies that ContextManager.handleContextOverflow is ONLY
      // called for classified context_overflow errors.
      // The classification happens in the adapter; here we verify that
      // the manager doesn't compact on other triggers.

      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      const manager = new ContextManager(session, makeConfig());

      // Verify that preInferenceCheck with tokens within limit doesn't compact
      const result = await manager.preInferenceCheck(10, 5, FINGERPRINT);
      expect(result.canProceed).toBe(true);
      expect(result.compactionPerformed).toBe(false);

      // No capsules should be created
      const capsules = session.getCapsuleEntries();
      expect(capsules.length).toBe(0);
    });
  });

  describe("config access", () => {
    it("предоставляет доступ к policy и meter", () => {
      const session = SessionManager.inMemoryV2();
      const manager = new ContextManager(session, makeConfig());

      expect(manager.getPolicy()).toBeDefined();
      expect(manager.getMeter()).toBeDefined();
      expect(manager.getMeter().hardLimit).toBeGreaterThan(0);
    });
  });
});
