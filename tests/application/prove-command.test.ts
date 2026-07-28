import { describe, expect, test } from "bun:test";
import {
  type EvidenceProofDocument,
  executeProveCommand,
  proveCommandExitCode,
  renderProveCommandView,
} from "../../src/application/commands/prove";
import { sealProofBundle } from "../../src/application/evidence/public";

describe("prove command", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const proof: EvidenceProofDocument = {
    path: "/repo/.soba/evidence/proof.soba-proof.json",
    bundle: sealProofBundle({
      version: 1,
      sessionId: "sess_1",
      turnId: "turn_1",
      status: "verified",
      summary: "Implemented proof persistence.",
      evidence: [
        {
          id: "ev_mutation_edit_1",
          kind: "mutation",
          status: "success",
          summary: "Updated src/app.ts",
          timestamp: 0,
          toolCallId: "edit_1",
          toolName: "edit",
          files: ["src/app.ts"],
        },
        {
          id: "ev_verification_bash_1",
          kind: "verification",
          status: "success",
          summary: "Verification command passed: bun test",
          timestamp: 1,
          toolCallId: "bash_1",
          command: "bun test",
          mutationIds: ["ev_mutation_edit_1"],
        },
      ],
      claims: [
        {
          id: "claim_1",
          claim: "Proof persistence is implemented",
          status: "supported",
          evidenceIds: ["ev_verification_bash_1"],
        },
      ],
      changedFiles: [{
        path: "src/app.ts",
        operation: "modified",
        source: "tool_edit",
        added: 3,
        removed: 1,
        mutationIds: ["ev_mutation_edit_1"],
      }],
      diff: {
        files: [{
          path: "src/app.ts",
          operation: "modified",
          added: 3,
          removed: 1,
          mutationIds: ["ev_mutation_edit_1"],
          truncated: false,
        }],
        fileCount: 1,
        added: 3,
        removed: 1,
        truncated: false,
      },
      commands: [
        {
          id: "cmd_bash_1",
          command: "bun test",
          status: "passed",
          exitCode: 0,
          durationMs: 42,
          outputDigest: digest,
        },
      ],
      checks: [
        {
          id: "check_inspect_1",
          label: "Manual inspection",
          status: "passed",
          verificationKind: "manual_inspection",
        },
        {
          id: "check_inspect_2",
          label: "Diff inspection",
          status: "passed",
          verificationKind: "diff_inspection",
        },
        { id: "check_1", label: "Tests", status: "passed", commandId: "cmd_bash_1" },
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

  test("renders the latest proof as text by default", () => {
    const view = executeProveCommand({
      args: [],
      reader: {
        readLatestEvidenceBundle: () => proof,
        readEvidenceBundle: () => {
          throw new Error("not expected");
        },
      },
    });

    expect(view.kind).toBe("proof");
    expect(proveCommandExitCode(view)).toBe(0);
    const rendered = renderProveCommandView(view);
    expect(rendered).toContain("SOBA Proof · Verified");
    expect(rendered).toContain("Changed files: 1 file (+3/-1)");
    expect(rendered).toContain("Checks: 1 passed");
    expect(rendered).toContain("✓ 1. Proof persistence is implemented · supported");
    expect(rendered).not.toContain("ev_verification_bash_1");
  });

  test("renders explicit proof path as compact markdown", () => {
    const view = executeProveCommand({
      args: ["proof.json", "--format", "markdown"],
      reader: {
        readLatestEvidenceBundle: () => null,
        readEvidenceBundle: (path) => ({ ...proof, path }),
      },
    });

    const rendered = renderProveCommandView(view);
    expect(rendered).toContain("# SOBA Proof · Verified");
    expect(rendered).toContain("- ✓ 1. Proof persistence is implemented · supported");
    expect(rendered).not.toContain("## Permissions");
  });

  test("restores technical proof fields with --verbose", () => {
    const view = executeProveCommand({
      args: ["--verbose"],
      reader: {
        readLatestEvidenceBundle: () => proof,
        readEvidenceBundle: () => proof,
      },
    });

    const rendered = renderProveCommandView(view);
    expect(rendered).toContain(`Proof ID: ${proof.bundle.proofId}`);
    expect(rendered).toContain("Claims: Proof persistence is implemented supported (ev_verification_bash_1)");
    expect(rendered).toContain(`bun test passed exit=0 duration=42ms digest=${digest}`);
    expect(rendered).toContain("Permissions: bash: bun test auto trust=safe reason=safe test command alternatives=1");
  });

  test("shows the verifier verdict instead of trusting a stored verified status", () => {
    const tampered: EvidenceProofDocument = {
      ...proof,
      bundle: { ...proof.bundle, summary: "Tampered after sealing." },
    };
    const view = executeProveCommand({
      args: [],
      reader: {
        readLatestEvidenceBundle: () => tampered,
        readEvidenceBundle: () => tampered,
      },
    });

    const rendered = renderProveCommandView(view);
    expect(rendered).toContain("SOBA Proof · Needs attention");
    expect(rendered).toContain("Verification: invalid proof");
    expect(rendered).not.toContain("SOBA Proof · Verified");
  });

  test("renders json with proofPath", () => {
    const view = executeProveCommand({
      args: ["--format=json"],
      reader: {
        readLatestEvidenceBundle: () => proof,
        readEvidenceBundle: () => {
          throw new Error("not expected");
        },
      },
    });

    const rendered = renderProveCommandView(view);
    expect(JSON.parse(rendered)).toMatchObject({
      proofPath: proof.path,
      status: "verified",
    });
  });

  test("reports empty proof directory", () => {
    const view = executeProveCommand({
      args: ["--last"],
      evidenceDir: "/repo/.soba/evidence",
      reader: {
        readLatestEvidenceBundle: () => null,
        readEvidenceBundle: () => {
          throw new Error("not expected");
        },
      },
    });

    expect(view.kind).toBe("empty");
    expect(proveCommandExitCode(view)).toBe(1);
    expect(renderProveCommandView(view)).toContain("/repo/.soba/evidence");
  });

  test("rejects invalid format", () => {
    const view = executeProveCommand({
      args: ["--format", "xml"],
      reader: {
        readLatestEvidenceBundle: () => proof,
        readEvidenceBundle: () => proof,
      },
    });

    expect(view.kind).toBe("usage");
    expect(proveCommandExitCode(view)).toBe(1);
    expect(renderProveCommandView(view)).toContain("Usage: soba prove");
  });
});
