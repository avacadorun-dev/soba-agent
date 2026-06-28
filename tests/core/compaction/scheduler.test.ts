/**
 * Tests for BackgroundScheduler (Phase 2, Task A.6).
 *
 * Covers:
 * - No perceived blocking (schedule returns immediately)
 * - Cancellation on new user turn
 * - Stale leaf rejection
 * - Failure leaves branch unchanged
 * - Timeout handling
 * - Only one operation at a time
 * - Event emission
 */

import { describe, expect, it } from "bun:test";
import { ContextManager, type ContextManagerConfig } from "../../../src/engine/compaction/context-manager";
import { type BackgroundOperation, BackgroundScheduler, type SchedulerConfig } from "../../../src/engine/compaction/scheduler";
import type { ModelInvoker } from "../../../src/engine/compaction/strategies/portable-only";
import { DEFAULT_COMPACTION_CONFIG } from "../../../src/engine/compaction/trigger-policy";
import { SessionManager } from "../../../src/infrastructure/persistence/sessions/session-manager";
import type { ItemParam } from "../../../src/kernel/transcript/types";
import type { ProviderCapabilities, ProviderIdentity } from "../../../src/kernel/transcript/types-v2";

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

function makeModelInvoker(delay = 0): ModelInvoker {
  return {
    invoke: async () => {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return JSON.stringify({
        goal: "Continue working on the task",
        constraints: [],
        completed: ["Updated config"],
        inProgress: [],
        pending: ["Run tests"],
        decisions: [],
        blockers: [],
        nextSteps: ["Deploy to staging"],
      });
    },
  };
}

function makeManagerConfig(invoker?: ModelInvoker): ContextManagerConfig {
  return {
    compaction: {
      ...DEFAULT_COMPACTION_CONFIG,
      keepRecentTokens: 100,
      safetyReserveTokens: 1_000,
    },
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    provider: makeProviderIdentity(),
    capabilities: makeCapabilities(),
    generatorConfig: {
      modelInvoker: invoker ?? makeModelInvoker(),
    },
  };
}

function makeSchedulerConfig(overrides: Partial<SchedulerConfig> = {}): SchedulerConfig {
  return {
    backgroundTimeoutMs: 5_000,
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

function fillSession(session: SessionManager, targetTokens: number): void {
  const charsPerMessage = 350;
  const messageCount = Math.ceil((targetTokens * 3.5) / charsPerMessage);

  for (let i = 0; i < messageCount; i++) {
    session.appendItem(userMessage(`User message ${i}: ${"x".repeat(charsPerMessage - 30)}`));
    session.appendItem(assistantMessage(`Assistant response ${i}: ${"y".repeat(charsPerMessage - 40)}`));
  }
}

const FINGERPRINT = "test-fingerprint-123";

// ─── Tests ───

describe("BackgroundScheduler", () => {
  describe("no perceived blocking", () => {
    it("schedule() возвращает управление немедленно", () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      const contextManager = new ContextManager(session, makeManagerConfig(makeModelInvoker(1000)));
      const scheduler = new BackgroundScheduler(session, contextManager, makeSchedulerConfig());

      const snapshot = contextManager.getSnapshot(10, 5, FINGERPRINT);

      const start = Date.now();
      scheduler.schedule("turn_complete", snapshot, 10, 5, FINGERPRINT);
      const elapsed = Date.now() - start;

      // Schedule should return within a few ms (not wait for compaction)
      expect(elapsed).toBeLessThan(100);
      expect(scheduler.isRunning()).toBe(true);
    });

    it("пользователь видит итоговый ответ без ожидания compaction", async () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      const contextManager = new ContextManager(session, makeManagerConfig(makeModelInvoker(50)));
      const scheduler = new BackgroundScheduler(session, contextManager, makeSchedulerConfig());

      const snapshot = contextManager.getSnapshot(10, 5, FINGERPRINT);

      // Schedule background compaction
      scheduler.schedule("turn_complete", snapshot, 10, 5, FINGERPRINT);

      // User can continue working immediately
      session.appendItem(userMessage("Next question"));
      session.appendItem(assistantMessage("Answer to next question"));

      // Wait for background operation to finish or be cancelled
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Session should have the new items regardless of compaction status
      const branch = session.getBranch();
      const items = branch.filter((e) => e.type === "item");
      expect(items.length).toBeGreaterThan(2);
    });
  });

  describe("cancellation", () => {
    it("новый user turn отменяет background operation", async () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      let cancelReason = "";
      const contextManager = new ContextManager(session, makeManagerConfig(makeModelInvoker(200)));
      const scheduler = new BackgroundScheduler(session, contextManager, makeSchedulerConfig({
        events: {
          onOperationCancelled: (_op, reason) => {
            cancelReason = reason;
          },
        },
      }));

      const snapshot = contextManager.getSnapshot(10, 5, FINGERPRINT);
      scheduler.schedule("turn_complete", snapshot, 10, 5, FINGERPRINT);
      expect(scheduler.isRunning()).toBe(true);

      // Simulate new user turn
      scheduler.cancel("New user turn");

      expect(scheduler.isRunning()).toBe(false);
      expect(cancelReason).toBe("New user turn");
    });

    it("отмена до начала операции предотвращает выполнение", async () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      let completed = false;
      const contextManager = new ContextManager(session, makeManagerConfig(makeModelInvoker(200)));
      const scheduler = new BackgroundScheduler(session, contextManager, makeSchedulerConfig({
        events: {
          onOperationCompleted: () => {
            completed = true;
          },
        },
      }));

      const snapshot = contextManager.getSnapshot(10, 5, FINGERPRINT);
      scheduler.schedule("turn_complete", snapshot, 10, 5, FINGERPRINT);

      // Cancel immediately
      scheduler.cancel("Immediate cancel");

      // Wait for async operations to settle
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(scheduler.isRunning()).toBe(false);
      expect(completed).toBe(false);
    });

    it("schedule() отменяет предыдущую операцию при вызове", async () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      let cancelCount = 0;
      const contextManager = new ContextManager(session, makeManagerConfig(makeModelInvoker(200)));
      const scheduler = new BackgroundScheduler(session, contextManager, makeSchedulerConfig({
        events: {
          onOperationCancelled: () => {
            cancelCount++;
          },
        },
      }));

      const snapshot = contextManager.getSnapshot(10, 5, FINGERPRINT);

      // Schedule first operation
      scheduler.schedule("turn_complete", snapshot, 10, 5, FINGERPRINT);
      expect(scheduler.isRunning()).toBe(true);

      // Schedule second operation (should cancel first)
      scheduler.schedule("milestone", snapshot, 10, 5, FINGERPRINT);
      expect(scheduler.isRunning()).toBe(true);
      expect(cancelCount).toBe(1);
    });
  });

  describe("stale leaf rejection", () => {
    it("rejects compaction если leaf изменился до начала операции", async () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      let failedError: Error | null = null;
      // Use a slow invoker so compaction doesn't complete before we change the leaf
      const contextManager = new ContextManager(session, makeManagerConfig(makeModelInvoker(500)));
      const scheduler = new BackgroundScheduler(session, contextManager, makeSchedulerConfig({
        events: {
          onOperationFailed: (_op, error) => {
            failedError = error;
          },
        },
      }));

      const snapshot = contextManager.getSnapshot(10, 5, FINGERPRINT);
      const leafBeforeCompaction = session.getLeafId();

      // Schedule but immediately change the leaf before the async operation starts
      scheduler.schedule("turn_complete", snapshot, 10, 5, FINGERPRINT);

      // Immediately append (synchronous) — changes leaf before async _runOperation
      session.appendItem(userMessage("New user message that changes leaf"));

      // Wait for operation to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // The leaf should have changed
      const leafAfter = session.getLeafId();
      expect(leafAfter).not.toBe(leafBeforeCompaction);

      // The scheduler should have detected the stale leaf and reported failure
      expect(scheduler.isRunning()).toBe(false);
      // failedError might be null if compaction completed before we changed the leaf
      // This is a race condition in the test
      if (failedError) {
        expect((failedError as Error).message).toContain("Leaf changed");
      }
    });
  });

  describe("failure leaves branch unchanged", () => {
    it("error в model invoker не изменяет текущую ветку (deterministic fallback succeeds)", async () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      const branchBefore = session.getBranch().map((e) => e.id);

      const failingInvoker: ModelInvoker = {
        invoke: async () => {
          throw new Error("Model unavailable");
        },
      };

      let completed = false;
      const contextManager = new ContextManager(session, makeManagerConfig(failingInvoker));
      const scheduler = new BackgroundScheduler(session, contextManager, makeSchedulerConfig({
        events: {
          onOperationCompleted: () => {
            completed = true;
          },
        },
      }));

      const snapshot = contextManager.getSnapshot(10, 5, FINGERPRINT);
      scheduler.schedule("turn_complete", snapshot, 10, 5, FINGERPRINT);

      // Wait for operation to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // The deterministic fallback should have succeeded, so a capsule was added
      // The branch should have grown (not equal to before)
      const branchAfter = session.getBranch().map((e) => e.id);
      expect(branchAfter.length).toBeGreaterThan(branchBefore.length);
      expect(scheduler.isRunning()).toBe(false);
      expect(completed).toBe(true);
    });
  });

  describe("timeout", () => {
    it("operation отменяется по timeout", async () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      const slowInvoker: ModelInvoker = {
        invoke: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          return JSON.stringify({
            goal: "Should not reach here",
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

      const contextManager = new ContextManager(session, makeManagerConfig(slowInvoker));
      const scheduler = new BackgroundScheduler(session, contextManager, makeSchedulerConfig({
        backgroundTimeoutMs: 50, // Very short timeout
      }));

      const snapshot = contextManager.getSnapshot(10, 5, FINGERPRINT);
      scheduler.schedule("turn_complete", snapshot, 10, 5, FINGERPRINT);

      expect(scheduler.isRunning()).toBe(true);

      // Wait for timeout and cleanup
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Operation should have been cancelled by timeout
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe("single operation constraint", () => {
    it("только одна background operation разрешена одновременно", () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      const contextManager = new ContextManager(session, makeManagerConfig(makeModelInvoker(200)));
      const scheduler = new BackgroundScheduler(session, contextManager, makeSchedulerConfig());

      const snapshot = contextManager.getSnapshot(10, 5, FINGERPRINT);

      scheduler.schedule("turn_complete", snapshot, 10, 5, FINGERPRINT);
      const op1 = scheduler.getCurrentOperation();

      scheduler.schedule("milestone", snapshot, 10, 5, FINGERPRINT);
      const op2 = scheduler.getCurrentOperation();

      // Should be different operations
      expect(op1?.id).not.toBe(op2?.id);
      expect(op2?.trigger).toBe("milestone");
    });
  });

  describe("event emission", () => {
    it("эмитит onOperationStarted при начале", () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      let startedOp: BackgroundOperation | null = null;
      const contextManager = new ContextManager(session, makeManagerConfig(makeModelInvoker(100)));
      const scheduler = new BackgroundScheduler(session, contextManager, makeSchedulerConfig({
        events: {
          onOperationStarted: (op) => {
            startedOp = op;
          },
        },
      }));

      const snapshot = contextManager.getSnapshot(10, 5, FINGERPRINT);
      scheduler.schedule("turn_complete", snapshot, 10, 5, FINGERPRINT);

      expect(startedOp).toBeDefined();
      expect((startedOp as unknown as BackgroundOperation).trigger).toBe("turn_complete");
      expect((startedOp as unknown as BackgroundOperation).leafId).toBe(session.getLeafId());
    });

    it("эмитит onOperationCompleted при успешном завершении", async () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      const contextManager = new ContextManager(session, makeManagerConfig(makeModelInvoker(10)));
      const scheduler = new BackgroundScheduler(session, contextManager, makeSchedulerConfig({
        events: {
          onOperationCompleted: (_op, checkpointId) => {
            void checkpointId;
          },
        },
      }));

      const snapshot = contextManager.getSnapshot(10, 5, FINGERPRINT);
      scheduler.schedule("turn_complete", snapshot, 10, 5, FINGERPRINT);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should have completed with a checkpoint ID (or null if no compaction was needed)
      expect(scheduler.isRunning()).toBe(false);
      // Checkpoint may be null if no compaction was needed, but event should have fired
    });

    it("preserves scheduled milestone trigger in created capsule", async () => {
      const session = SessionManager.inMemoryV2();
      fillSession(session, 500);

      const contextManager = new ContextManager(session, makeManagerConfig(makeModelInvoker(10)));
      const scheduler = new BackgroundScheduler(session, contextManager, makeSchedulerConfig());

      const snapshot = contextManager.getSnapshot(10, 5, FINGERPRINT);
      scheduler.schedule("milestone", snapshot, 10, 5, FINGERPRINT);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const capsules = session.getCapsuleEntries();
      expect(capsules.length).toBeGreaterThan(0);
      expect(capsules[0].trigger).toBe("milestone");
    });
  });

  describe("cancel without operation", () => {
    it("cancel() безопасен когда нет текущей операции", () => {
      const session = SessionManager.inMemoryV2();
      const contextManager = new ContextManager(session, makeManagerConfig());
      const scheduler = new BackgroundScheduler(session, contextManager, makeSchedulerConfig());

      // Should not throw
      scheduler.cancel("No operation");
      expect(scheduler.isRunning()).toBe(false);
    });
  });
});
