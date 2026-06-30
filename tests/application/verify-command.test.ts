import { describe, expect, test } from "bun:test";
import {
  type EvidenceProofDocument,
  executeVerifyCommand,
  renderVerifyCommandView,
  verifyCommandExitCode,
  verifyEvidenceProof,
} from "../../src/application/commands/verify";

const DIGEST = `sha256:${"a".repeat(64)}`;

describe("verify command", () => {
  const proof: EvidenceProofDocument = {
    path: "/repo/.soba/evidence/proof.soba-proof.json",
    bundle: {
      version: 1,
      sessionId: "sess_1",
      turnId: "turn_1",
      status: "verified",
      summary: "Implemented proof verification.",
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
      approvals: [],
      risks: [],
      reviewActions: [],
      createdAt: "2026-06-30T10:20:30.000Z",
    },
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

  test("keeps warnings separate from invalid errors", () => {
    const result = verifyEvidenceProof({
      ...proof,
      bundle: {
        ...proof.bundle,
        risks: [{ id: "risk_1", kind: "failed_check", severity: "warning", message: "Risk remains.", evidenceIds: [] }],
      },
    });

    expect(result.valid).toBe(true);
    expect(result.result).toBe("valid_with_warnings");
    expect(result.summary.errors).toBe(0);
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
});
