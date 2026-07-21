import { describe, expect, test } from "bun:test";
import type { ProviderDefinition } from "../../../src/application/providers/types";
import {
  pickSuggestedDefault,
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
});
