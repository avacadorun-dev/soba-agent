import { describe, expect, test } from "bun:test";
import {
  evidenceNeedsAttention,
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
        "- Verdict: needs attention",
        "- Outcome: partially verified",
        "- Reason: proof_partially_verified",
        "- Receipt: .soba/evidence/proof.soba-proof.json",
        "- Status: partially verified",
        "- Activity: 3 successful · 1 change, 2 checks",
        "- Changed files: modified src/app.ts (+3/-1), created src/new.ts (+4/-0)",
        "- Diff: 2 files, +7/-1",
        "- Claims: Parser is fixed supported; Edge case is covered unverified",
        "- Checks: Tests passed (bun test), Lint failed (bun run lint)",
        "- Risks: One or more verification checks failed.; Some file mutations are not covered.",
        "- Permissions: bash: bun test once trust=normal",
        "- Review: Rejected file change: src/generated.ts",
        "- Details: soba prove --last --verbose",
      ].join("\n"),
    );

    expect(split.body).toBe("Done.");
    expect(split.evidence).toMatchObject({
      verdict: "needs attention",
      outcome: "partially verified",
      reason: "proof_partially_verified",
      receipt: ".soba/evidence/proof.soba-proof.json",
      status: "partially verified",
      activity: "3 successful · 1 change, 2 checks",
      changedFiles: ["modified src/app.ts (+3/-1)", "created src/new.ts (+4/-0)"],
      diff: "2 files, +7/-1",
      claims: ["Parser is fixed supported", "Edge case is covered unverified"],
      checks: ["Tests passed (bun test)", "Lint failed (bun run lint)"],
      risks: ["One or more verification checks failed.", "Some file mutations are not covered."],
      permissions: ["bash: bun test once trust=normal"],
      reviewActions: ["Rejected file change: src/generated.ts"],
      nextCommand: "soba prove --last --verbose",
    });
    expect(evidenceNeedsAttention(split.evidence!)).toBe(true);
  });

  test("keeps a missing receipt visible even when the strict work outcome is verified", () => {
    const split = splitAssistantEvidence(
      [
        "**Evidence**",
        "- Verdict: needs attention",
        "- Outcome: verified",
        "- Reason: proof receipt was not saved",
        "- Receipt: not saved",
      ].join("\n"),
    );

    expect(split.evidence).toBeDefined();
    expect(evidenceNeedsAttention(split.evidence!)).toBe(true);
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
