import { describe, expect, test } from "bun:test";
import {
  type EvidenceProofDocument,
  executeProveCommand,
  proveCommandExitCode,
  renderProveCommandView,
} from "../../src/application/commands/prove";
import { sealProofBundle } from "../../src/application/evidence/public";

describe("prove command", () => {
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
          summary: "edit changed src/app.ts",
          timestamp: 1,
          toolCallId: "edit_1",
          files: ["src/app.ts"],
        },
        {
          id: "ev_verification_bash_1",
          kind: "verification",
          status: "success",
          summary: "Verification command passed: bun test",
          timestamp: 2,
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
        added: 3,
        removed: 1,
        mutationIds: ["ev_mutation_edit_1"],
      }],
      commands: [
        {
          id: "cmd_bash_1",
          command: "bun test",
          status: "passed",
          toolCallId: "bash_1",
          exitCode: 0,
          durationMs: 42,
          outputDigest: `sha256:${"a".repeat(64)}`,
        },
      ],
      checks: [{ id: "check_ev_verification_bash_1", label: "Tests", status: "passed", commandId: "cmd_bash_1" }],
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
    expect(rendered).toContain("SOBA Verified Handoff");
    expect(rendered).toContain("Observed");
    expect(rendered).toContain("Tests: passed; command=`bun test`; exit=0; freshness=fresh");
    expect(rendered).toContain("Privileged actions: none recorded");
    expect(rendered).toContain("Declared");
    expect(rendered).toContain("Proof persistence is implemented: linked; human review required");
    expect(rendered).toContain("Unknown");
    expect(rendered).toContain("is linked to evidence but still requires human review");
    expect(rendered).toContain("Integrity\nStatus: verified");
    expect(rendered).toContain("Receipt digest: sha256:");
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
    expect(rendered).toContain("# SOBA Verified Handoff");
    expect(rendered).toContain("## Observed");
    expect(rendered).toContain("### Changed paths");
    expect(rendered).toContain("### Checks and exit codes");
    expect(rendered).toContain("freshness=fresh");
    expect(rendered).toContain("### Privileged actions\n- none recorded");
    expect(rendered).toContain("## Declared");
    expect(rendered).toContain("## Unknown / unresolved claims");
    expect(rendered).toContain("## Integrity");
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
    expect(JSON.parse(rendered).verifiedHandoff).toBeUndefined();
  });

  test("marks a check stale when a later mutation is not covered", () => {
    const staleProof: EvidenceProofDocument = {
      path: "stale.json",
      bundle: sealProofBundle({
        ...proof.bundle,
        proofId: undefined,
        runId: undefined,
        integrity: undefined,
        evidence: [
          { id: "ev_mutation_1", kind: "mutation", status: "success", summary: "first edit", timestamp: 1 },
          {
            id: "ev_verification_1",
            kind: "verification",
            status: "success",
            summary: "tests passed",
            timestamp: 2,
            toolCallId: "bash_1",
            command: "bun test",
            mutationIds: ["ev_mutation_1"],
          },
          { id: "ev_mutation_2", kind: "mutation", status: "unverified", summary: "later edit", timestamp: 3 },
        ],
        changedFiles: [{
          path: "src/app.ts",
          operation: "modified",
          mutationIds: ["ev_mutation_1", "ev_mutation_2"],
        }],
        commands: [{
          id: "cmd_bash_1",
          command: "bun test",
          status: "passed",
          toolCallId: "bash_1",
          exitCode: 0,
          outputDigest: `sha256:${"b".repeat(64)}`,
          outputTruncated: true,
        }],
        checks: [{ id: "check_ev_verification_1", label: "Tests", status: "passed", commandId: "cmd_bash_1" }],
      }),
    };
    const view = executeProveCommand({
      args: ["--format", "markdown"],
      reader: {
        readLatestEvidenceBundle: () => staleProof,
        readEvidenceBundle: () => staleProof,
      },
    });

    const rendered = renderProveCommandView(view);
    expect(rendered).toContain("freshness=stale");
    expect(rendered).toContain("Tests has stale freshness relative to recorded mutations.");
    expect(rendered).toContain("Tests has truncated command output.");
  });

  test("does not stale a check for a later mutation on an unrelated path", () => {
    const relatedProof: EvidenceProofDocument = {
      path: "related.json",
      bundle: {
        sessionId: "session",
        turnId: "turn",
        status: "partially_verified",
        summary: "Changed code and docs.",
        evidence: [
          { id: "ev_code_1", kind: "mutation", status: "success", summary: "code", timestamp: 1 },
          {
            id: "ev_test_1",
            kind: "verification",
            status: "success",
            summary: "tests",
            timestamp: 2,
            mutationIds: ["ev_code_1"],
            toolCallId: "test_1",
          },
          { id: "ev_docs_1", kind: "mutation", status: "unverified", summary: "docs", timestamp: 3 },
        ],
        changedFiles: [
          { path: "src/app.ts", operation: "modified", mutationIds: ["ev_code_1"] },
          { path: "README.md", operation: "modified", mutationIds: ["ev_docs_1"] },
        ],
        commands: [{ id: "cmd_1", command: "bun test", status: "passed", toolCallId: "test_1", exitCode: 0 }],
        checks: [{ id: "check_ev_test_1", label: "Tests", status: "passed", commandId: "cmd_1" }],
        claims: [],
        approvals: [],
        risks: [],
      },
    };
    const view = executeProveCommand({
      args: ["--format", "markdown"],
      reader: {
        readLatestEvidenceBundle: () => relatedProof,
        readEvidenceBundle: () => relatedProof,
      },
    });

    expect(renderProveCommandView(view)).toContain("Tests: passed; command=`bun test`; exit=0; freshness=fresh");
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
