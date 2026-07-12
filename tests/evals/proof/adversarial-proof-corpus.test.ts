import { describe, expect, test } from "bun:test";
import { verifyEvidenceProof } from "../../../src/application/commands/verify";
import { adversarialProofCases } from "../fixtures/adversarial-proof-cases";

describe("adversarial false-completion release corpus", () => {
  for (const fixture of adversarialProofCases) {
    test(`rejects ${fixture.id}`, () => {
      const result = verifyEvidenceProof({ path: `${fixture.id}.soba-proof.json`, bundle: fixture.bundle });

      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain(fixture.expectedReason);
    });
  }

  test("contains every required v0.6.x adversarial category", () => {
    expect(adversarialProofCases.map((fixture) => fixture.id)).toEqual([
      "stale-verification",
      "masked-nonzero-exit",
      "unknown-claim-evidence",
      "incomplete-diff",
      "permission-denial-bypass",
    ]);
  });
});
