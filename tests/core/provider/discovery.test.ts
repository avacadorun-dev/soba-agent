import { describe, expect, test } from "bun:test";
import { isLikelyChatModelId, pickSuggestedDefault } from "../../../src/core/provider/discovery";

describe("provider discovery model selection", () => {
  test("suggests a chat-like model instead of an image model when the image model is first", () => {
    const suggested = pickSuggestedDefault(
      [
        { id: "google/gemini-3.1-flash-image" },
        { id: "minimax/minimax-m3" },
        { id: "moonshotai/kimi-k2.7-code" },
      ],
      "openrouter",
    );

    expect(suggested).toBe("moonshotai/kimi-k2.7-code");
  });

  test("classifies non-chat model ids conservatively", () => {
    expect(isLikelyChatModelId("google/gemini-3.1-flash-image")).toBe(false);
    expect(isLikelyChatModelId("text-embedding-3-large")).toBe(false);
    expect(isLikelyChatModelId("nvidia/nemotron-3.5-content-safety:free")).toBe(false);
    expect(isLikelyChatModelId("minimax/minimax-m3")).toBe(true);
  });
});
