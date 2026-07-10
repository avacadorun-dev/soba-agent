import { describe, expect, test } from "bun:test";
import { getAutonomousFollowUpReason } from "../../../src/engine/turn/turn-helpers";
import type { MessageField } from "../../../src/kernel/model/openresponses-types";

function commentary(text: string): MessageField {
  return {
    type: "message",
    id: "msg_1",
    status: "completed",
    role: "assistant",
    phase: "commentary",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

describe("getAutonomousFollowUpReason workMode", () => {
  test("plan mode accepts inspection-only plan text without finish auto-continue", () => {
    const reason = getAutonomousFollowUpReason(
      [
        commentary(
          [
            "## Implementation plan",
            "1. Inspect package.json and tests layout",
            "2. Add route handler for invoice notes",
            "",
            "### Open questions",
            "- Should notes be versioned?",
            "",
            "### Risks",
            "- Auth middleware order",
            "",
            "### Verification",
            "- bun test",
          ].join("\n"),
        ),
      ],
      false,
      [],
      false,
      true,
      "unknown",
      "plan",
    );

    expect(reason).toBeNull();
  });

  test("goal mode accepts inspection-only brief without finish auto-continue", () => {
    const reason = getAutonomousFollowUpReason(
      [commentary("Goal: clarify success criteria for invoice notes API before coding.")],
      false,
      [],
      false,
      true,
      "unknown",
      "goal",
    );

    expect(reason).toBeNull();
  });

  test("agent mode still forces finish after tools when text is not final", () => {
    const reason = getAutonomousFollowUpReason(
      [commentary("Inspected package.json and tests. Next I will implement the route.")],
      false,
      [],
      false,
      true,
      "unknown",
      "agent",
    );

    expect(reason).toContain("Tool-assisted turns must end through finish");
  });

  test("plan mode still forces verification when mutations need evidence", () => {
    const reason = getAutonomousFollowUpReason(
      [commentary("## Implementation plan\nDone.")],
      true,
      [],
      true,
      true,
      "unknown",
      "plan",
    );

    expect(reason).toContain("before verifying the result");
  });
});
