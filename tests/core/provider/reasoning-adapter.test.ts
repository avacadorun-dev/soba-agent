import { describe, expect, test } from "bun:test";
import { outputItemToSessionItem } from "../../../src/engine/turn/turn-helpers";
import { OpenAIAdapter } from "../../../src/infrastructure/llm/openai/openai-adapter";
import { OpenAIResponsesAdapter } from "../../../src/infrastructure/llm/openai/openai-responses-adapter";
import type { ProviderConfig } from "../../../src/infrastructure/llm/openai/types";

const userInput = [{
  type: "message" as const,
  role: "user" as const,
  content: [{ type: "input_text" as const, text: "Solve this" }],
}];

describe("capability-aware reasoning wire formats", () => {
  const adapter = new OpenAIAdapter();

  test("uses reasoning_effort for OpenAI Chat and removes incompatible sampling", () => {
    const config: ProviderConfig = {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test",
      model: "gpt-5.6",
      reasoningTransport: "openai_chat",
      reasoningCapabilities: {
        control: "effort",
        supportedEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
      },
    };
    const request = adapter.convertRequest({
      input: userInput,
      reasoning: { effort: "high" },
      temperature: 0.7,
      presence_penalty: 0.3,
      frequency_penalty: 0.2,
      max_output_tokens: 4_096,
    }, config);

    expect(request.reasoning_effort).toBe("high");
    expect(request.temperature).toBeUndefined();
    expect(request.presence_penalty).toBeUndefined();
    expect(request.frequency_penalty).toBeUndefined();
    expect(request.max_tokens).toBeUndefined();
    expect(request.max_completion_tokens).toBe(4_096);
  });

  test("uses OpenRouter reasoning object for effort and budget", () => {
    const config: ProviderConfig = {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "test",
      model: "router-model",
      reasoningTransport: "openrouter",
      reasoningCapabilities: {
        control: "effort",
        supportedEfforts: ["low", "high"],
        supportsBudget: true,
      },
    };

    const effortRequest = adapter.convertRequest({
      input: userInput,
      reasoning: { effort: "low" },
      temperature: 0.4,
      top_p: 0.8,
    }, config);
    expect(effortRequest.reasoning).toEqual({ effort: "low" });
    expect(effortRequest.temperature).toBe(0.4);
    expect(effortRequest.top_p).toBe(0.8);
    expect(adapter.convertRequest({ input: userInput, reasoning: { max_tokens: 8_192 } }, config).reasoning)
      .toEqual({ max_tokens: 8_192 });
  });

  test("maps toggle and budget controls to provider-specific fields", () => {
    const deepSeek = adapter.convertRequest({
      input: userInput,
      reasoning: { enabled: false },
    }, {
      baseUrl: "https://api.deepseek.com",
      apiKey: "test",
      model: "declared-model",
      reasoningTransport: "deepseek",
      reasoningCapabilities: { control: "toggle" },
    });
    expect(deepSeek.thinking).toEqual({ type: "disabled" });

    const kimi = adapter.convertRequest({
      input: userInput,
      reasoning: { enabled: true },
    }, {
      baseUrl: "https://api.moonshot.cn/v1",
      apiKey: "test",
      model: "declared-model",
      reasoningTransport: "kimi",
      reasoningCapabilities: { control: "toggle" },
    });
    expect(kimi.thinking).toEqual({ type: "enabled" });

    const qwen = adapter.convertRequest({
      input: userInput,
      reasoning: { max_tokens: 4_096 },
    }, {
      baseUrl: "https://dashscope.example/v1",
      apiKey: "test",
      model: "declared-model",
      reasoningTransport: "qwen",
      reasoningCapabilities: { control: "budget", supportsToggle: true },
    });
    expect(qwen.enable_thinking).toBe(true);
    expect(qwen.thinking_budget).toBe(4_096);
  });

  test("maps MiniMax M3 toggle controls without stripping supported sampling", () => {
    const enabled = adapter.convertRequest({
      input: userInput,
      reasoning: { enabled: true },
      temperature: 1,
      top_p: 0.95,
      max_completion_tokens: 131_072,
    }, {
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "test",
      model: "MiniMax-M3",
      reasoningTransport: "minimax",
      reasoningCapabilities: { control: "toggle", defaultEnabled: true },
    });

    expect(enabled.thinking).toEqual({ type: "enabled" });
    expect(enabled.temperature).toBe(1);
    expect(enabled.top_p).toBe(0.95);
    expect(enabled.max_completion_tokens).toBe(131_072);

    const disabled = adapter.convertRequest({
      input: userInput,
      reasoning: { enabled: false },
    }, {
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "test",
      model: "MiniMax-M3",
      reasoningTransport: "minimax",
      reasoningCapabilities: { control: "toggle", defaultEnabled: true },
    });
    expect(disabled.thinking).toEqual({ type: "disabled" });
  });

  test("validates a numeric reasoning budget against the completion limit", () => {
    expect(() => adapter.convertRequest({
      input: userInput,
      reasoning: { max_tokens: 4_096 },
      max_completion_tokens: 4_096,
    }, {
      baseUrl: "https://dashscope.example/v1",
      apiKey: "test",
      model: "declared-model",
      reasoningTransport: "qwen",
      reasoningCapabilities: { control: "budget" },
    })).toThrow("must be lower than the completion limit");

    expect(() => adapter.convertRequest({
      input: userInput,
      reasoning: { max_tokens: 4_096 },
      max_output_tokens: 4_096,
    }, {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "test",
      model: "declared-model",
      reasoningTransport: "openrouter",
      reasoningCapabilities: { control: "budget", supportsBudget: true },
    })).toThrow("must be lower than the completion limit");
  });

  test("omits unsupported controls instead of forwarding or clamping them", () => {
    const request = adapter.convertRequest({
      input: userInput,
      reasoning: { effort: "medium" },
      temperature: 0.4,
    }, {
      baseUrl: "https://unknown.example/v1",
      apiKey: "test",
      model: "unknown",
      reasoningTransport: "openai_chat",
      reasoningCapabilities: { control: "effort", supportedEfforts: ["low", "high"] },
    });

    expect(request.reasoning_effort).toBeUndefined();
    expect(request.temperature).toBe(0.4);
  });

  test("never sends reasoning fields to an unknown compatible transport", () => {
    const request = adapter.convertRequest({
      input: userInput,
      reasoning: { effort: "high" },
    }, {
      baseUrl: "https://unknown.example/v1",
      apiKey: "test",
      model: "unknown",
      reasoningCapabilities: { control: "effort", supportedEfforts: ["high"] },
    });

    expect(request.reasoning_effort).toBeUndefined();
    expect(request.reasoning).toBeUndefined();
    expect(request.thinking).toBeUndefined();
  });

  test("round-trips opaque reasoning details and provider usage", () => {
    const detail = { type: "reasoning.encrypted", data: "opaque", signature: "sig" };
    const response = adapter.convertResponse({
      id: "response-1",
      object: "chat.completion",
      created: 1,
      model: "router-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Done", reasoning_details: [detail] },
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        prompt_tokens_details: { cached_tokens: 3 },
        completion_tokens_details: { reasoning_tokens: 12 },
      },
    }, {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "test",
      model: "router-model",
    });

    const message = response.output.find((item) => item.type === "message");
    expect(message?.reasoning_details).toEqual([detail]);
    expect(response.usage?.input_tokens_details.cached_tokens).toBe(3);
    expect(response.usage?.output_tokens_details.reasoning_tokens).toBe(12);

    const sessionItem = message ? outputItemToSessionItem(message) : null;
    const request = adapter.convertRequest({ input: sessionItem ? [sessionItem] : [] }, {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "test",
      model: "router-model",
    });
    expect((request.messages as Array<Record<string, unknown>>)[0]?.reasoning_details).toEqual([detail]);
  });

  test("normalizes OpenRouter reasoning aliases in responses and streams", () => {
    const response = adapter.convertResponse({
      id: "response-openrouter-reasoning",
      object: "chat.completion",
      created: 1,
      model: "router-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "323", reasoning: "17 times 19" },
        finish_reason: "stop",
      }],
    }, {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "test",
      model: "router-model",
    });

    const responseMessage = response.output.find((item) => item.type === "message");
    expect(responseMessage?.reasoning_content).toBe("17 times 19");

    const streamChunk = {
      id: "chunk-openrouter-reasoning",
      object: "chat.completion.chunk",
      created: 1,
      model: "router-model",
      choices: [{
        index: 0,
        delta: { reasoning: "17 times 19" },
        finish_reason: null,
      }],
    };
    const streamEvents = adapter.processStreamLine(
      JSON.stringify(streamChunk),
      adapter.createStreamAccumulator(),
    );
    expect(streamEvents).toContainEqual(expect.objectContaining({
      type: "response.reasoning.delta",
      delta: "17 times 19",
    }));
  });

  test("uses native OpenAI Responses reasoning and preserves opaque items", () => {
    const responsesAdapter = new OpenAIResponsesAdapter();
    const config: ProviderConfig = {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test",
      model: "gpt-5.6",
      reasoningTransport: "openai_responses",
      reasoningCapabilities: {
        control: "effort",
        supportedEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
      },
    };
    const opaqueItem = {
      type: "reasoning" as const,
      id: "rs_1",
      encrypted_content: "encrypted",
      signature: "provider-signature",
      summary: [{ type: "summary_text", text: "Short summary" }],
    };

    const request = responsesAdapter.convertRequest({
      input: [opaqueItem],
      reasoning: { effort: "xhigh" },
      temperature: 0.7,
      top_p: 0.8,
      max_completion_tokens: 8_192,
    }, config);

    expect(request.reasoning).toEqual({ effort: "xhigh" });
    expect(request.include).toEqual(["reasoning.encrypted_content"]);
    expect(request.max_output_tokens).toBe(8_192);
    expect(request.temperature).toBeUndefined();
    expect(request.top_p).toBeUndefined();
    expect((request.input as Array<Record<string, unknown>>)[0]).toEqual(opaqueItem);

    const response = responsesAdapter.convertResponse({
      id: "resp_1",
      object: "response",
      created_at: 1,
      status: "completed",
      model: "gpt-5.6",
      output: [opaqueItem],
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        input_tokens_details: { cached_tokens: 4 },
        output_tokens_details: { reasoning_tokens: 15 },
      },
    }, config);

    expect(response.output[0]).toEqual(opaqueItem);
    expect(outputItemToSessionItem(response.output[0] as typeof opaqueItem)).toEqual(opaqueItem);
    expect(response.usage?.output_tokens_details.reasoning_tokens).toBe(15);
  });

  test("normalizes native Responses reasoning deltas and nested failures", () => {
    const responsesAdapter = new OpenAIResponsesAdapter();
    expect(responsesAdapter.convertStreamChunk({
      type: "response.reasoning_summary_text.delta",
      item_id: "rs_1",
      output_index: 0,
      summary_index: 1,
      delta: "thinking",
    })).toEqual([{
      type: "response.reasoning.delta",
      item_id: "rs_1",
      output_index: 0,
      content_index: 1,
      delta: "thinking",
    }]);

    expect(responsesAdapter.convertStreamChunk({
      type: "response.failed",
      response: { error: { code: "invalid_request", message: "Rejected" } },
    })).toEqual([{
      type: "response.failed",
      error: { code: "invalid_request", message: "Rejected" },
    }]);
  });
});
