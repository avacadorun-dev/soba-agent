import { describe, expect, test } from "bun:test";
import { EvidenceLedger } from "../../../src/engine/evidence/evidence-ledger";

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
      output: "../../../src/engine/turn/agent-loop",
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
    expect(summary.unresolvedVerificationFailureIds).toEqual([]);
    expect(summary.verificationEvidenceCallIds).toEqual(new Set(["test_pass"]));
  });

  test("explicit verification kind metadata verifies arbitrary command text", () => {
    const ledger = new EvidenceLedger();
    const mutation = ledger.recordToolOutcome({
      toolCallId: "write_1",
      toolName: "write",
      arguments: JSON.stringify({ path: "src/parser.ts" }),
      isError: false,
      output: "wrote",
      iteration: 1,
    });

    const verification = ledger.recordToolOutcome({
      toolCallId: "custom_ci_pass",
      toolName: "bash",
      arguments: recordArgs("custom-ci --users-suite"),
      isError: false,
      output: "ok",
      iteration: 2,
      verificationKind: "test",
    });

    const summary = ledger.getSummary();
    expect(verification).toMatchObject({
      kind: "verification",
      status: "success",
      command: "custom-ci --users-suite",
      verificationKind: "test",
      mutationIds: [mutation.id],
    });
    expect(summary.needsVerification).toBe(false);
    expect(summary.verificationEvidenceCallIds).toEqual(new Set(["custom_ci_pass"]));
  });

  test("successful non-probe bash command verifies arbitrary language project mutations as generic run", () => {
    const ledger = new EvidenceLedger();
    const mutation = ledger.recordToolOutcome({
      toolCallId: "edit_zig",
      toolName: "edit",
      arguments: JSON.stringify({ path: "src/main.zig" }),
      isError: false,
      output: "edited",
      iteration: 1,
    });

    const verification = ledger.recordToolOutcome({
      toolCallId: "zig_verify",
      toolName: "bash",
      arguments: recordArgs("zig build test"),
      isError: false,
      output: "All tests passed",
      iteration: 2,
    });

    const summary = ledger.getSummary();
    expect(verification).toMatchObject({
      kind: "verification",
      status: "success",
      command: "zig build test",
      verificationKind: "test",
      mutationIds: [mutation.id],
    });
    expect(summary.needsVerification).toBe(false);
    expect(summary.verificationEvidenceCallIds).toEqual(new Set(["zig_verify"]));
  });

  test("successful custom verification command without known tool name counts as generic run", () => {
    const ledger = new EvidenceLedger();
    const mutation = ledger.recordToolOutcome({
      toolCallId: "edit_cobol",
      toolName: "edit",
      arguments: JSON.stringify({ path: "legacy/PAYROLL.COB" }),
      isError: false,
      output: "edited",
      iteration: 1,
    });

    const verification = ledger.recordToolOutcome({
      toolCallId: "make_verify",
      toolName: "bash",
      arguments: recordArgs("make verify"),
      isError: false,
      output: "ok",
      iteration: 2,
    });

    const summary = ledger.getSummary();
    expect(verification).toMatchObject({
      kind: "verification",
      status: "success",
      command: "make verify",
      verificationKind: "run",
      mutationIds: [mutation.id],
    });
    expect(summary.needsVerification).toBe(false);
    expect(summary.verificationEvidenceCallIds).toEqual(new Set(["make_verify"]));
  });

  test("failed verification remains unresolved until same kind passes later", () => {
    const ledger = new EvidenceLedger();
    ledger.recordToolOutcome({
      toolCallId: "edit_1",
      toolName: "edit",
      arguments: JSON.stringify({ path: "src/parser.ts" }),
      isError: false,
      output: "edited",
      iteration: 1,
    });
    ledger.recordToolOutcome({
      toolCallId: "typecheck_fail",
      toolName: "bash",
      arguments: recordArgs("bun run typecheck"),
      isError: true,
      output: "typecheck failed",
      iteration: 2,
    });
    const failed = ledger.getEntries().find((entry) => entry.kind === "verification" && entry.status === "failure");

    expect(failed).toBeDefined();
    if (!failed) throw new Error("Expected failed verification evidence");
    expect(ledger.getSummary().unresolvedVerificationFailureIds).toEqual([failed.id]);

    ledger.recordToolOutcome({
      toolCallId: "typecheck_pass",
      toolName: "bash",
      arguments: recordArgs("bun run typecheck"),
      isError: false,
      output: "typecheck passed",
      iteration: 3,
    });

    expect(ledger.getSummary().unresolvedVerificationFailureIds).toEqual([]);
  });

  test("pytest -v verification resolves earlier pytest failure and survives memory writes", () => {
    const ledger = new EvidenceLedger();
    ledger.recordToolOutcome({
      toolCallId: "edit_1",
      toolName: "edit",
      arguments: JSON.stringify({ path: "app/main.py" }),
      isError: false,
      output: "edited",
      iteration: 1,
    });
    const failed = ledger.recordToolOutcome({
      toolCallId: "pytest_fail",
      toolName: "bash",
      arguments: recordArgs("uv run pytest -v 2>&1"),
      isError: true,
      output: "FAILED app/tests/test_users.py::test_create_user",
      iteration: 2,
    });

    expect(failed).toMatchObject({ kind: "diagnostic", status: "active" });
    expect(ledger.getSummary().unresolvedVerificationFailureIds).toHaveLength(1);

    const passed = ledger.recordToolOutcome({
      toolCallId: "pytest_pass",
      toolName: "bash",
      arguments: recordArgs("uv run pytest -v 2>&1"),
      isError: false,
      output: "11 passed in 0.16s",
      iteration: 3,
    });
    ledger.recordToolOutcome({
      toolCallId: "memory_read_1",
      toolName: "read_project_memory",
      arguments: JSON.stringify({ kind: "capsules" }),
      isError: false,
      output: "read memory capsules",
      iteration: 4,
    });
    ledger.recordToolOutcome({
      toolCallId: "memory_write_1",
      toolName: "write_project_memory",
      arguments: JSON.stringify({ target: "capsule" }),
      isError: false,
      output: "stored memory capsule",
      iteration: 5,
    });

    const summary = ledger.getSummary();
    expect(passed).toMatchObject({ kind: "verification", status: "success", verificationKind: "test" });
    expect(summary.needsVerification).toBe(false);
    expect(summary.unverifiedMutationIds).toEqual([]);
    expect(summary.unresolvedVerificationFailureIds).toEqual([]);
    expect(summary.verificationEvidenceCallIds).toEqual(new Set(["pytest_pass"]));
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

  test("verification piped through tail or masked tee wrapper is diagnostic only", () => {
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

    const maskedTee = ledger.recordToolOutcome({
      toolCallId: "typecheck_tee",
      toolName: "bash",
      arguments: recordArgs('bun run typecheck 2>&1 | tee /tmp/typecheck.txt; echo "---typecheck exit: ${PIPESTATUS[0]}"'),
      isError: false,
      output: "0 errors\n---typecheck exit: 0",
      iteration: 3,
    });

    const afterTee = ledger.getSummary();
    expect(maskedTee).toMatchObject({ kind: "inspect", status: "success" });
    expect(afterTee.needsVerification).toBe(true);
    expect(afterTee.verificationEvidenceCallIds).toEqual(new Set());
    expect(afterTee.verificationKinds).toEqual(new Set());
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
