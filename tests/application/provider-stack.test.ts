import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type SobaConfig } from "../../src/application/config/types";
import { createProviderStack } from "../../src/composition/runtime/create-provider-stack";

describe("provider stack CLI model selection", () => {
  test("keeps an unqualified explicit model on the configured default provider", async () => {
    const config = makeConfig("anthropic/claude-sonnet-4", "openrouter");
    const { client } = await createProviderStack({ config, modelExplicitlyPassed: true });

    expect(client.getActiveProviderId()).toBe("openrouter");
    expect(client.getActiveModelId()).toBe("anthropic/claude-sonnet-4");
    expect(client.getConfig().baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  test("uses and strips an explicit provider/model selector", async () => {
    const config = makeConfig("openrouter/deepseek/deepseek-v4-flash", "deepseek");
    const { client } = await createProviderStack({ config, modelExplicitlyPassed: true });

    expect(client.getActiveProviderId()).toBe("openrouter");
    expect(client.getActiveModelId()).toBe("deepseek/deepseek-v4-flash");
    expect(config.model).toBe("deepseek/deepseek-v4-flash");
    expect(client.getConfig().baseUrl).toBe("https://openrouter.ai/api/v1");
  });
});

function makeConfig(model: string, defaultProvider: string): SobaConfig {
  return {
    ...DEFAULT_CONFIG,
    model,
    registry: {
      defaultProvider,
      defaultModel: defaultProvider === "openrouter" ? "deepseek/deepseek-v4-flash" : "deepseek-v4-flash",
      providers: {
        deepseek: { apiKey: "deepseek-test-key" },
        openrouter: { apiKey: "openrouter-test-key" },
      },
      customProviders: {},
    },
  };
}
