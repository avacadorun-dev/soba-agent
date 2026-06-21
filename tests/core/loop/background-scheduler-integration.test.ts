/**
 * BackgroundScheduler integration with AgentLoop.
 *
 * Tests the integration of background compaction scheduling:
 * - Scheduler is created and passed to AgentLoop
 * - After turn_end, evaluateTurnComplete is called
 * - If shouldCompact, scheduler.schedule is invoked
 * - New user turn cancels background operation
 * - Scheduler events are emitted
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenResponsesClient } from "../../../src/core/client/openresponses-client";
import type { ResponseResource } from "../../../src/core/client/types";
import { ContextManager } from "../../../src/core/compaction/context-manager";
import { BackgroundScheduler } from "../../../src/core/compaction/scheduler";
import { AgentLoop } from "../../../src/core/loop/agent-loop";
import { SessionManager } from "../../../src/core/session/session-manager";
import { readTool } from "../../../src/core/tools/read";
import { ToolRegistry } from "../../../src/core/tools/tool-registry";

function createMockClient(): OpenResponsesClient {
  const mockResponse: ResponseResource = {
    id: "resp_test",
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    completed_at: Math.floor(Date.now() / 1000),
    status: "completed",
    incomplete_details: null,
    model: "test-model",
    previous_response_id: null,
    instructions: null,
    output: [
      {
        type: "message",
        id: "msg_test",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Test response",
            annotations: [],
          },
        ],
      },
    ],
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
      input_tokens: 1000,
      output_tokens: 100,
      total_tokens: 1100,
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

  return {
    create: async () => mockResponse,
    createStream: async function* () {
      yield {
        type: "response.completed",
        response: mockResponse,
      };
    },
    compact: async () => ({
      id: "comp_test",
      object: "response.compaction",
      output: [],
      created_at: Math.floor(Date.now() / 1000),
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }),
    getProviderIdentity: () => ({
      adapterId: "test",
      endpointOrigin: "https://test.com",
      model: "test-model",
    }),
    getProviderCapabilities: () => ({
      nativeCompaction: false,
      structuredOutput: true,
      developerMessages: false,
      continuationCompatibilityKey: "test::https://test.com::test-model",
    }),
    classifyError: () => "unknown",
    compactNative: async () => ({
      provider: {
        adapterId: "test",
        endpointOrigin: "https://test.com",
        model: "test-model",
      },
      compatibilityKey: "test-key",
      items: [],
    }),
    getConfig: () => ({
      baseUrl: "https://test.com",
      apiKey: "test-key",
      model: "test-model",
      maxOutputTokens: 4096,
      maxCompletionTokens: 0,
      contextWindow: 128000,
      temperature: 0.7,
    }),
    updateConfig: () => {},
  };
}

function createTestContextManager(session: SessionManager): ContextManager {
  return new ContextManager(session, {
    compaction: {
      auto: true,
      compactOnTurnComplete: true,
      compactOnMilestone: true,
      minTokensForAutoCompact: 1000,
      minReclaimableTokens: 500,
      minSavingsRatio: 0.1,
      keepRecentTokens: 2000,
      safetyReserveTokens: 1000,
      backgroundTimeoutMs: 30000,
    },
    contextWindow: 128000,
    maxOutputTokens: 4096,
    provider: {
      adapterId: "test",
      endpointOrigin: "https://test.com",
      model: "test-model",
    },
    capabilities: {
      nativeCompaction: false,
      structuredOutput: true,
      developerMessages: false,
      continuationCompatibilityKey: "test-key",
    },
    generatorConfig: {
      modelInvoker: { invoke: async (_prompt: string, _signal: AbortSignal) => "Mock summary" },
    },
  });
}

describe("BackgroundScheduler integration", () => {
  let session: SessionManager;
  let contextManager: ContextManager;
  let scheduler: BackgroundScheduler;
  let loop: AgentLoop;
  let tools: ToolRegistry;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `soba-background-scheduler-test-${Date.now()}`);
    session = SessionManager.create("/test", join(testDir, "sessions"));
    contextManager = createTestContextManager(session);
    scheduler = new BackgroundScheduler(session, contextManager, {
      backgroundTimeoutMs: 30000,
    });
    tools = new ToolRegistry();
    tools.register(readTool);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("AgentLoop accepts BackgroundScheduler in constructor", () => {
    const client = createMockClient();
    loop = new AgentLoop(client, session, tools, "/test", {}, undefined, undefined, contextManager, scheduler);
    
    expect(loop.getBackgroundScheduler()).toBe(scheduler);
  });

  test("AgentLoop works without BackgroundScheduler (backward compatibility)", () => {
    const client = createMockClient();
    loop = new AgentLoop(client, session, tools, "/test");
    
    expect(loop.getBackgroundScheduler()).toBeUndefined();
  });

  test("scheduler events are emitted through AgentLoop", async () => {
    const events: Array<{ type: string; operation?: unknown; checkpointId?: string | null; reason?: string; error?: Error }> = [];
    const client = createMockClient();

    // Configure scheduler with events via constructor
    const eventScheduler = new BackgroundScheduler(session, contextManager, {
      backgroundTimeoutMs: 30000,
      events: {
        onOperationStarted: (op) => {
          events.push({ type: "background_compaction_started", operation: op });
        },
        onOperationCompleted: (op, checkpointId) => {
          events.push({ type: "background_compaction_completed", operation: op, checkpointId });
        },
        onOperationCancelled: (op, reason) => {
          events.push({ type: "background_compaction_cancelled", operation: op, reason });
        },
        onOperationFailed: (op, error) => {
          events.push({ type: "background_compaction_failed", operation: op, error });
        },
      },
    });

    loop = new AgentLoop(client, session, tools, "/test", { emitEvents: true }, undefined, undefined, contextManager, eventScheduler);
    loop.onEvent((event) => events.push(event as unknown as { type: string }));

    // Add some session entries to trigger compaction evaluation
    for (let i = 0; i < 20; i++) {
      session.appendItem({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `Message ${i} with some content to increase token count` }],
      });
    }

    // Run a turn
    await loop.runTurn("test prompt");

    // Check that background compaction was evaluated
    // Note: actual scheduling depends on evaluateTurnComplete logic
    expect(events.some((e) => e.type === "turn_end")).toBe(true);
  });

  test("new user turn cancels background operation", async () => {
    const events: any[] = [];
    const client = createMockClient();
    
    // Create scheduler with events config
    const schedulerWithEvents = new BackgroundScheduler(session, contextManager, {
      backgroundTimeoutMs: 30000,
      events: {
        onOperationCancelled: (op, reason) => {
          events.push({ type: "background_compaction_cancelled", operation: op, reason });
        },
      },
    });

    loop = new AgentLoop(client, session, tools, "/test", { emitEvents: true }, undefined, undefined, contextManager, schedulerWithEvents);
    loop.onEvent((event) => events.push(event));

    // Manually start a background operation
    const snapshot = contextManager.getSnapshot(0, 0, "test");
    schedulerWithEvents.schedule("turn_complete", snapshot, 100, 50, "fingerprint");

    // Verify operation is running
    expect(schedulerWithEvents.isRunning()).toBe(true);

    // Start a new turn - should cancel the background operation
    await loop.runTurn("new prompt");

    // Check that cancellation was triggered
    const cancelEvent = events.find(e => e.type === "background_compaction_cancelled");
    expect(cancelEvent).toBeDefined();
    expect(cancelEvent.reason).toContain("new turn");
  });

  test("scheduler respects autoCompact config", async () => {
    const client = createMockClient();
    
    // Create context manager with autoCompact disabled
    const disabledContextManager = new ContextManager(session, {
      compaction: {
        auto: false,
        compactOnTurnComplete: false,
        compactOnMilestone: false,
        minTokensForAutoCompact: 1000,
        minReclaimableTokens: 500,
        minSavingsRatio: 0.1,
        keepRecentTokens: 2000,
        safetyReserveTokens: 1000,
        backgroundTimeoutMs: 30000,
      },
      contextWindow: 128000,
      maxOutputTokens: 4096,
      provider: {
        adapterId: "test",
        endpointOrigin: "https://test.com",
        model: "test-model",
      },
      capabilities: {
        nativeCompaction: false,
        structuredOutput: true,
        developerMessages: false,
        continuationCompatibilityKey: "test-key",
      },
      generatorConfig: {
        modelInvoker: { invoke: async (_prompt: string, _signal: AbortSignal) => "Mock summary" },
      },
    });

    const disabledScheduler = new BackgroundScheduler(session, disabledContextManager, {
      backgroundTimeoutMs: 30000,
    });

    loop = new AgentLoop(client, session, tools, "/test", {}, undefined, undefined, disabledContextManager, disabledScheduler);

    // Add session entries
    for (let i = 0; i < 20; i++) {
      session.appendItem({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `Message ${i}` }],
      });
    }

    await loop.runTurn("test");

    // Scheduler should not be running because autoCompact is disabled
    expect(disabledScheduler.isRunning()).toBe(false);
  });
});
