import { describe, expect, test } from "bun:test";
import {
  type EvidenceProofDocument,
  executeProveCommand,
  proveCommandExitCode,
  renderProveCommandView,
} from "../../src/application/commands/prove";

describe("prove command", () => {
  const proof: EvidenceProofDocument = {
    path: "/repo/.soba/evidence/proof.soba-proof.json",
    bundle: {
      version: 1,
      sessionId: "sess_1",
      turnId: "turn_1",
      status: "verified",
      summary: "Implemented proof persistence.",
      evidence: [
        {
          id: "ev_verification_bash_1",
          kind: "verification",
          status: "success",
          summary: "Verification command passed: bun test",
          timestamp: 1,
          toolCallId: "bash_1",
          command: "bun test",
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
      changedFiles: [{ path: "src/app.ts", operation: "modified", added: 3, removed: 1 }],
      commands: [
        {
          id: "cmd_bash_1",
          command: "bun test",
          status: "passed",
          exitCode: 0,
          durationMs: 42,
          outputDigest: "sha256:abc123",
        },
      ],
      checks: [{ label: "Tests", status: "passed", commandId: "cmd_bash_1" }],
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
    },
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
    expect(rendered).toContain("SOBA Proof");
    expect(rendered).toContain("Proof ID: legacy-unsealed");
    expect(rendered).toContain("Status: verified");
    expect(rendered).toContain("Claims: Proof persistence is implemented supported (ev_verification_bash_1)");
    expect(rendered).toContain("bun test passed exit=0 duration=42ms digest=sha256:abc123");
    expect(rendered).toContain("Permissions: bash: bun test auto trust=safe reason=safe test command alternatives=1");
  });

  test("renders explicit proof path as markdown", () => {
    const view = executeProveCommand({
      args: ["proof.json", "--format", "markdown"],
      reader: {
        readLatestEvidenceBundle: () => null,
        readEvidenceBundle: (path) => ({ ...proof, path }),
      },
    });

    const rendered = renderProveCommandView(view);
    expect(rendered).toContain("# SOBA Proof");
    expect(rendered).toContain("- Proof persistence is implemented supported (ev_verification_bash_1)");
    expect(rendered).toContain("- Tests passed (bun test)");
    expect(rendered).toContain("## Permissions");
    expect(rendered).toContain("- bash: bun test auto trust=safe reason=safe test command alternatives=1");
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
