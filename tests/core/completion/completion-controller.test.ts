import { describe, expect, test } from "bun:test";
import type { FunctionCallField } from "../../../src/core/client/types";
import { CompletionController } from "../../../src/core/completion/completion-controller";
import type { CompletionState } from "../../../src/core/loop/completion-gate";

function finishCall(args: Record<string, unknown> | string): FunctionCallField {
  return {
    type: "function_call",
    id: "fc_finish",
    call_id: "call_finish",
    name: "finish",
    arguments: typeof args === "string" ? args : JSON.stringify(args),
    status: "completed",
  };
}

function completionState(overrides: Partial<CompletionState> = {}): CompletionState {
  return {
    errors: [],
    successfulToolCallIds: new Set(),
    verificationEvidenceCallIds: new Set(),
    needsVerification: false,
    hasUsedTools: false,
    hasMutatedFiles: false,
    ...overrides,
  };
}

describe("CompletionController", () => {
  test("accepts a valid completed finish when state does not require verification", () => {
    const controller = new CompletionController();

    const result = controller.evaluateFinishCall(
      finishCall({
        summary: "Done",
        status: "completed",
        criteria: [{ criterion: "Answered the question" }],
      }),
      completionState(),
    );

    expect(result.kind).toBe("accepted");
  });

  test("rejects completed finish when code mutations still need verification", () => {
    const controller = new CompletionController();

    const result = controller.evaluateFinishCall(
      finishCall({
        summary: "Done",
        status: "completed",
        criteria: [{ criterion: "Changed code" }],
      }),
      completionState({
        hasUsedTools: true,
        hasMutatedFiles: true,
        hasCodeMutations: true,
        needsVerification: true,
        successfulToolCallIds: new Set(["edit_1"]),
        unverifiedCodeMutationIds: ["ev_mutation_edit_1"],
      }),
    );

    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.reasons.join(" ")).toContain("verification");
      expect(controller.createRejectionResult(result).content[0]?.text).toContain("Finish rejected by completion gate");
    }
  });

  test("diagnoses invalid finish arguments and tracks rejection limit", () => {
    const controller = new CompletionController({ maxFinishRejections: 2 });
    const result = controller.evaluateFinishCall(finishCall("{bad json"), completionState());

    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") throw new Error("Expected invalid finish");
    expect(controller.createRejectionResult(result).content[0]?.text).toContain("invalid arguments");

    const first = controller.recordRejection(result);
    const second = controller.recordRejection(result);

    expect(first.limitExceeded).toBe(false);
    expect(second.limitExceeded).toBe(true);
    expect(second.message).toContain("invalid finish arguments 2 times");
  });
});
