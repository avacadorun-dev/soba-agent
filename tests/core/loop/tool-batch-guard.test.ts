import { describe, expect, test } from "bun:test";
import { evaluateToolBatch } from "../../../src/engine/tool-calls/tool-batch-guard";
import type { ResponseResource } from "../../../src/kernel/model/openresponses-types";

describe("tool batch guard", () => {
  test("rejects mutation plus dependent verification", () => {
    const decision = evaluateToolBatch([
      makeFunctionCall("edit", { path: "src/a.ts" }, "edit_1"),
      makeFunctionCall("bash", { command: "bun test tests/a.test.ts" }, "verify_1"),
    ]);

    expect(decision).toMatchObject({
      action: "reject",
      code: "mutating_batch_requires_observation",
    });
    if (decision.action === "reject") {
      expect(decision.message).toContain("Next allowed step");
    }
  });

  test("allows independent safe inspect batch", () => {
    const decision = evaluateToolBatch([
      makeFunctionCall("read", { path: "src/a.ts" }, "read_1"),
      makeFunctionCall("search_files", { query: "needle" }, "search_1"),
      makeFunctionCall("inspect_file", { path: "src/b.ts" }, "inspect_1"),
    ]);

    expect(decision).toEqual({ action: "allow" });
  });

  test("allows mutation plus non-verification read in the same batch", () => {
    const decision = evaluateToolBatch([
      makeFunctionCall("write", { path: "src/generated.ts" }, "write_1"),
      makeFunctionCall("read", { path: "README.md" }, "read_1"),
    ]);

    expect(decision).toEqual({ action: "allow" });
  });
});

function makeFunctionCall(
  name: string,
  args: Record<string, unknown>,
  callId: string,
): Extract<ResponseResource["output"][number], { type: "function_call" }> {
  return {
    type: "function_call",
    id: `fc_${callId}`,
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
    status: "completed",
  };
}
