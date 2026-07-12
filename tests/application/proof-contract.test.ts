import { describe, expect, test } from "bun:test";
import { verifyEvidenceProof } from "../../src/application/commands/verify";
import {
  canonicalJson,
  containsPotentialProofSecret,
  proofDigest,
  sanitizeProofValue,
  sealProofBundle,
  stableRunId,
} from "../../src/application/evidence/public";

describe("Proof Bundle v1 contract", () => {
  test("seals equivalent objects with deterministic IDs and digest", () => {
    const first = sealProofBundle({ version: 1, sessionId: "sess_1", turnId: "turn_1", beta: 2, alpha: 1 });
    const second = sealProofBundle({ alpha: 1, beta: 2, turnId: "turn_1", sessionId: "sess_1", version: 1 });

    expect(first).toEqual(second);
    expect(first.proofId).toMatch(/^proof_[a-f0-9]{24}$/);
    expect(first.runId).toMatch(/^run_[a-f0-9]{24}$/);
    expect(first.integrity.digest).toBe(proofDigest(first));
    expect(canonicalJson({ beta: 2, alpha: 1 })).toBe('{"alpha":1,"beta":2}');
  });

  test("redacts secret-bearing keys and values before hashing", () => {
    const sealed = sealProofBundle({
      version: 1,
      sessionId: "sess_1",
      turnId: "turn_1",
      apiKey: "top-secret",
      output: "authorization: Bearer sk-abcdefghijklmnop",
      metrics: { tokensUsed: 123 },
    });

    expect(sealed.apiKey).toBe("[REDACTED]");
    expect(sealed.output).toBe("authorization: Bearer [REDACTED]");
    expect(sealed.metrics).toEqual({ tokensUsed: 123 });
    expect(containsPotentialProofSecret(sealed)).toBe(false);
    expect(sanitizeProofValue({ password: "hunter2" })).toEqual({ password: "[REDACTED]" });
  });

  test("derives stable but distinct run IDs for turns in the same session", () => {
    const firstTurn = sealProofBundle({ ...minimalBundle(), turnId: "turn_1" });
    const repeatedFirstTurn = sealProofBundle({ ...minimalBundle(), turnId: "turn_1" });
    const suppliedWrongId = sealProofBundle({
      ...minimalBundle(),
      turnId: "turn_1",
      runId: stableRunId("another_session", "turn_9"),
    });
    const secondTurn = sealProofBundle({ ...minimalBundle(), turnId: "turn_2" });

    expect(firstTurn.runId).toBe(repeatedFirstTurn.runId);
    expect(suppliedWrongId.runId).toBe(firstTurn.runId);
    expect(firstTurn.runId).toBe(stableRunId("sess_1", "turn_1"));
    expect(secondTurn.runId).toBe(stableRunId("sess_1", "turn_2"));
    expect(secondTurn.runId).not.toBe(firstTurn.runId);
  });

  test("rejects a sealed proof whose run ID does not match its session and turn", () => {
    const sealed = sealProofBundle(minimalBundle());
    const forgedIdentity = {
      ...sealed,
      runId: stableRunId("another_session", "turn_1"),
    };
    const digest = proofDigest(forgedIdentity);
    const selfConsistentForgery = {
      ...forgedIdentity,
      proofId: `proof_${digest.slice("sha256:".length, "sha256:".length + 24)}`,
      integrity: { algorithm: "sha256", digest },
    };
    const result = verifyEvidenceProof({ path: "proof.json", bundle: selfConsistentForgery });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("run_id_identity_mismatch");
  });

  test("detects any mutation after a proof is sealed", () => {
    const sealed = sealProofBundle(minimalBundle());
    const tampered = { ...sealed, summary: "A different claim" };
    const result = verifyEvidenceProof({ path: "proof.json", bundle: tampered });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("proof_digest_mismatch");
  });

  test("rejects unredacted secret content even without integrity metadata", () => {
    const result = verifyEvidenceProof({
      path: "legacy.json",
      bundle: { ...minimalBundle(), summary: "api_key=sk-abcdefghijklmnop" },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("unredacted_secret");
  });

  test("accepts additive v1 fields while rejecting unknown versions", () => {
    const additive = sealProofBundle({ ...minimalBundle(), extension: { producer: "external-fixture" } });
    const additiveResult = verifyEvidenceProof({ path: "additive.json", bundle: additive });
    expect(additiveResult.valid).toBe(true);
    expect(additiveResult.outcome).toBe("verified");

    const unknownVersion = { ...minimalBundle(), version: 2 };
    const unknownResult = verifyEvidenceProof({ path: "v2.json", bundle: unknownVersion });
    expect(unknownResult.valid).toBe(false);
    expect(unknownResult.issues.map((issue) => issue.code)).toContain("invalid_version");
  });

  test("validates optional run metrics", () => {
    const valid = sealProofBundle({
      ...minimalBundle(),
      metrics: { modelCalls: 4, tokens: { input: 100, output: 20, total: 120 } },
    });
    expect(verifyEvidenceProof({ path: "metrics.json", bundle: valid }).valid).toBe(true);

    const invalid = sealProofBundle({
      ...minimalBundle(),
      metrics: { modelCalls: -1, tokens: { input: 100, output: "unknown", total: 120 } },
    });
    const result = verifyEvidenceProof({ path: "metrics-invalid.json", bundle: invalid });
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["invalid_model_calls", "invalid_token_metric"]),
    );
  });
});

function minimalBundle(): Record<string, unknown> {
  return {
    version: 1,
    sessionId: "sess_1",
    turnId: "turn_1",
    status: "verified",
    summary: "Verified no-op task.",
    evidence: [],
    claims: [],
    changedFiles: [],
    commands: [],
    checks: [],
    approvals: [],
    risks: [],
    reviewActions: [],
    createdAt: "2026-07-12T00:00:00.000Z",
  };
}
