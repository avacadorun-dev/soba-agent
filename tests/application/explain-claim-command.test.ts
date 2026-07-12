import { describe, expect, test } from "bun:test";
import {
  type EvidenceProofDocument,
  executeExplainClaimCommand,
  explainClaimCommandExitCode,
  renderExplainClaimCommandView,
} from "../../src/application/commands/explain-claim";

const DIGEST = `sha256:${"d".repeat(64)}`;

describe("explain-claim command", () => {
  const proof: EvidenceProofDocument = {
    path: "/repo/.soba/evidence/proof.soba-proof.json",
    bundle: {
      version: 1,
      proofId: "proof_aaaaaaaaaaaaaaaaaaaaaaaa",
      runId: "run_bbbbbbbbbbbbbbbbbbbbbbbb",
      sessionId: "sess_1",
      turnId: "turn_1",
      status: "verified",
      summary: "Implemented explain claim.",
      evidence: [
        {
          id: "ev_verification_1",
          kind: "verification",
          status: "success",
          summary: "Verification command passed: bun test",
          timestamp: 1,
          command: "bun test",
        },
      ],
      claims: [
        {
          id: "claim_1",
          claim: "Explain claim command is implemented",
          status: "supported",
          evidenceIds: ["ev_verification_1", "cmd_1", "check_1"],
        },
        {
          id: "claim_2",
          claim: "Explain claim command handles ambiguous lookups",
          status: "supported",
          evidenceIds: ["ev_verification_1"],
        },
      ],
      changedFiles: [],
      commands: [{ id: "cmd_1", command: "bun test", status: "passed", exitCode: 0, outputDigest: DIGEST }],
      checks: [{ id: "check_1", label: "Tests", status: "passed", commandId: "cmd_1", reason: "Command passed." }],
      approvals: [],
      risks: [],
      reviewActions: [],
      createdAt: "2026-06-30T10:20:30.000Z",
    },
  };

  test("explains a claim from the latest proof as text", () => {
    const view = executeExplainClaimCommand({
      args: ["claim_1"],
      reader: {
        readLatestEvidenceBundle: () => proof,
        readEvidenceBundle: () => {
          throw new Error("unexpected explicit read");
        },
      },
    });

    expect(view.kind).toBe("claim");
    expect(explainClaimCommandExitCode(view)).toBe(0);
    const rendered = renderExplainClaimCommandView(view);
    expect(rendered).toContain("SOBA Claim Explanation");
    expect(rendered).toContain("Proof id: proof_aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(rendered).toContain("Run id: run_bbbbbbbbbbbbbbbbbbbbbbbb");
    expect(rendered).toContain("Claim: Explain claim command is implemented");
    expect(rendered).toContain("ev_verification_1: verification success: Verification command passed: bun test");
    expect(rendered).toContain(`cmd_1: command passed: bun test exit=0 digest=${DIGEST}`);
    expect(rendered).toContain("check_1: check passed: Tests. Command passed.");
  });

  test("explains a claim from an explicit proof path as json", () => {
    const view = executeExplainClaimCommand({
      args: ["Explain claim command is implemented", "--proof", "proof.json", "--format=json"],
      reader: {
        readLatestEvidenceBundle: () => null,
        readEvidenceBundle: (path) => ({ ...proof, path }),
      },
    });

    expect(view.kind).toBe("claim");
    const rendered = JSON.parse(renderExplainClaimCommandView(view));
    expect(rendered).toMatchObject({
      proofPath: "proof.json",
      proofId: "proof_aaaaaaaaaaaaaaaaaaaaaaaa",
      runId: "run_bbbbbbbbbbbbbbbbbbbbbbbb",
      sessionId: "sess_1",
      turnId: "turn_1",
      id: "claim_1",
      status: "supported",
    });
    expect(rendered.evidence[0]).toMatchObject({ id: "ev_verification_1", kind: "verification" });
  });

  test("reports ambiguous substring matches", () => {
    const view = executeExplainClaimCommand({
      args: ["Explain claim command"],
      reader: {
        readLatestEvidenceBundle: () => proof,
        readEvidenceBundle: () => proof,
      },
    });

    expect(view.kind).toBe("ambiguous");
    expect(explainClaimCommandExitCode(view)).toBe(1);
    const rendered = renderExplainClaimCommandView(view);
    expect(rendered).toContain("Claim query is ambiguous");
    expect(rendered).toContain("claim_1");
    expect(rendered).toContain("claim_2");
  });

  test("reports missing claims and usage errors", () => {
    const missing = executeExplainClaimCommand({
      args: ["missing_claim"],
      reader: {
        readLatestEvidenceBundle: () => proof,
        readEvidenceBundle: () => proof,
      },
    });
    expect(missing.kind).toBe("not_found");
    expect(renderExplainClaimCommandView(missing)).toContain("Claim not found");

    const usage = executeExplainClaimCommand({
      args: ["--format", "xml"],
      reader: {
        readLatestEvidenceBundle: () => proof,
        readEvidenceBundle: () => proof,
      },
    });
    expect(usage.kind).toBe("usage");
    expect(renderExplainClaimCommandView(usage)).toContain("Usage: soba explain-claim");
  });
});
