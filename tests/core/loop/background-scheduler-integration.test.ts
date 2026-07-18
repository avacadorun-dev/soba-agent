import { describe, expect, test } from "bun:test";
import { ContextManager } from "../../../src/engine/compaction/context-manager";
import { BackgroundScheduler } from "../../../src/engine/compaction/scheduler";
import { AgentLoop } from "../../../src/engine/turn/agent-loop";
import { SessionManager } from "../../../src/infrastructure/persistence/sessions/session-manager";
import { ToolRegistry } from "../../../src/kernel/tools/tool-registry";

describe("legacy scheduler isolation", () => {
  test("AgentLoop may expose a legacy scheduler but does not execute its pending intent", async () => {
    const session = SessionManager.inMemoryV2();
    const manager = {} as ContextManager;
    const scheduler = new BackgroundScheduler(session, manager, { backgroundTimeoutMs: 1 });
    scheduler.schedule("turn_complete", snapshot(), 0, 0, "legacy");
    const loop = new AgentLoop(client(), session, new ToolRegistry(), "/tmp", {}, undefined, undefined, undefined, scheduler);

    await loop.runTurn("hello");

    expect(loop.getBackgroundScheduler()).toBe(scheduler);
    expect(scheduler.getCurrentOperation()?.trigger).toBe("turn_complete");
    expect(session.getEntries().some((entry) => entry.type === "context_capsule")).toBe(false);
  });
});

function client(): any {
  const response = {
    id: "r", object: "response", created_at: 0, completed_at: 0, status: "completed",
    incomplete_details: null, model: "test", previous_response_id: null, instructions: null,
    output: [], error: null, tools: [], tool_choice: "auto", truncation: "disabled", parallel_tool_calls: true,
    text: {}, top_p: 1, presence_penalty: 0, frequency_penalty: 0, top_logprobs: 0, temperature: 1,
    reasoning: null, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
    max_output_tokens: null, max_tool_calls: null, store: false, background: false,
    service_tier: "default", metadata: {}, safety_identifier: null, prompt_cache_key: null,
  };
  return {
    create: async () => response,
    createStream: async function* () { yield { type: "response.completed", response }; },
    getProviderIdentity: () => ({ adapterId: "test", endpointOrigin: "test", model: "test" }),
    getProviderCapabilities: () => ({ nativeCompaction: false, structuredOutput: true, developerMessages: false }),
    classifyError: () => "unknown",
    getConfig: () => ({ model: "test", maxOutputTokens: 100, maxCompletionTokens: 0, contextWindow: 1_200, temperature: 1 }),
    updateConfig: () => {},
  };
}

function snapshot() {
  return { source: "estimated" as const, providerInputTokens: 0, estimatedTrailingTokens: 10,
    effectiveTokens: 10, historicalTokens: 10, systemPromptTokens: 0, toolSchemaTokens: 0,
    contextWindow: 1_200, maxOutputTokens: 100, safetyReserveTokens: 100, hardLimit: 1_000 };
}
