import { describe, expect, test } from "bun:test";
import { createToolOutcomeFingerprint, LoopGuard, type ToolOutcome } from "../../../src/core/loop/loop-guard";
import type { ToolErrorInfo } from "../../../src/core/tools/types";

describe("LoopGuard helpful tool failure handling", () => {
  test("repeated exact edit failure triggers recovery prompt with typed next action", () => {
    const guard = new LoopGuard({
      maxAgentIterations: 10,
      maxStalledIterations: 1,
      maxStallRecoveryAttempts: 1,
      maxRunDurationMs: 0,
    });

    const first = guard.observeToolIteration([makeEditFailure()]);
    const second = guard.observeToolIteration([makeEditFailure()]);

    expect(first.action).toBe("continue");
    expect(second.action).toBe("recover");
    if (second.action === "recover") {
      expect(second.message).toContain("edit_old_text_not_found");
      expect(second.message).toContain("Read the current file content");
    }
  });

  test("fingerprint prefers stable typed error metadata over volatile result text", () => {
    const first = createToolOutcomeFingerprint([makeEditFailure("preview A")]);
    const second = createToolOutcomeFingerprint([makeEditFailure("preview B")]);

    expect(first).toBe(second);
  });

  test("invalid write arguments recover immediately without waiting for repeated failure", () => {
    const guard = new LoopGuard({
      maxAgentIterations: 10,
      maxStalledIterations: 4,
      maxStallRecoveryAttempts: 1,
      maxRunDurationMs: 0,
    });

    const first = guard.observeToolIteration([makeInvalidWriteFailure()]);

    expect(first.action).toBe("recover");
    if (first.action === "recover") {
      expect(first.message).toContain("invalid arguments before execution");
      expect(first.message).toContain("write_invalid_arguments");
      expect(first.message).toContain("do not retry unchanged");
    }
  });

  test("invalid write arguments stop after exhausted recovery attempts", () => {
    const guard = new LoopGuard({
      maxAgentIterations: 10,
      maxStalledIterations: 4,
      maxStallRecoveryAttempts: 1,
      maxRunDurationMs: 0,
    });

    expect(guard.observeToolIteration([makeInvalidWriteFailure()]).action).toBe("recover");
    const second = guard.observeToolIteration([makeInvalidWriteFailure()]);

    expect(second.action).toBe("stop");
    if (second.action === "stop") {
      expect(second.message).toContain("Agent remained stuck");
      expect(second.message).toContain("do not retry unchanged");
    }
  });

  test("invalid bash arguments recover immediately without waiting for repeated failure", () => {
    const guard = new LoopGuard({
      maxAgentIterations: 10,
      maxStalledIterations: 4,
      maxStallRecoveryAttempts: 1,
      maxRunDurationMs: 0,
    });

    const first = guard.observeToolIteration([makeInvalidBashFailure()]);

    expect(first.action).toBe("recover");
    if (first.action === "recover") {
      expect(first.message).toContain("invalid arguments before execution");
      expect(first.message).toContain("bash_invalid_arguments");
      expect(first.message).toContain("do not retry unchanged");
    }
  });

  test("generic invalid_arguments from structured tools recover immediately", () => {
    const guard = new LoopGuard({
      maxAgentIterations: 10,
      maxStalledIterations: 4,
      maxStallRecoveryAttempts: 1,
      maxRunDurationMs: 0,
    });

    const first = guard.observeToolIteration([makeInvalidMemoryCapsuleFailure()]);

    expect(first.action).toBe("recover");
    if (first.action === "recover") {
      expect(first.message).toContain("invalid arguments before execution");
      expect(first.message).toContain("invalid_arguments");
      expect(first.message).toContain("Fix the write_project_memory arguments");
    }
  });
});

function makeEditFailure(result = "Error editing file with volatile preview"): ToolOutcome & { error: ToolErrorInfo } {
  return {
    toolName: "edit",
    arguments: JSON.stringify({ path: "src/file.ts", edits: [{ oldText: "stale", newText: "fresh" }] }),
    result,
    isError: true,
    error: {
      code: "edit_old_text_not_found",
      category: "validation",
      retryable: false,
      nextAction: "Read the current file content and build a new exact replacement from the latest text.",
      fingerprint: "validation:edit_old_text_not_found:src/file.ts",
    },
  };
}

function makeInvalidWriteFailure(): ToolOutcome & { error: ToolErrorInfo } {
  return {
    toolName: "write",
    arguments: "{}",
    result: "Error [write_invalid_arguments]: Invalid write arguments: path, content must be provided as strings.",
    isError: true,
    error: {
      code: "write_invalid_arguments",
      category: "validation",
      retryable: false,
      nextAction:
        'This is an invalid tool call, not a tool failure. Retry only with arguments shaped exactly like {"path":"relative/file.txt","content":"..."}; do not retry unchanged.',
      fingerprint: "validation:write_invalid_arguments:path,content",
    },
  };
}

function makeInvalidBashFailure(): ToolOutcome & { error: ToolErrorInfo } {
  return {
    toolName: "bash",
    arguments: "{}",
    result: "Error [bash_invalid_arguments]: Invalid bash arguments: command must be provided as a non-empty string.",
    isError: true,
    error: {
      code: "bash_invalid_arguments",
      category: "validation",
      retryable: false,
      nextAction:
        'This is an invalid tool call, not a shell failure. Retry only with arguments shaped exactly like {"command":"..."}; do not retry unchanged.',
      fingerprint: "validation:bash_invalid_arguments:command",
    },
  };
}

function makeInvalidMemoryCapsuleFailure(): ToolOutcome & { error: ToolErrorInfo } {
  return {
    toolName: "write_project_memory",
    arguments: JSON.stringify({ target: "capsule", capsule: {} }),
    result: "Error [invalid_arguments]: Missing or empty fields: type, summary, detail, priority.",
    isError: true,
    error: {
      code: "invalid_arguments",
      category: "validation",
      retryable: false,
      nextAction:
        'Fix the write_project_memory arguments before retrying. For target=capsule use {"target":"capsule","capsule":{"type":"decision","summary":"Short durable fact","detail":"Specific reusable context.","priority":"high","tags":["architecture"]}}',
      fingerprint: "validation:invalid_arguments",
    },
  };
}
