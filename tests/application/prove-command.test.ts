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
      risks: [],
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
    expect(rendered).toContain("Status: verified");
    expect(rendered).toContain("bun test passed exit=0 duration=42ms digest=sha256:abc123");
  });

  test("renders explicit proof path as markdown", () => {
    const view = executeProveCommand({
      args: ["proof.json", "--format", "markdown"],
      reader: {
        readLatestEvidenceBundle: () => null,
        readEvidenceBundle: (path) => ({ ...proof, path }),
      },
    });

    expect(renderProveCommandView(view)).toContain("# SOBA Proof");
    expect(renderProveCommandView(view)).toContain("- Tests passed (bun test)");
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
