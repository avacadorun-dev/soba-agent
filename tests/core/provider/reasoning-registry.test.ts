import { describe, expect, test } from "bun:test";
import type { ProviderDefinition } from "../../../src/application/providers/types";
import { buildProviderConfigOptions } from "../../../src/composition/runtime/create-provider-stack";
import { ProviderRegistry } from "../../../src/infrastructure/llm/providers/registry";

const provider: ProviderDefinition = {
  id: "reasoning-test",
  name: "Reasoning Test",
  baseUrl: "https://reasoning.example/v1",
  apiKeyEnv: null,
  adapter: "openai",
  custom: true,
  defaultModel: "effort-model",
  reasoningTransport: "openai_chat",
  models: [
    {
      id: "effort-model",
      name: "Effort model",
      contextWindow: 32_000,
      maxOutput: 8_000,
      supportsStreaming: true,
      supportsThinking: true,
      reasoning: { control: "effort", supportedEfforts: ["low", "high"] },
    },
    {
      id: "plain-model",
      name: "Plain model",
      contextWindow: 32_000,
      maxOutput: 8_000,
      supportsStreaming: true,
      supportsThinking: false,
      reasoning: { control: "none" },
    },
  ],
};

describe("reasoning runtime defaults", () => {
  test("survive model switches while effective policy follows model capabilities", () => {
    const registry = new ProviderRegistry({
      defaultProvider: provider.id,
      defaultModel: "effort-model",
      providers: {},
      customProviders: { [provider.id]: provider },
    }, {
      configPath: "/tmp/soba-reasoning-registry-test.json",
      clientDefaults: {
        temperature: 0.2,
        maxCompletionTokens: 12_000,
        reasoning: { mode: "effort", effort: "high" },
      },
    });

    expect(registry.getActiveClientConfig()).toMatchObject({
      temperature: 0.2,
      maxCompletionTokens: 12_000,
      reasoning: { mode: "effort", effort: "high" },
      reasoningEffective: { mode: "effort", effort: "high" },
    });

    registry.switchModel(provider.id, "plain-model");
    expect(registry.getActiveClientConfig()).toMatchObject({
      reasoning: { mode: "effort", effort: "high" },
      reasoningEffective: { mode: "provider_default" },
    });
    expect(registry.getActiveClientConfig().reasoningFallbackReason).toContain("does not declare");

    registry.switchModel(provider.id, "effort-model");
    expect(registry.getActiveClientConfig().reasoningEffective).toEqual({ mode: "effort", effort: "high" });
  });

  test("builds ACP options from the active model capability subset", async () => {
    const registry = new ProviderRegistry({
      defaultProvider: provider.id,
      defaultModel: "effort-model",
      providers: {},
      customProviders: { [provider.id]: provider },
    }, {
      configPath: "/tmp/soba-reasoning-registry-options-test.json",
      clientDefaults: { reasoning: { mode: "effort", effort: "high" } },
    });

    const option = (await buildProviderConfigOptions(registry))
      .find((candidate) => candidate.id === "reasoning");
    expect(option).toMatchObject({
      type: "select",
      category: "thought_level",
      currentValue: "high",
    });
    expect(option?.type === "select" ? option.options.map((item) => item.value) : [])
      .toEqual(["default", "low", "high"]);
  });
});
