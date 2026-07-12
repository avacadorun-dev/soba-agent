import { describe, expect, test } from "bun:test";
import { estimatePromptEnvelopeTokens } from "../../../src/engine/turn/model-turn-execution";

describe("model turn skill token accounting", () => {
  test("includes every ephemeral skill developer message in pre-inference prompt tokens", () => {
    const tokens = estimatePromptEnvelopeTokens("12345678", [
      { role: "developer", content: "1234" },
      { role: "developer", content: "12345678" },
    ]);

    expect(tokens).toBe(5);
    expect(tokens).toBeGreaterThan(estimatePromptEnvelopeTokens("12345678", []));
  });
});
