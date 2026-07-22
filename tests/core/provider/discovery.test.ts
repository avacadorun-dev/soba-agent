import { describe, expect, test } from "bun:test";
import type { ProviderDefinition } from "../../../src/application/providers/types";
import {
  discoverModels,
  pickSuggestedDefault,
  resolveModelsForProvider,
  supportsTextGeneration,
  toModelDefinitions,
} from "../../../src/infrastructure/llm/providers/discovery";

const provider: ProviderDefinition = {
  id: "metadata-provider",
  name: "Metadata Provider",
  baseUrl: "https://metadata.example.test/v1",
  apiKeyEnv: null,
  adapter: "openai",
  defaultModel: "",
  models: [],
};

describe("provider discovery model selection", () => {
  test("suggests the first declared text model instead of interpreting model names", () => {
    const suggested = pickSuggestedDefault(
      [
        { id: "looks-like-chat", raw: { output_modalities: ["image"] } },
        { id: "looks-like-image", raw: { output_modalities: ["text"] } },
      ],
    );

    expect(suggested).toBe("looks-like-image");
  });

  test("uses declared output modalities instead of vendor/model-name fragments", () => {
    expect(supportsTextGeneration({ id: "anything", raw: { output_modalities: ["image"] } })).toBe(false);
    expect(supportsTextGeneration({ id: "anything", raw: { architecture: { output_modalities: ["text"] } } })).toBe(true);
    expect(supportsTextGeneration({ id: "unknown-name" })).toBe(true);
  });

  test("maps capabilities and wire compatibility from metadata only", () => {
    const [model] = toModelDefinitions(
      {
        ok: true,
        source: "upstream",
        suggestedDefault: "vendor-neutral-model",
        models: [{
          id: "vendor-neutral-model",
          raw: {
            capabilities: { supports_reasoning: true, supports_streaming: false },
            soba_compatibility: [
              "adaptive_thinking",
              "single_system_message",
              "unknown-feature",
            ],
          },
        }],
      },
      provider,
    );

    expect(model).toMatchObject({
      id: "vendor-neutral-model",
      supportsThinking: true,
      supportsStreaming: false,
      compatibility: ["adaptive_thinking", "single_system_message"],
    });
  });

  test("parses structured reasoning capabilities exposed by model discovery", () => {
    const [model] = toModelDefinitions(
      {
        ok: true,
        source: "upstream",
        suggestedDefault: "reasoning-model",
        models: [{
          id: "reasoning-model",
          raw: {
            reasoning: {
              supported_efforts: ["none", "low", "high", "xhigh", "unknown"],
              default_effort: "high",
              supports_max_tokens: true,
              mandatory: false,
              max_tokens: 32_768,
            },
          },
        }],
      },
      { ...provider, reasoningTransport: "openrouter" },
    );

    expect(model).toMatchObject({
      supportsThinking: true,
      reasoningTransport: "openrouter",
      reasoning: {
        control: "effort",
        supportedEfforts: ["none", "low", "high", "xhigh"],
        defaultEffort: "high",
        supportsBudget: true,
        supportsToggle: true,
        mandatory: false,
        maxBudgetTokens: 32_768,
      },
    });
  });

  test("uses OpenRouter context and completion limits instead of synthetic defaults", () => {
    const [model] = toModelDefinitions(
      {
        ok: true,
        source: "upstream",
        suggestedDefault: "large-context-model",
        models: [{
          id: "large-context-model",
          raw: {
            context_length: 1_048_576,
            top_provider: {
              context_length: 1_000_000,
              max_completion_tokens: 65_536,
            },
          },
        }],
      },
      provider,
    );

    expect(model?.contextWindow).toBe(1_000_000);
    expect(model?.maxOutput).toBe(65_536);
    expect(model?.limits).toEqual({
      contextWindow: {
        value: 1_000_000,
        source: "provider_route",
        scope: "route",
      },
      maxOutput: {
        value: 65_536,
        source: "provider_route",
        scope: "route",
      },
      modelContextWindow: 1_048_576,
      routeContextWindow: 1_000_000,
    });
  });

  test("treats null supported_efforts as all OpenRouter gateway efforts", () => {
    const [model] = toModelDefinitions(
      {
        ok: true,
        source: "upstream",
        suggestedDefault: "all-efforts",
        models: [{
          id: "all-efforts",
          raw: {
            supported_parameters: ["reasoning"],
            reasoning: { supported_efforts: null, mandatory: false },
          },
        }],
      },
      { ...provider, reasoningTransport: "openrouter" },
    );

    expect(model?.reasoning).toMatchObject({
      control: "effort",
      supportedEfforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
      supportsToggle: true,
    });
  });

  test("uses toggle control for sparse optional OpenRouter reasoning metadata", () => {
    const [reasoningModel, toggleWithoutMandatory, nonReasoningModel] = toModelDefinitions(
      {
        ok: true,
        source: "upstream",
        suggestedDefault: "toggle-model",
        models: [
          {
            id: "toggle-model",
            raw: {
              supported_parameters: ["reasoning", "max_tokens"],
              reasoning: { mandatory: false },
            },
          },
          {
            id: "toggle-model-without-mandatory",
            raw: {
              supported_parameters: ["reasoning"],
              reasoning: {},
            },
          },
          {
            id: "ordinary-model",
            raw: {
              supported_parameters: ["max_tokens"],
              reasoning: { mandatory: false },
            },
          },
        ],
      },
      { ...provider, reasoningTransport: "openrouter" },
    );

    expect(reasoningModel?.reasoning).toEqual({ control: "toggle", mandatory: false });
    expect(toggleWithoutMandatory?.reasoning).toEqual({ control: "toggle" });
    expect(reasoningModel?.supportsThinking).toBe(true);
    expect(nonReasoningModel?.reasoning).toBeUndefined();
    expect(nonReasoningModel?.supportsThinking).toBe(false);
  });

  test("merges provider metadata into sparse custom models without overriding explicit limits", () => {
    const discovered = toModelDefinitions(
      {
        ok: true,
        source: "upstream",
        suggestedDefault: "local-model",
        models: [{
          id: "local-model",
          raw: {
            context_length: 64_000,
            max_completion_tokens: 8_000,
          },
        }],
      },
      provider,
    );

    const [model] = resolveModelsForProvider({
      ...provider,
      custom: true,
      models: [{ id: "local-model", name: "My local model", contextWindow: 32_000 }],
    }, discovered);

    expect(model).toMatchObject({
      name: "My local model",
      contextWindow: 32_000,
      maxOutput: 8_000,
      limits: {
        contextWindow: { source: "user_config", scope: "runtime" },
        maxOutput: { source: "provider_model", scope: "model" },
      },
    });
  });

  test("marks genuinely unknown custom-provider limits as assumed", () => {
    const [model] = resolveModelsForProvider({
      ...provider,
      custom: true,
      models: [{ id: "unknown-model" }],
    });

    expect(model).toMatchObject({
      contextWindow: 128_000,
      maxOutput: 32_768,
      supportsThinking: false,
      limits: {
        contextWindow: { source: "fallback", scope: "assumed" },
        maxOutput: { source: "fallback", scope: "assumed" },
      },
    });
    expect(model?.reasoning).toBeUndefined();
  });

  test("treats vLLM max_model_len as the active runtime limit", () => {
    const [model] = toModelDefinitions(
      {
        ok: true,
        source: "upstream",
        suggestedDefault: "served-model",
        models: [{ id: "served-model", raw: { max_model_len: 49_152 } }],
      },
      { ...provider, metadataProfile: "vllm" },
    );

    expect(model).toMatchObject({
      contextWindow: 49_152,
      limits: {
        contextWindow: {
          value: 49_152,
          source: "provider_runtime",
          scope: "runtime",
        },
      },
    });
  });

  test("uses OpenRouter personalized catalogue before the generic endpoint", async () => {
    const requested: string[] = [];
    const fetchImpl = (async (input) => {
      requested.push(new URL(String(input)).pathname);
      return Response.json({
        data: [{ id: "openrouter/model", context_length: 200_000 }],
      });
    }) as typeof fetch;
    const result = await discoverModels({
      ...provider,
      id: "openrouter-test",
      baseUrl: "https://openrouter-discovery.example.test/api/v1",
      metadataProfile: "openrouter",
    }, null, { force: true, fetch: fetchImpl });

    expect(result.ok).toBe(true);
    expect(requested).toEqual(["/api/v1/models/user"]);
  });

  test("auto profile enriches a loopback Ollama provider with loaded and model limits", async () => {
    const requested: string[] = [];
    const fetchImpl = (async (input, init) => {
      const url = new URL(String(input));
      requested.push(url.pathname);
      if (url.pathname === "/v1/models") return Response.json({ data: [{ id: "qwen3:8b" }] });
      if (url.pathname === "/api/version") return Response.json({ version: "0.12.0" });
      if (url.pathname === "/api/tags") return Response.json({ models: [{ name: "qwen3:8b", model: "qwen3:8b" }] });
      if (url.pathname === "/api/ps") return Response.json({ models: [{ name: "qwen3:8b", model: "qwen3:8b", context_length: 16_384 }] });
      if (url.pathname === "/api/show" && init?.method === "POST") {
        return Response.json({
          model_info: { "qwen3.context_length": 40_960 },
          capabilities: ["completion", "thinking"],
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const customOllama: ProviderDefinition = {
      ...provider,
      id: "ollama-auto-test",
      baseUrl: "http://127.0.0.1:11434/v1",
      custom: true,
      metadataProfile: "auto",
    };
    const result = await discoverModels(customOllama, null, { force: true, fetch: fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [model] = toModelDefinitions(result, customOllama);
    expect(model).toMatchObject({
      id: "qwen3:8b",
      contextWindow: 16_384,
      supportsThinking: true,
      reasoning: { control: "toggle" },
      reasoningTransport: "ollama",
      limits: {
        contextWindow: { source: "provider_runtime", scope: "runtime" },
        modelContextWindow: 40_960,
      },
    });
    expect(requested).toContain("/api/show");
  });
});
