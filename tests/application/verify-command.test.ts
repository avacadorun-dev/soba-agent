import { describe, expect, test } from "bun:test";
import {
  type EvidenceProofDocument,
  executeVerifyCommand,
  renderVerifyCommandView,
  verifyCommandExitCode,
  verifyEvidenceProof,
} from "../../src/application/commands/verify";
import { sealProofBundle } from "../../src/application/evidence/public";

const DIGEST = `sha256:${"a".repeat(64)}`;

describe("verify command", () => {
  const proof: EvidenceProofDocument = {
    path: "/repo/.soba/evidence/proof.soba-proof.json",
    bundle: sealProofBundle({
      version: 1,
      sessionId: "sess_1",
      turnId: "turn_1",
      status: "verified",
      summary: "Implemented proof verification.",
      evidence: [
        {
          id: "ev_mutation_1",
          kind: "mutation",
          status: "success",
          summary: "edit changed project files: src/app.ts",
          timestamp: 1,
          toolCallId: "edit_1",
          toolName: "edit",
          files: ["src/app.ts"],
          resolves: ["cmd_1"],
        },
        {
          id: "ev_verification_1",
          kind: "verification",
          status: "success",
          summary: "Verification command passed: bun test",
          timestamp: 2,
          toolCallId: "bash_1",
          toolName: "bash",
          command: "bun test",
          mutationIds: ["ev_mutation_1"],
        },
      ],
      claims: [
        {
          id: "claim_1",
          claim: "Proof verification is implemented",
          status: "supported",
          evidenceIds: ["ev_verification_1"],
        },
      ],
      changedFiles: [
        {
          path: "src/app.ts",
          operation: "modified",
          source: "tool_edit",
          added: 3,
          removed: 1,
          mutationIds: ["ev_mutation_1"],
        },
      ],
      diff: {
        files: [{
          path: "src/app.ts",
          operation: "modified",
          added: 3,
          removed: 1,
          mutationIds: ["ev_mutation_1"],
          truncated: false,
        }],
        fileCount: 1,
        added: 3,
        removed: 1,
        truncated: false,
      },
      commands: [
        {
          id: "cmd_1",
          command: "bun test",
          status: "passed",
          exitCode: 0,
          durationMs: 123,
          cwd: "/repo",
          outputDigest: DIGEST,
        },
      ],
      checks: [
        {
          id: "check_1",
          label: "Tests",
          status: "passed",
          commandId: "cmd_1",
        },
      ],
      approvals: [
        {
          toolCallId: "bash_1",
          toolName: "bash",
          decision: "auto",
          approved: true,
          trustLevel: "safe",
          approvalKind: "command",
          approvalValue: "bun test",
          description: "bash: bun test",
          reason: "safe test command",
          alternatives: [
            {
              id: "run_without_delete",
              title: "Run the non-destructive part only",
              reason: "Try without deleting files first.",
              command: "bun test",
            },
          ],
        },
      ],
      risks: [],
      reviewActions: [],
      createdAt: "2026-06-30T10:20:30.000Z",
    }),
  };

  test("verifies the latest proof as text by default", () => {
    const view = executeVerifyCommand({
      args: [],
      reader: {
        readLatestEvidenceBundle: () => proof,
        readEvidenceBundle: () => {
          throw new Error("unexpected explicit read");
        },
      },
      evidenceDir: "/repo/.soba/evidence",
    });

    expect(view.kind).toBe("verification");
    expect(verifyCommandExitCode(view)).toBe(0);
    const rendered = renderVerifyCommandView(view);
    expect(rendered).toContain("SOBA Proof Verification");
    expect(rendered).toContain("Result: valid");
    expect(rendered).toContain("Errors: 0");
    expect(rendered).toContain("Claims: 1");
    expect(rendered).toContain("Permissions: 1");
  });

  test("renders invalid proof as json with issue details", () => {
    const brokenProof: EvidenceProofDocument = {
      ...proof,
      bundle: {
        ...proof.bundle,
        commands: [{ id: "cmd_1", command: "bun test", status: "failed", exitCode: 1, outputDigest: DIGEST }],
        checks: [{ id: "check_1", label: "Tests", status: "passed", commandId: "cmd_missing" }],
      },
    };
    const view = executeVerifyCommand({
      args: ["proof.json", "--format=json"],
      reader: {
        readLatestEvidenceBundle: () => proof,
        readEvidenceBundle: (path) => ({ ...brokenProof, path }),
      },
    });

    expect(view.kind).toBe("verification");
    expect(verifyCommandExitCode(view)).toBe(1);
    const rendered = JSON.parse(renderVerifyCommandView(view));
    expect(rendered.valid).toBe(false);
    expect(rendered.result).toBe("invalid");
    expect(rendered.issues.map((issue: { code: string }) => issue.code)).toContain("unknown_check_command");
  });

  test("detects passed checks that reference non-passed commands", () => {
    const result = verifyEvidenceProof({
      ...proof,
      bundle: {
        ...proof.bundle,
        commands: [{ id: "cmd_1", command: "bun test", status: "failed", exitCode: 1, outputDigest: DIGEST }],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("passed_check_without_passed_command");
  });

  test("rejects a terminal command whose exit code is masked as null", () => {
    const bundle = structuredClone(proof.bundle);
    (bundle.commands as Array<Record<string, unknown>>)[0].status = "failed";
    (bundle.commands as Array<Record<string, unknown>>)[0].exitCode = null;

    const result = verifyEvidenceProof({ path: "proof.json", bundle });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("missing_exit_code");
  });

  test("rejects supported claims that reference missing evidence", () => {
    const result = verifyEvidenceProof({
      ...proof,
      bundle: {
        ...proof.bundle,
        claims: [
          {
            id: "claim_1",
            claim: "Broken claim",
            status: "supported",
            evidenceIds: ["ev_missing"],
          },
        ],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("unknown_claim_evidence");
  });

  test("rejects a sealed changed-file proof with no diff summary", () => {
    const withoutDiff = { ...proof.bundle };
    delete withoutDiff.diff;
    const sealed = sealProofBundle(withoutDiff);
    const result = verifyEvidenceProof({ path: "proof.json", bundle: sealed });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("missing_diff");
  });

  test("rejects malformed approval receipts", () => {
    const result = verifyEvidenceProof({
      ...proof,
      bundle: {
        ...proof.bundle,
        approvals: [
          {
            toolCallId: "bash_1",
            decision: "maybe",
            approved: "yes",
            trustLevel: "risky",
            approvalKind: "scope",
            alternatives: [{ id: "", title: "", reason: "", command: 1 }],
          },
        ],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "invalid_approval_decision",
        "invalid_approval_approved",
        "invalid_approval_trust_level",
        "invalid_approval_kind",
        "missing_id",
        "missing_title",
        "missing_reason",
        "invalid_approval_alternative_command",
      ]),
    );
  });

  test("keeps legacy proofs readable but does not policy-accept them as verified", () => {
    const legacyBundle: Record<string, unknown> = {
      ...proof.bundle,
      evidence: undefined,
      claims: undefined,
    };
    delete legacyBundle.proofId;
    delete legacyBundle.runId;
    delete legacyBundle.integrity;
    const result = verifyEvidenceProof({
      ...proof,
      bundle: legacyBundle,
    });

    expect(result.valid).toBe(true);
    expect(result.accepted).toBe(false);
    expect(result.result).toBe("valid_with_warnings");
    expect(result.outcome).toBe("partially_verified");
    expect(result.reason).toBe("legacy_unsealed_proof");
    expect(result.exitCode).toBe(2);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "legacy_unsealed_proof",
      "missing_evidence_index",
      "missing_claims",
    ]);
  });

  test("rejects verified proofs that retain risks", () => {
    const result = verifyEvidenceProof({
      ...proof,
      bundle: sealProofBundle({
        ...proof.bundle,
        risks: [{ id: "risk_1", kind: "failed_check", severity: "warning", message: "Risk remains.", evidenceIds: [] }],
      }),
    });

    expect(result.valid).toBe(false);
    expect(result.result).toBe("invalid");
    expect(result.summary.errors).toBe(1);
    expect(result.issues.map((issue) => issue.code)).toContain("verified_with_risks");
  });

  test("rejects invalid format", () => {
    const view = executeVerifyCommand({
      args: ["--format", "yaml"],
      reader: {
        readLatestEvidenceBundle: () => proof,
        readEvidenceBundle: () => proof,
      },
    });

    expect(view.kind).toBe("usage");
    expect(verifyCommandExitCode(view)).toBe(1);
    expect(renderVerifyCommandView(view)).toContain("Invalid --format value");
  });

  test("maps every terminal proof outcome to a stable reason and exit code", () => {
    const cases = [
      { status: "verified", outcome: "verified", reason: "proof_verified", exitCode: 0 },
      { status: "partially_verified", outcome: "partially_verified", reason: "proof_partially_verified", exitCode: 2 },
      { status: "unverified", outcome: "unverified", reason: "proof_unverified", exitCode: 3 },
      { status: "blocked", outcome: "blocked", reason: "proof_blocked", exitCode: 4 },
    ] as const;

    for (const expected of cases) {
      const result = verifyEvidenceProof({
        ...proof,
        bundle: sealProofBundle({ ...proof.bundle, status: expected.status }),
      });
      expect(result.outcome).toBe(expected.outcome);
      expect(result.reason).toBe(expected.reason);
      expect(result.exitCode).toBe(expected.exitCode);
      expect(result.accepted).toBe(expected.status === "verified");
    }
  });

  test("uses explicit evidence order when mutation and verification timestamps tie", () => {
    const evidence = (proof.bundle.evidence as Array<Record<string, unknown>>).map((entry) => ({ ...entry, timestamp: 1 }));
    const result = verifyEvidenceProof({ ...proof, bundle: sealProofBundle({ ...proof.bundle, evidence }) });

    expect(result.valid).toBe(true);
    expect(result.outcome).toBe("verified");
    expect(result.issues.map((issue) => issue.code)).not.toContain("stale_or_missing_verification");
  });
});
