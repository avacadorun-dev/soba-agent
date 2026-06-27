import { describe, expect, test } from "bun:test";
import {
  formatTuiEvidenceSummary,
  splitAssistantEvidence,
} from "../../../../src/ui/terminal/interactive/lib/evidence-summary";

describe("TUI evidence summary", () => {
  test("leaves normal assistant text untouched", () => {
    expect(splitAssistantEvidence("Plain answer")).toEqual({ body: "Plain answer" });
  });

  test("parses compact evidence handoff blocks", () => {
    const split = splitAssistantEvidence(
      [
        "Done.",
        "",
        "**Evidence**",
        "- Status: partially verified",
        "- Changed files: modified src/app.ts (+3/-1), created src/new.ts (+4/-0)",
        "- Diff: 2 files, +7/-1",
        "- Checks: Tests passed (bun test), Lint failed (bun run lint)",
        "- Risks: One or more verification checks failed.; Some file mutations are not covered.",
        "- Review: Rejected file change: src/generated.ts",
      ].join("\n"),
    );

    expect(split.body).toBe("Done.");
    expect(split.evidence).toMatchObject({
      status: "partially verified",
      changedFiles: ["modified src/app.ts (+3/-1)", "created src/new.ts (+4/-0)"],
      diff: "2 files, +7/-1",
      checks: ["Tests passed (bun test)", "Lint failed (bun run lint)"],
      risks: ["One or more verification checks failed.", "Some file mutations are not covered."],
      reviewActions: ["Rejected file change: src/generated.ts"],
    });
  });

  test("formats parsed evidence for transcript and search", () => {
    const split = splitAssistantEvidence(
      [
        "**Evidence**",
        "- Status: verified",
        "- Changed files: none recorded",
        "- Checks: Tests passed (bun test)",
        "- Risks: none",
      ].join("\n"),
    );

    expect(split.evidence).toBeDefined();
    expect(formatTuiEvidenceSummary(split.evidence!)).toBe("Evidence\nStatus: verified\nChecks: Tests passed (bun test)");
  });
});
