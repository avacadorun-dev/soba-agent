/**
 * Collapse completed agent thoughts — store behavior tests.
 *
 * Covers the TuiStore event handling that backs the UI collapse feature:
 *  - streaming reasoning starts with streaming: true
 *  - completed reasoning (assistant_text_done) ends with streaming: false
 *  - assistant_message reasoning is created completed
 *  - a new agent activity (tool call, narration, message start, turn end)
 *    finalizes a still-streaming thought so it can collapse
 *  - finalization does not create duplicate reasoning on a later text_done
 */

import { beforeEach, describe, expect, test, vi } from "bun:test";
import type { AgentEvent } from "../../../../src/engine/turn/types";
import { isReasoningCollapsible } from "../../../../src/ui/terminal/interactive/lib/reasoning-collapse";
import { TuiStore } from "../../../../src/ui/terminal/interactive/model/tui-store";

function event(value: Record<string, unknown>): AgentEvent {
  return { ...value, timestamp: Date.now(), turnIndex: 1 } as unknown as AgentEvent;
}

function createStore(): TuiStore {
  return new TuiStore({
    cwd: process.cwd(),
    tokenBudget: 200000,
    contextWindow: 200000,
    theme: "graphite",
    toolNames: ["read", "write", "edit", "bash", "ls"],
    executeCommand: vi.fn() as any,
    agentLoop: {
      getModel: () => "test-model",
      getTrustManager: () => ({
        getTrust: (_tool: string) => "safe",
        isProjectTrusted: () => false,
        getPermissionMode: () => "ask" as const,
        setPermissionMode: (_mode: string) => {},
        clearSessionApprovals: () => {},
      }),
    } as any,
    i18n: { t: (k: string, _args?: Record<string, unknown>) => k, locale: "en" } as any,
    debug: false,
    maxOutputTokens: 0,
    maxCompletionTokens: 0,
    maxAgentIterations: 0,
    maxStalledIterations: 4,
    maxRunMinutes: 0,
    autoCompact: true,
  });
}

const LONG_THOUGHT = "Думаю над задачей. ".repeat(30); // well over the char threshold

describe("Collapse completed agent thoughts — store", () => {
  let store: TuiStore;

  beforeEach(() => {
    store = createStore();
  });

  test("streaming reasoning is marked streaming: true", () => {
    store.onAgentEvent(event({ type: "assistant_reasoning_delta", messageId: "m1", delta: "Думаю" }));
    const reasoning = store.messages().find((m) => m.type === "reasoning");
    expect(reasoning).toBeDefined();
    expect(reasoning?.type === "reasoning" && reasoning.streaming).toBe(true);
  });

  test("short completed thought stays expanded (not collapsible)", () => {
    store.onAgentEvent(event({ type: "assistant_reasoning_delta", messageId: "m1", delta: "Коротко." }));
    store.onAgentEvent(event({ type: "assistant_message_start", messageId: "m1" }));
    store.onAgentEvent(
      event({ type: "assistant_text_done", messageId: "m1", fullText: "Готово", reasoningContent: "Коротко." }),
    );
    const reasoning = store.messages().find((m) => m.type === "reasoning");
    expect(reasoning).toBeDefined();
    expect(reasoning?.type === "reasoning" && reasoning.streaming).toBe(false);
    expect(reasoning?.type === "reasoning" && isReasoningCollapsible(reasoning)).toBe(false);
  });

  test("long completed thought is completed and collapsible", () => {
    store.onAgentEvent(event({ type: "assistant_reasoning_delta", messageId: "m1", delta: LONG_THOUGHT }));
    store.onAgentEvent(event({ type: "assistant_message_start", messageId: "m1" }));
    store.onAgentEvent(
      event({ type: "assistant_text_done", messageId: "m1", fullText: "Готово", reasoningContent: LONG_THOUGHT }),
    );
    const reasoning = store.messages().find((m) => m.type === "reasoning");
    expect(reasoning?.type === "reasoning" && reasoning.streaming).toBe(false);
    expect(reasoning?.type === "reasoning" && isReasoningCollapsible(reasoning)).toBe(true);
  });

  test("a tool call finalizes a still-streaming thought", () => {
    store.onAgentEvent(event({ type: "assistant_reasoning_delta", messageId: "m1", delta: LONG_THOUGHT }));
    // Agent moves on to a tool call without an assistant_text_done for this thought.
    store.onAgentEvent(
      event({ type: "tool_call_start", toolCallId: "t1", toolName: "read", args: { path: "file.ts" } }),
    );

    const reasoning = store.messages().find((m) => m.type === "reasoning");
    expect(reasoning?.type === "reasoning" && reasoning.streaming).toBe(false);
    expect(reasoning?.type === "reasoning" && isReasoningCollapsible(reasoning)).toBe(true);
  });

  test("working narration finalizes a still-streaming thought", () => {
    store.onAgentEvent(event({ type: "assistant_reasoning_delta", messageId: "m1", delta: LONG_THOUGHT }));
    store.onAgentEvent(
      event({ type: "working_narration", eventType: "plan", message: "Working on it", evidenceIds: [] }),
    );
    const reasoning = store.messages().find((m) => m.type === "reasoning");
    expect(reasoning?.type === "reasoning" && reasoning.streaming).toBe(false);
  });

  test("plan_update finalizes a still-streaming thought", () => {
    store.onAgentEvent(event({ type: "assistant_reasoning_delta", messageId: "m1", delta: LONG_THOUGHT }));
    store.onAgentEvent(
      event({
        type: "plan_update",
        entries: [{ content: "Inspect ACP adapter", priority: "high", status: "in_progress" }],
      }),
    );

    const reasoning = store.messages().find((m) => m.type === "reasoning");
    expect(reasoning?.type === "reasoning" && reasoning.streaming).toBe(false);
    expect(reasoning?.type === "reasoning" && isReasoningCollapsible(reasoning)).toBe(true);
  });

  test("assistant_message_start finalizes a still-streaming thought", () => {
    store.onAgentEvent(event({ type: "assistant_reasoning_delta", messageId: "m1", delta: LONG_THOUGHT }));
    store.onAgentEvent(event({ type: "assistant_message_start", messageId: "m1" }));
    const reasoning = store.messages().find((m) => m.type === "reasoning");
    expect(reasoning?.type === "reasoning" && reasoning.streaming).toBe(false);
  });

  test("turn_end finalizes a still-streaming thought and clears the map", () => {
    store.onAgentEvent(event({ type: "assistant_reasoning_delta", messageId: "m1", delta: LONG_THOUGHT }));
    store.onAgentEvent(event({ type: "turn_end" }));
    const reasoning = store.messages().find((m) => m.type === "reasoning");
    expect(reasoning?.type === "reasoning" && reasoning.streaming).toBe(false);
  });

  test("finalization does not duplicate reasoning on a later text_done", () => {
    store.onAgentEvent(event({ type: "assistant_reasoning_delta", messageId: "m1", delta: LONG_THOUGHT }));
    store.onAgentEvent(event({ type: "assistant_message_start", messageId: "m1" }));
    store.onAgentEvent(
      event({ type: "assistant_text_done", messageId: "m1", fullText: "Готово", reasoningContent: LONG_THOUGHT }),
    );
    const reasoning = store.messages().filter((m) => m.type === "reasoning");
    expect(reasoning.length).toBe(1);
    expect(reasoning[0].type === "reasoning" && reasoning[0].streaming).toBe(false);
  });

  test("assistant_message with reasoningContent creates a completed thought", () => {
    store.onAgentEvent(event({ type: "assistant_message", messageId: "m1", text: "Готово", reasoningContent: LONG_THOUGHT }));
    const reasoning = store.messages().find((m) => m.type === "reasoning");
    expect(reasoning).toBeDefined();
    expect(reasoning?.type === "reasoning" && reasoning.streaming).toBe(false);
    expect(reasoning?.type === "reasoning" && isReasoningCollapsible(reasoning)).toBe(true);
  });

  test("dangerous_confirmation finalizes a still-streaming thought", () => {
    store.onAgentEvent(event({ type: "assistant_reasoning_delta", messageId: "m1", delta: LONG_THOUGHT }));
    store.onAgentEvent(
      event({
        type: "dangerous_confirmation",
        toolName: "bash",
        description: "rm file",
        reason: "destructive",
        args: {},
        confirmationId: "c1",
      }),
    );
    const reasoning = store.messages().find((m) => m.type === "reasoning");
    expect(reasoning?.type === "reasoning" && reasoning.streaming).toBe(false);
  });
});
