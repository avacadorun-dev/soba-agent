import { describe, expect, test } from "bun:test";
import { agentLoopBaselineCases } from "../fixtures/agent-loop-cases";
import { agentLoopReleaseRegressionCases } from "../fixtures/agent-loop-release-cases";
import {
  evaluateAgentLoopCase,
  evaluateAgentLoopCases,
  generateMarkdownEvalReport,
} from "./agent-loop-eval-runner";
import type { AgentLoopEvalCase } from "./eval-types";

function cloneCase(evalCase: AgentLoopEvalCase): AgentLoopEvalCase {
  return structuredClone(evalCase);
}

describe("Agent Loop eval runner", () => {
  test("passes good mocked baseline traces", () => {
    const results = evaluateAgentLoopCases(agentLoopBaselineCases);

    expect(results.every((result) => result.passed)).toBe(true);
    expect(agentLoopBaselineCases.map((evalCase) => evalCase.useCaseId)).toEqual([
      "UC-AL-01",
      "UC-AL-03",
      "UC-AL-05",
      "UC-AL-08",
      "UC-AL-10",
      "UC-AL-13",
    ]);
  });

  test("fails unverified code mutation finish", () => {
    const evalCase = cloneCase(agentLoopBaselineCases[0]);
    evalCase.trace = evalCase.trace.filter(
      (event) => event.type !== "tool" || event.evidenceKind !== "verification",
    );

    const result = evaluateAgentLoopCase(evalCase);

    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.reason)).toContain("completed_with_unverified_changes");
  });

  test("fails forbidden command such as ESLint or Prettier in SOBA fixture", () => {
    const evalCase = cloneCase(getBaselineCase("uc-al-03-soba-lint-fix"));
    evalCase.trace = evalCase.trace.map((event) => {
      if (event.type === "tool" && event.evidenceKind === "diagnostic") {
        return { ...event, command: "npx eslint ." };
      }
      return event;
    });

    const result = evaluateAgentLoopCase(evalCase);

    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.reason)).toContain("forbidden_command:eslint");
  });

  test("fails missing required narration event", () => {
    const evalCase = cloneCase(getBaselineCase("uc-al-13-visible-docs-roadmap"));
    evalCase.trace = evalCase.trace.filter(
      (event) => event.type !== "narration" || event.eventType !== "context_scan",
    );

    const result = evaluateAgentLoopCase(evalCase);

    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.reason)).toContain("missing_narration:context_scan");
  });

  test("fails weak profile mutation and verification in one dependent batch", () => {
    const evalCase = cloneCase(getBaselineCase("uc-al-10-weak-cli-rails"));
    evalCase.trace = evalCase.trace.map((event) => {
      if (event.type === "tool" && event.evidenceKind === "verification") {
        return { ...event, batchId: "batch-edit" };
      }
      return event;
    });

    const result = evaluateAgentLoopCase(evalCase);

    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.reason)).toContain(
      "weak_profile_mutation_and_verification_same_batch",
    );
  });

  test("fails weak profile edit without search or inspect first", () => {
    const evalCase = cloneCase(getBaselineCase("uc-al-10-weak-cli-rails"));
    evalCase.trace = evalCase.trace.filter(
      (event) =>
        event.type !== "tool" ||
        (event.toolName !== "search_files" && event.toolName !== "inspect_file"),
    );

    const result = evaluateAgentLoopCase(evalCase);

    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.reason)).toContain(
      "weak_profile_missing_search_or_inspect_before_mutation",
    );
  });

  test("renders deterministic markdown report", () => {
    const results = evaluateAgentLoopCases(agentLoopBaselineCases);
    const report = generateMarkdownEvalReport(results);

    expect(report).toContain("# Agent Loop Eval Report");
    expect(report).toContain("| uc-al-01-short-bug-fix | pass | - |");
    expect(report).toContain("| uc-al-08-memory-as-hypothesis | pass | - |");
    expect(report).toContain("| uc-al-13-visible-docs-roadmap | pass | - |");
  });

  test("passes v0.4.0 Agent Loop release WOW regression cases", () => {
    const results = evaluateAgentLoopCases(agentLoopReleaseRegressionCases);

    expect(results.every((result) => result.passed)).toBe(true);
    expect(agentLoopReleaseRegressionCases.map((evalCase) => evalCase.useCaseId)).toEqual([
      "UC-AL-01",
      "UC-AL-04",
      "UC-AL-05",
      "UC-AL-10",
      "UC-AL-11",
    ]);
  });

  test("release unsafe-action fixture fails if destructive reset is executed", () => {
    const evalCase = cloneCase(getReleaseCase("wow-al5-unsafe-reset"));
    evalCase.trace.splice(4, 0, {
      type: "tool",
      evidenceId: "ev-al5-reset",
      toolName: "bash",
      status: "success",
      evidenceKind: "diagnostic",
      command: "git reset --hard",
    });

    const result = evaluateAgentLoopCase(evalCase);

    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.reason)).toContain("forbidden_command:git reset");
  });
});

function getBaselineCase(id: string): AgentLoopEvalCase {
  const evalCase = agentLoopBaselineCases.find((candidate) => candidate.id === id);
  if (!evalCase) throw new Error(`Missing baseline eval case: ${id}`);
  return evalCase;
}

function getReleaseCase(id: string): AgentLoopEvalCase {
  const evalCase = agentLoopReleaseRegressionCases.find((candidate) => candidate.id === id);
  if (!evalCase) throw new Error(`Missing release eval case: ${id}`);
  return evalCase;
}
