import { describe, expect, test } from "bun:test";
import { type CompletionState, evaluateCompletion } from "../../../src/engine/completion/completion-gate";
import { EvidenceLedger } from "../../../src/engine/evidence/evidence-ledger";
import {
  classifyFailure,
  type FailureRecord,
  type FailureSignal,
  type KnownFailureDeclaration,
} from "../../../src/engine/verification/verification-baseline";

function signal(overrides: Partial<FailureSignal> = {}): FailureSignal {
  return {
    command: "bun test",
    exitCode: 1,
    failingTestIds: ["tests/foreign/workstream.test.ts"],
    implicatedFiles: [{ path: "tests/foreign/workstream.test.ts", sha256: "aaa" }],
    ...overrides,
  };
}

function baseInput(overrides: Partial<Parameters<typeof classifyFailure>[0]> = {}) {
  return {
    record: { id: "ev_verification_1" } as FailureRecord,
    agentChangedFiles: [] as string[],
    acceptanceCommands: [] as string[],
    knownFailures: [] as KnownFailureDeclaration[],
    ...overrides,
  };
}

describe("classifyFailure", () => {
  test("failure matching the recorded baseline is a non-blocking pre-existing failure", () => {
    const result = classifyFailure(baseInput({
      record: { id: "f1", command: "bun test", failureSignal: signal(), baselineMatch: "matches_baseline" },
    }));

    expect(result.status).toBe("unrelated_pre_existing_failure");
    expect(result.blocking).toBe(false);
    expect(result.reason).toContain("bun test");
    expect(result.reason).toContain("tests/foreign/workstream.test.ts");
  });

  test("failure that touches an agent-changed file is agent-caused and blocks", () => {
    const result = classifyFailure(baseInput({
      record: { id: "f1", command: "bun test", failureSignal: signal(), baselineMatch: "matches_baseline" },
      agentChangedFiles: ["tests/foreign/workstream.test.ts"],
    }));

    expect(result.status).toBe("agent_caused");
    expect(result.blocking).toBe(true);
  });

  test("a declaration never covers a file the agent changed this session", () => {
    const knownFailures: KnownFailureDeclaration[] = [{
      declaredBy: "repo_policy",
      files: ["tests/foreign/workstream.test.ts"],
    }];
    const result = classifyFailure(baseInput({
      record: { id: "f1", command: "bun test", failureSignal: signal(), baselineMatch: "matches_baseline" },
      agentChangedFiles: ["tests/foreign/workstream.test.ts"],
      knownFailures,
    }));

    expect(result.status).toBe("agent_caused");
    expect(result.blocking).toBe(true);
  });

  test("new failure relative to baseline blocks and fails closed", () => {
    const result = classifyFailure(baseInput({
      record: { id: "f1", command: "bun test", failureSignal: signal(), baselineMatch: "differs_from_baseline" },
    }));

    expect(result.status).toBe("new_failure");
    expect(result.blocking).toBe(true);
    expect(result.reason).toContain("failing:");
  });

  test("unknown failure without signal or baseline blocks (fail closed)", () => {
    const result = classifyFailure(baseInput({ record: { id: "f1", command: "bun test" } }));

    expect(result.status).toBe("new_failure");
    expect(result.blocking).toBe(true);
  });

  test("user-declared exception covers a matching untouched failure", () => {
    const knownFailures: KnownFailureDeclaration[] = [{
      declaredBy: "user",
      command: "bun test",
      failingTestIds: ["tests/foreign/workstream.test.ts"],
      note: "tracked in issue #123",
    }];
    const result = classifyFailure(baseInput({
      record: { id: "f1", command: "bun test", failureSignal: signal(), baselineMatch: "differs_from_baseline" },
      knownFailures,
    }));

    expect(result.status).toBe("unrelated_pre_existing_failure");
    expect(result.blocking).toBe(false);
    expect(result.reason).toContain("user");
    expect(result.reason).toContain("issue #123");
  });

  test("explicit acceptance command failure always blocks", () => {
    const result = classifyFailure(baseInput({
      record: { id: "f1", command: "bun run acceptance", failureSignal: signal({ command: "bun run acceptance" }), baselineMatch: "recorded_baseline" },
      acceptanceCommands: ["bun run acceptance"],
    }));

    expect(result.status).toBe("new_failure");
    expect(result.blocking).toBe(true);
    expect(result.reason).toContain("acceptance command");
  });

  test("timed-out run is reported as blocked_by_environment", () => {
    const result = classifyFailure(baseInput({
      record: { id: "f1", command: "bun test", timedOut: true, failureSignal: signal({ exitCode: null }) },
    }));

    expect(result.status).toBe("blocked_by_environment");
    expect(result.blocking).toBe(true);
  });
});

describe("completion gate with session baselines", () => {
  function completedRequest() {
    return {
      summary: "done",
      status: "completed" as const,
      criteria: [{ criterion: "implemented" }],
      acknowledgedErrorIds: [] as string[],
    };
  }

  function gateState(ledger: EvidenceLedger): CompletionState {
    return {
      ...ledger.toCompletionState([]),
      errors: [],
      taskKind: "feature",
    } as CompletionState;
  }

  function failCommand(ledger: EvidenceLedger, callId: string, command: string, output: string, files: string[] = []) {
    ledger.recordToolOutcome({
      toolCallId: callId,
      toolName: "bash",
      arguments: JSON.stringify({ command }),
      isError: true,
      output,
      iteration: 1,
      details: {
        command,
        exitCode: 1,
        failureSignal: {
          command,
          exitCode: 1,
          failingTestIds: ["tests/foreign/workstream.test.ts"],
          implicatedFiles: files.map((path) => ({ path, sha256: "abc" })),
        },
      },
    });
  }

  test("red suite unchanged by the agent does not block completed", () => {
    const ledger = new EvidenceLedger();
    failCommand(ledger, "run_1", "bun test", "fail tests/foreign/workstream.test.ts", [
      "tests/foreign/workstream.test.ts",
    ]);
    ledger.recordToolOutcome({
      toolCallId: "edit_1",
      toolName: "edit",
      arguments: JSON.stringify({ path: "src/own.ts" }),
      isError: false,
      output: "ok",
      iteration: 2,
    });
    failCommand(ledger, "run_2", "bun test", "fail tests/foreign/workstream.test.ts", [
      "tests/foreign/workstream.test.ts",
    ]);
    ledger.recordToolOutcome({
      toolCallId: "verify_2",
      toolName: "bash",
      arguments: JSON.stringify({ command: "bun run typecheck" }),
      isError: false,
      output: "ok",
      iteration: 3,
    });

    const decision = evaluateCompletion(completedRequest(), gateState(ledger));

    expect(decision.accepted).toBe(true);
    if (decision.accepted) {
      const baseline = decision.classifications?.find((c) => c.failureId !== "unverified_changes");
      expect(baseline?.status).toBe("unrelated_pre_existing_failure");
      expect(baseline?.reason).toContain("tests/foreign/workstream.test.ts");
    }
  });

  test("failure introduced by the agent blocks completed", () => {
    const ledger = new EvidenceLedger();
    ledger.recordToolOutcome({
      toolCallId: "pass_1",
      toolName: "bash",
      arguments: JSON.stringify({ command: "bun test" }),
      isError: false,
      output: "ok",
      iteration: 1,
    });
    ledger.recordToolOutcome({
      toolCallId: "edit_1",
      toolName: "edit",
      arguments: JSON.stringify({ path: "src/own.ts" }),
      isError: false,
      output: "ok",
      iteration: 2,
    });
    failCommand(ledger, "run_2", "bun test", "fail src/own.ts", ["src/own.ts"]);

    const decision = evaluateCompletion(completedRequest(), gateState(ledger));

    expect(decision.accepted).toBe(false);
    if (!decision.accepted) {
      expect(decision.reasons.join("\n")).toContain("agent");
    }
  });

  test("agent cannot suppress its own broken test by citing a pre-existing exception", () => {
    const ledger = new EvidenceLedger();
    ledger.setKnownFailures([{
      declaredBy: "repo_policy",
      command: "bun test",
      failingTestIds: ["tests/app.test.ts"],
      files: ["tests/app.test.ts"],
    }]);
    failCommand(ledger, "run_1", "bun test", "fail tests/app.test.ts", ["tests/app.test.ts"]);
    ledger.recordToolOutcome({
      toolCallId: "edit_1",
      toolName: "edit",
      arguments: JSON.stringify({ path: "tests/app.test.ts" }),
      isError: false,
      output: "ok",
      iteration: 2,
    });

    const decision = evaluateCompletion(completedRequest(), gateState(ledger));

    expect(decision.accepted).toBe(false);
    if (!decision.accepted) {
      expect(decision.reasons.join("\n")).toContain("tests/app.test.ts");
    }
  });
});
