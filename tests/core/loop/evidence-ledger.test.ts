import { describe, expect, test } from "bun:test";
import { EvidenceLedger } from "../../../src/core/loop/evidence-ledger";

function recordArgs(command: string): string {
  return JSON.stringify({ command });
}

describe("EvidenceLedger", () => {
  test("write/edit records unverified mutation evidence", () => {
    const ledger = new EvidenceLedger();

    const entry = ledger.recordToolOutcome({
      toolCallId: "edit_1",
      toolName: "edit",
      arguments: JSON.stringify({ path: "src/file.ts" }),
      isError: false,
      output: "edited",
      iteration: 1,
    });

    const summary = ledger.getSummary();
    expect(entry).toMatchObject({ kind: "mutation", status: "unverified", toolCallId: "edit_1" });
    expect(summary.hasMutatedFiles).toBe(true);
    expect(summary.needsVerification).toBe(true);
    expect(summary.unverifiedMutationIds).toEqual([entry.id]);
  });

  test("read and search commands record inspect/search evidence", () => {
    const ledger = new EvidenceLedger();

    ledger.recordToolOutcome({
      toolCallId: "read_1",
      toolName: "read",
      arguments: JSON.stringify({ path: "README.md" }),
      isError: false,
      output: "readme",
      iteration: 1,
    });
    ledger.recordToolOutcome({
      toolCallId: "search_1",
      toolName: "bash",
      arguments: recordArgs("rg AgentLoop src tests"),
      isError: false,
      output: "src/core/loop/agent-loop.ts",
      iteration: 1,
    });

    expect(ledger.getEntries().map((entry) => entry.kind)).toEqual(["inspect", "search"]);
  });

  test("failed tool creates active diagnostic evidence", () => {
    const ledger = new EvidenceLedger();

    const entry = ledger.recordToolOutcome({
      toolCallId: "lint_1",
      toolName: "bash",
      arguments: recordArgs("bun run lint"),
      isError: true,
      output: "lint failed",
      iteration: 1,
    });

    const summary = ledger.getSummary();
    expect(entry).toMatchObject({ kind: "diagnostic", status: "active", command: "bun run lint" });
    expect(summary.activeDiagnosticIds).toEqual([entry.id]);
  });

  test("successful verification command verifies mutations and resolves diagnostics", () => {
    const ledger = new EvidenceLedger();
    const mutation = ledger.recordToolOutcome({
      toolCallId: "write_1",
      toolName: "write",
      arguments: JSON.stringify({ path: "src/parser.ts" }),
      isError: false,
      output: "wrote",
      iteration: 1,
    });
    const diagnostic = ledger.recordToolOutcome({
      toolCallId: "test_fail",
      toolName: "bash",
      arguments: recordArgs("bun test tests/parser.test.ts"),
      isError: true,
      output: "expected 1 got 0",
      iteration: 2,
    });

    const verification = ledger.recordToolOutcome({
      toolCallId: "test_pass",
      toolName: "bash",
      arguments: recordArgs("bun test tests/parser.test.ts"),
      isError: false,
      output: "1 pass",
      iteration: 3,
    });

    const summary = ledger.getSummary();
    expect(verification).toMatchObject({
      kind: "verification",
      status: "success",
      command: "bun test tests/parser.test.ts",
      mutationIds: [mutation.id],
      resolves: [diagnostic.id],
    });
    expect(summary.needsVerification).toBe(false);
    expect(summary.unverifiedMutationIds).toEqual([]);
    expect(summary.activeDiagnosticIds).toEqual([]);
    expect(summary.verificationEvidenceCallIds).toEqual(new Set(["test_pass"]));
  });

  test("successful probe commands do not verify previous mutations", () => {
    const ledger = new EvidenceLedger();
    const mutation = ledger.recordToolOutcome({
      toolCallId: "edit_1",
      toolName: "edit",
      arguments: JSON.stringify({ path: "src/parser.ts" }),
      isError: false,
      output: "edited",
      iteration: 1,
    });

    const probe = ledger.recordToolOutcome({
      toolCallId: "lint_help",
      toolName: "bash",
      arguments: recordArgs("bun lint --help 2>&1 | head -20"),
      isError: false,
      output: "Usage: bun",
      iteration: 2,
    });

    const summary = ledger.getSummary();
    expect(probe).toMatchObject({ kind: "inspect", status: "success", toolCallId: "lint_help" });
    expect(summary.needsVerification).toBe(true);
    expect(summary.unverifiedMutationIds).toEqual([mutation.id]);
    expect(summary.verificationEvidenceCallIds).toEqual(new Set());
    expect(summary.verificationKinds).toEqual(new Set());
  });

  test("verification piped through tail is diagnostic only", () => {
    const ledger = new EvidenceLedger();
    ledger.recordToolOutcome({
      toolCallId: "write_1",
      toolName: "write",
      arguments: JSON.stringify({ path: "src/app.ts" }),
      isError: false,
      output: "wrote",
      iteration: 1,
    });

    const masked = ledger.recordToolOutcome({
      toolCallId: "test_tail",
      toolName: "bash",
      arguments: recordArgs("bun test 2>&1 | tail -80"),
      isError: false,
      output: "50 pass",
      iteration: 2,
    });

    const summary = ledger.getSummary();
    expect(masked).toMatchObject({ kind: "inspect", status: "success" });
    expect(summary.needsVerification).toBe(true);
    expect(summary.verificationEvidenceCallIds).toEqual(new Set());
  });

  test("summary maps ledger evidence to completion state", () => {
    const ledger = new EvidenceLedger();
    ledger.recordToolOutcome({
      toolCallId: "edit_1",
      toolName: "edit",
      arguments: JSON.stringify({ path: "src/file.ts" }),
      isError: false,
      output: "edited",
      iteration: 1,
    });

    const completionState = ledger.toCompletionState([]);

    expect(completionState.hasUsedTools).toBe(true);
    expect(completionState.hasMutatedFiles).toBe(true);
    expect(completionState.needsVerification).toBe(true);
    expect(completionState.successfulToolCallIds).toEqual(new Set(["edit_1"]));
    expect(completionState.verificationEvidenceCallIds).toEqual(new Set());
  });
});
