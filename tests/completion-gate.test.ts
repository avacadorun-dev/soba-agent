import { describe, expect, test } from "bun:test";
import {
  diagnoseFinishArguments,
  evaluateCompletion,
  parseFinishRequest,
} from "../src/engine/completion/completion-gate";
import type { TaskKind, VerificationKind } from "../src/engine/verification/verification-policy";

function makeToolCall(args: string): import("../src/kernel/model/openresponses-types").FunctionCallField {
  return {
    type: "function_call",
    id: "fc_test_1",
    call_id: "test_call_1",
    name: "finish",
    arguments: args,
    status: "completed",
  };
}

function completedRequest(): NonNullable<ReturnType<typeof parseFinishRequest>> {
  const request = parseFinishRequest(
    makeToolCall(
      JSON.stringify({
        summary: "Готово",
        status: "completed",
        criteria: [{ criterion: "Work done" }],
      }),
    ),
  );
  if (!request) throw new Error("invalid test finish request");
  return request;
}

function baseState(overrides: {
  taskKind?: TaskKind;
  successfulToolCallIds?: Set<string>;
  verificationEvidenceCallIds?: Set<string>;
  inspectionEvidenceCallIds?: Set<string>;
  verificationKinds?: Set<VerificationKind>;
  needsVerification?: boolean;
  hasUsedTools?: boolean;
  hasMutatedFiles?: boolean;
  hasCodeMutations?: boolean;
  hasDocsMutations?: boolean;
  unverifiedMutationIds?: string[];
  unverifiedCodeMutationIds?: string[];
  unverifiedDocsMutationIds?: string[];
  unresolvedVerificationFailureIds?: string[];
  evidenceIds?: Set<string>;
  allowUnverifiedCompletion?: boolean;
} = {}) {
  return {
    errors: [],
    successfulToolCallIds: overrides.successfulToolCallIds ?? new Set(["call_1"]),
    verificationEvidenceCallIds: overrides.verificationEvidenceCallIds ?? new Set(),
    inspectionEvidenceCallIds: overrides.inspectionEvidenceCallIds ?? new Set(),
    verificationKinds: overrides.verificationKinds ?? new Set(),
    needsVerification: overrides.needsVerification ?? false,
    hasUsedTools: overrides.hasUsedTools ?? true,
    hasMutatedFiles: overrides.hasMutatedFiles ?? false,
    hasCodeMutations: overrides.hasCodeMutations ?? false,
    hasDocsMutations: overrides.hasDocsMutations ?? false,
    unverifiedMutationIds: overrides.unverifiedMutationIds ?? [],
    unverifiedCodeMutationIds: overrides.unverifiedCodeMutationIds ?? [],
    unverifiedDocsMutationIds: overrides.unverifiedDocsMutationIds ?? [],
    unresolvedVerificationFailureIds: overrides.unresolvedVerificationFailureIds ?? [],
    taskKind: overrides.taskKind,
    evidenceIds: overrides.evidenceIds,
    allowUnverifiedCompletion: overrides.allowUnverifiedCompletion,
  };
}

describe("diagnoseFinishArguments", () => {
  test("валидные аргументы — пустой список проблем", () => {
    const issues = diagnoseFinishArguments(
      makeToolCall(
        JSON.stringify({
          summary: "Готово",
          status: "completed",
          criteria: [{ criterion: "Work is done" }],
        }),
      ),
    );
    expect(issues).toHaveLength(0);
  });

  test("невалидный JSON", () => {
    const issues = diagnoseFinishArguments(makeToolCall("not json"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("not valid JSON");
  });

  test("пустое summary", () => {
    const issues = diagnoseFinishArguments(
      makeToolCall(
        JSON.stringify({
          summary: "",
          status: "completed",
          criteria: [{ criterion: "ok" }],
        }),
      ),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("summary");
  });

  test("отсутствует summary", () => {
    const issues = diagnoseFinishArguments(
      makeToolCall(JSON.stringify({ status: "completed", criteria: [] })),
    );
    expect(issues.some((i) => i.includes("summary"))).toBe(true);
  });

  test("невалидный status", () => {
    const issues = diagnoseFinishArguments(
      makeToolCall(
        JSON.stringify({
          summary: "ok",
          status: "done",
          criteria: [{ criterion: "ok" }],
        }),
      ),
    );
    expect(issues.some((i) => i.includes("status"))).toBe(true);
  });

  test("отсутствует criteria", () => {
    const issues = diagnoseFinishArguments(
      makeToolCall(
        JSON.stringify({ summary: "ok", status: "completed" }),
      ),
    );
    expect(issues.some((i) => i.includes("criteria"))).toBe(true);
  });

  test("пустой criteria array", () => {
    const issues = diagnoseFinishArguments(
      makeToolCall(
        JSON.stringify({
          summary: "ok",
          status: "completed",
          criteria: [],
        }),
      ),
    );
    expect(issues.some((i) => i.includes("criteria") && i.includes("empty"))).toBe(true);
  });

  test("несколько проблем одновременно", () => {
    const issues = diagnoseFinishArguments(
      makeToolCall(
        JSON.stringify({
          summary: "",
          status: "completed",
          criteria: [],
        }),
      ),
    );
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });

  test("blocked status без criteria — допустимо", () => {
    const issues = diagnoseFinishArguments(
      makeToolCall(
        JSON.stringify({
          summary: "Блокировка",
          status: "blocked",
          criteria: [],
        }),
      ),
    );
    // diagnoseCriteria для пустого массива возвращает warning, но это не блокирует blocked status
    expect(issues.some((i) => i.includes("summary"))).toBe(false);
    expect(issues.some((i) => i.includes("status"))).toBe(false);
  });

  test("criteria[].evidenceIds должен быть массивом строк", () => {
    const issues = diagnoseFinishArguments(
      makeToolCall(
        JSON.stringify({
          summary: "ok",
          status: "completed",
          criteria: [{ criterion: "ok", evidenceIds: ["ev_1", 42] }],
        }),
      ),
    );

    expect(issues.some((issue) => issue.includes("criteria[0].evidenceIds"))).toBe(true);
  });
});

describe("parseFinishRequest", () => {
  test("парсит валидный finish", () => {
    const req = parseFinishRequest(
      makeToolCall(
        JSON.stringify({
          summary: "Готово",
          status: "completed",
          criteria: [{ criterion: "Work done" }],
        }),
      ),
    );
    expect(req).not.toBeNull();
    expect(req!.summary).toBe("Готово");
    expect(req!.status).toBe("completed");
    expect(req!.criteria).toHaveLength(1);
  });

  test("возвращает null для невалидного JSON", () => {
    expect(parseFinishRequest(makeToolCall("not json"))).toBeNull();
  });

  test("возвращает null для пустого summary", () => {
    expect(
      parseFinishRequest(
        makeToolCall(
          JSON.stringify({
            summary: "",
            status: "completed",
            criteria: [{ criterion: "ok" }],
          }),
        ),
      ),
    ).toBeNull();
  });

  test("возвращает null если есть legacy message без summary", () => {
    expect(
      parseFinishRequest(
        makeToolCall(
          JSON.stringify({
            message: "legacy",
            status: "completed",
            criteria: [{ criterion: "ok" }],
          }),
        ),
      ),
    ).toBeNull();
  });

  test("парсит completed_with_unverified_changes и optional evidenceIds", () => {
    const req = parseFinishRequest(
      makeToolCall(
        JSON.stringify({
          summary: "Готово, но проверки не запускались",
          status: "completed_with_unverified_changes",
          criteria: [{ criterion: "Patch applied", evidenceIds: ["ev_mutation_1"] }],
        }),
      ),
    );

    expect(req).not.toBeNull();
    expect(req!.status).toBe("completed_with_unverified_changes");
    expect(req!.criteria[0]?.evidenceIds).toEqual(["ev_mutation_1"]);
  });

  test("возвращает null для неправильного status", () => {
    expect(
      parseFinishRequest(
        makeToolCall(
          JSON.stringify({
            summary: "ok",
            status: "done",
            criteria: [{ criterion: "ok" }],
          }),
        ),
      ),
    ).toBeNull();
  });
});

describe("evaluateCompletion", () => {
  test("принимает finish без ошибок", () => {
    const decision = evaluateCompletion(
      {
        summary: "Готово",
        status: "completed",
        criteria: [{ criterion: "Work done" }],
        acknowledgedErrorIds: [],
      },
      {
        errors: [],
        successfulToolCallIds: new Set(["call_1"]),
        verificationEvidenceCallIds: new Set(["call_1"]),
        needsVerification: false,
        hasUsedTools: true,
        hasMutatedFiles: false,
      },
    );
    expect(decision.accepted).toBe(true);
  });

  test("отклоняет completed без successful tool calls", () => {
    const decision = evaluateCompletion(
      {
        summary: "Готово",
        status: "completed",
        criteria: [{ criterion: "Work done" }],
        acknowledgedErrorIds: [],
      },
      {
        errors: [],
        successfulToolCallIds: new Set(),
        verificationEvidenceCallIds: new Set(),
        needsVerification: false,
        hasUsedTools: true,
        hasMutatedFiles: false,
      },
    );
    expect(decision.accepted).toBe(false);
    if (!decision.accepted) {
      expect(decision.reasons.some((r: string) => r.includes("successful tool call"))).toBe(true);
    }
  });

  test("принимает blocked без successful tool calls", () => {
    const decision = evaluateCompletion(
      {
        summary: "Не могу продолжить",
        status: "blocked",
        criteria: [],
        acknowledgedErrorIds: [],
      },
      {
        errors: [],
        successfulToolCallIds: new Set(),
        verificationEvidenceCallIds: new Set(),
        needsVerification: false,
        hasUsedTools: true,
        hasMutatedFiles: false,
      },
    );
    expect(decision.accepted).toBe(true);
  });

  test("UC-AL-01 отклоняет bug fix completed без command verification", () => {
    const decision = evaluateCompletion(
      completedRequest(),
      baseState({
        taskKind: "bug_fix",
        hasMutatedFiles: true,
        hasCodeMutations: true,
        needsVerification: true,
        unverifiedMutationIds: ["ev_mutation_edit_1"],
        unverifiedCodeMutationIds: ["ev_mutation_edit_1"],
      }),
    );

    expect(decision.accepted).toBe(false);
    if (!decision.accepted) {
      expect(decision.reasons.join("\n")).toContain("Next allowed action");
      expect(decision.reasons.join("\n")).toContain("project verification commands");
    }
  });

  test("feature/refactor/code mutations pass with accepted command evidence", () => {
    const decision = evaluateCompletion(
      completedRequest(),
      baseState({
        taskKind: "feature",
        hasMutatedFiles: true,
        hasCodeMutations: true,
        verificationEvidenceCallIds: new Set(["test_1"]),
        verificationKinds: new Set(["test"]),
      }),
    );

    expect(decision.accepted).toBe(true);
  });

  test("completed rejects unresolved failed verification even when older passing evidence exists", () => {
    const decision = evaluateCompletion(
      completedRequest(),
      baseState({
        taskKind: "feature",
        hasMutatedFiles: true,
        hasCodeMutations: true,
        verificationEvidenceCallIds: new Set(["test_1"]),
        verificationKinds: new Set(["test"]),
        unresolvedVerificationFailureIds: ["ev_verification_lint_failed"],
      }),
    );

    expect(decision.accepted).toBe(false);
    if (!decision.accepted) {
      expect(decision.reasons.join("\n")).toContain("unresolved failed verification checks");
    }
  });

  test("completed accepts failed verification after later successful retry clears it", () => {
    const decision = evaluateCompletion(
      completedRequest(),
      baseState({
        taskKind: "feature",
        hasMutatedFiles: true,
        hasCodeMutations: true,
        verificationEvidenceCallIds: new Set(["lint_retry"]),
        verificationKinds: new Set(["lint"]),
        unresolvedVerificationFailureIds: [],
      }),
    );

    expect(decision.accepted).toBe(true);
  });

  test("UC-AL-04 допускает docs-only mutation после inspection evidence", () => {
    const decision = evaluateCompletion(
      completedRequest(),
      baseState({
        taskKind: "docs_change",
        hasMutatedFiles: true,
        hasDocsMutations: true,
        needsVerification: true,
        unverifiedMutationIds: ["ev_mutation_docs_1"],
        unverifiedDocsMutationIds: ["ev_mutation_docs_1"],
        inspectionEvidenceCallIds: new Set(["read_1"]),
        verificationKinds: new Set(["manual_inspection"]),
      }),
    );

    expect(decision.accepted).toBe(true);
  });

  test("read/inspection evidence does not verify code mutation", () => {
    const decision = evaluateCompletion(
      completedRequest(),
      baseState({
        taskKind: "docs_change",
        hasMutatedFiles: true,
        hasCodeMutations: true,
        needsVerification: true,
        unverifiedMutationIds: ["ev_mutation_src_1"],
        unverifiedCodeMutationIds: ["ev_mutation_src_1"],
        inspectionEvidenceCallIds: new Set(["read_1"]),
        verificationKinds: new Set(["manual_inspection"]),
      }),
    );

    expect(decision.accepted).toBe(false);
    if (!decision.accepted) {
      expect(decision.reasons.join("\n")).toContain("Code files changed without accepted command verification");
    }
  });

  test("review task can finish with inspection and no mutation verification", () => {
    const decision = evaluateCompletion(
      completedRequest(),
      baseState({
        taskKind: "review",
        inspectionEvidenceCallIds: new Set(["diff_1"]),
        verificationKinds: new Set(["manual_inspection"]),
      }),
    );

    expect(decision.accepted).toBe(true);
  });

  test("blocked remains allowed with concrete blocker despite unverified mutation", () => {
    const decision = evaluateCompletion(
      {
        summary: "Blocked: current test command is unavailable in this environment.",
        status: "blocked",
        criteria: [],
        acknowledgedErrorIds: [],
      },
      baseState({
        taskKind: "bug_fix",
        hasMutatedFiles: true,
        hasCodeMutations: true,
        needsVerification: true,
        unverifiedMutationIds: ["ev_mutation_edit_1"],
        unverifiedCodeMutationIds: ["ev_mutation_edit_1"],
      }),
    );

    expect(decision.accepted).toBe(true);
  });

  test("criteria evidenceIds are optional but must match recorded evidence when provided", () => {
    const decision = evaluateCompletion(
      {
        summary: "Готово",
        status: "completed",
        criteria: [{ criterion: "Verified", evidenceIds: ["missing_ev"] }],
        acknowledgedErrorIds: [],
      },
      baseState({
        evidenceIds: new Set(["ev_known"]),
      }),
    );

    expect(decision.accepted).toBe(false);
    if (!decision.accepted) {
      expect(decision.reasons.join("\n")).toContain("criteria[].evidenceIds contains IDs");
      expect(decision.reasons.join("\n")).toContain("missing_ev");
    }
  });

  test("completed_with_unverified_changes is rejected unless explicitly allowed", () => {
    const decision = evaluateCompletion(
      {
        summary: "Готово, проверки пропущены",
        status: "completed_with_unverified_changes",
        criteria: [{ criterion: "Patch applied" }],
        acknowledgedErrorIds: [],
      },
      baseState({
        taskKind: "bug_fix",
        hasMutatedFiles: true,
        hasCodeMutations: true,
        needsVerification: true,
        unverifiedMutationIds: ["ev_mutation_edit_1"],
        unverifiedCodeMutationIds: ["ev_mutation_edit_1"],
      }),
    );

    expect(decision.accepted).toBe(false);
    if (!decision.accepted) {
      expect(decision.reasons.join("\n")).toContain("completed_with_unverified_changes");
    }
  });

  test("completed_with_unverified_changes is accepted when policy explicitly allows it", () => {
    const decision = evaluateCompletion(
      {
        summary: "Готово, проверки пропущены по явному разрешению.",
        status: "completed_with_unverified_changes",
        criteria: [{ criterion: "Patch applied", evidenceIds: ["ev_mutation_edit_1"] }],
        acknowledgedErrorIds: [],
      },
      baseState({
        taskKind: "bug_fix",
        hasMutatedFiles: true,
        hasCodeMutations: true,
        needsVerification: true,
        unverifiedMutationIds: ["ev_mutation_edit_1"],
        unverifiedCodeMutationIds: ["ev_mutation_edit_1"],
        evidenceIds: new Set(["ev_mutation_edit_1"]),
        allowUnverifiedCompletion: true,
      }),
    );

    expect(decision.accepted).toBe(true);
  });
});
