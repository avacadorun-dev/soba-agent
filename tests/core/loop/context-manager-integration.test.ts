/**
 * ContextManager integration with AgentLoop.
 *
 * Covers plan I.2:
 * - ContextManager creation and passing to AgentLoop
 * - Pre-inference check before each inference call
 * - Context overflow error handling and recovery
 * - Compaction events emission
 */

import { describe, expect, mock, test } from "bun:test";
import type { OpenResponsesClient } from "../../../src/core/client/openresponses-client";
import type { ResponseResource } from "../../../src/core/client/types";
import { ContextManager } from "../../../src/core/compaction/context-manager";
import type { CompactionConfig } from "../../../src/core/compaction/trigger-policy";
import { DEFAULT_COMPACTION_CONFIG } from "../../../src/core/compaction/trigger-policy";
import { AgentLoop } from "../../../src/core/loop/agent-loop";

import { SessionManager } from "../../../src/core/session/session-manager";
import type { ProviderCapabilities, ProviderIdentity } from "../../../src/core/session/types-v2";
import { readTool } from "../../../src/core/tools/read";
import { ToolRegistry } from "../../../src/core/tools/tool-registry";

// ─── Mock Client ───

function createMockClient(options?: {
  shouldOverflow?: boolean;
  overflowOnce?: boolean;
}): OpenResponsesClient {
  let callCount = 0;
  const shouldOverflow = options?.shouldOverflow ?? false;
  const overflowOnce = options?.overflowOnce ?? false;

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
    create: mock(async () => {
      callCount++;
      if (shouldOverflow) {
        if (overflowOnce && callCount > 1) {
          return mockResponse;
        }
        const error = new Error("context_length_exceeded");
        (error as any).status = 400;
        (error as any).code = "context_length_exceeded";
        throw error;
      }
      return mockResponse;
    }),
    createStream: mock(async function* () {
      yield {
        type: "response.completed" as const,
        response: mockResponse,
      };
    }),
    compact: mock(async () => ({
      id: "comp_test",
      object: "response.compaction" as const,
      output: [],
      created_at: Math.floor(Date.now() / 1000),
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    })),
    getProviderIdentity: mock(() => ({
      adapterId: "test",
      endpointOrigin: "https://test.com",
      model: "test-model",
    })),
    getProviderCapabilities: mock(() => ({
      nativeCompaction: false,
      structuredOutput: true,
      developerMessages: false,
      continuationCompatibilityKey: "test::https://test.com::test-model",
    })),
    classifyError: mock((error: any) => {
      if (error?.code === "context_length_exceeded" || error?.message?.includes("context_length")) {
        return "context_overflow";
      }
      return "unknown";
    }),
    compactNative: mock(async () => ({
      provider: {
        adapterId: "test",
        endpointOrigin: "https://test.com",
        model: "test-model",
      },
      compatibilityKey: "test-key",
      items: [],
    })),
    getConfig: mock(() => ({
      baseUrl: "https://test.com",
      apiKey: "test-key",
      model: "test-model",
      maxOutputTokens: 4096,
      maxCompletionTokens: 0,
      contextWindow: 128000,
      temperature: 0.7,
    })),
    updateConfig: mock(() => {}),
  };
}

// ─── Helper: Create ContextManager with minimal config ───

function createTestContextManager(
  session: SessionManager,
  overrides?: Partial<CompactionConfig>,
): ContextManager {
  const compactionConfig: CompactionConfig = {
    ...DEFAULT_COMPACTION_CONFIG,
    ...overrides,
  };

  const identity: ProviderIdentity = {
    adapterId: "test",
    endpointOrigin: "https://test.com",
    model: "test-model",
  };

  const capabilities: ProviderCapabilities = {
    nativeCompaction: false,
    structuredOutput: true,
    developerMessages: false,
    continuationCompatibilityKey: "test-key",
  };

  return new ContextManager(session, {
    compaction: compactionConfig,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    provider: identity,
    capabilities,
    generatorConfig: {
      modelInvoker: {
        invoke: async () => "Mock summary",
      },
    },
  });
}

// ─── Tests ───

describe("ContextManager integration with AgentLoop", () => {
  test("AgentLoop accepts contextManager in constructor", () => {
    const session = SessionManager.inMemory("/test");
    const client = createMockClient();
    const tools = new ToolRegistry();
    tools.register(readTool);
    const contextManager = createTestContextManager(session);

    const loop = new AgentLoop(client, session, tools, "/test", {}, undefined, undefined, contextManager);

    expect(loop).toBeDefined();
    expect(loop.getContextManager()).toBe(contextManager);
  });

  test("AgentLoop works without contextManager (backward compatibility)", () => {
    const session = SessionManager.inMemory("/test");
    const client = createMockClient();
    const tools = new ToolRegistry();
    tools.register(readTool);

    const loop = new AgentLoop(client, session, tools, "/test");

    expect(loop).toBeDefined();
    expect(loop.getContextManager()).toBeUndefined();
  });

  test("pre-inference check allows request when within hard limit", async () => {
    const session = SessionManager.inMemory("/test");
    const client = createMockClient();
    const tools = new ToolRegistry();
    tools.register(readTool);
    const contextManager = createTestContextManager(session);

    const loop = new AgentLoop(
      client,
      session,
      tools,
      "/test",
      { emitEvents: true },
      undefined,
      undefined,
      contextManager,
    );

    const events: any[] = [];
    loop.onEvent((event) => events.push(event));

    await loop.runTurn("Hello");

    // Should complete successfully
    expect(events.some((e) => e.type === "turn_end")).toBe(true);
    // Should NOT emit context_error
    expect(events.some((e) => e.type === "context_error")).toBe(false);
  });

  test("context overflow error triggers recovery and retry", async () => {
    const session = SessionManager.inMemory("/test");
    const client = createMockClient({ shouldOverflow: true, overflowOnce: true });
    const tools = new ToolRegistry();
    tools.register(readTool);
    const contextManager = createTestContextManager(session, {
      keepRecentTokens: 1000, // Small to allow compaction
    });

    const loop = new AgentLoop(
      client,
      session,
      tools,
      "/test",
      { emitEvents: true },
      undefined,
      undefined,
      contextManager,
    );

    const events: any[] = [];
    loop.onEvent((event) => events.push(event));

    await loop.runTurn("Hello");

    // Should emit compaction_start and compaction_done for recovery
    expect(events.some((e) => e.type === "compaction_start")).toBe(true);
    expect(events.some((e) => e.type === "compaction_done")).toBe(true);
    // Should complete successfully after retry
    expect(events.some((e) => e.type === "turn_end")).toBe(true);
  });

  test("context overflow recovery failure emits context_error", async () => {
    const session = SessionManager.inMemory("/test");
    const client = createMockClient({ shouldOverflow: true, overflowOnce: false });
    const tools = new ToolRegistry();
    tools.register(readTool);
    const contextManager = createTestContextManager(session);

    const loop = new AgentLoop(
      client,
      session,
      tools,
      "/test",
      { emitEvents: true },
      undefined,
      undefined,
      contextManager,
    );

    const events: any[] = [];
    loop.onEvent((event) => events.push(event));

    await loop.runTurn("Hello");

    // Should emit context_error when recovery fails
    expect(events.some((e) => e.type === "context_error")).toBe(true);
    // Should emit turn_stop_reason with api-error
    expect(events.some((e) => e.type === "turn_stop_reason" && e.reason === "api-error")).toBe(true);
  });

  test("recordProviderUsage updates ContextMeter after successful inference", async () => {
    const session = SessionManager.inMemory("/test");
    const client = createMockClient();
    const tools = new ToolRegistry();
    tools.register(readTool);
    const contextManager = createTestContextManager(session);

    const loop = new AgentLoop(
      client,
      session,
      tools,
      "/test",
      { emitEvents: true },
      undefined,
      undefined,
      contextManager,
    );

    await loop.runTurn("Hello");

    // Verify that provider usage was recorded
    const snapshot = contextManager.getSnapshot(0, 0, "test-fingerprint");
    expect(snapshot.effectiveTokens).toBeGreaterThan(0);
  });
});
