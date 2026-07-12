import { describe, expect, test } from "bun:test";
import {
  filterToolsForWorkMode,
  goalModeSystemGuidelines,
  isCommandAllowedInPlanMode,
  isToolAllowedInPlanMode,
  normalizeWorkModeId,
  planModeSystemGuidelines,
  systemGuidelinesForWorkMode,
} from "../../../src/kernel/work-mode/public";

describe("plan mode policy", () => {
  test("allows read-only built-ins and blocks mutations", () => {
    expect(isToolAllowedInPlanMode("read").allowed).toBe(true);
    expect(isToolAllowedInPlanMode("inspect_file").allowed).toBe(true);
    expect(isToolAllowedInPlanMode("ask_user").allowed).toBe(true);
    expect(isToolAllowedInPlanMode("bash").allowed).toBe(false);
    expect(isToolAllowedInPlanMode("finish").allowed).toBe(true);

    expect(isToolAllowedInPlanMode("write").allowed).toBe(false);
    expect(isToolAllowedInPlanMode("edit").allowed).toBe(false);
    expect(isToolAllowedInPlanMode("write_project_memory").allowed).toBe(false);
  });

  test("filters tool names in restricted work modes", () => {
    const tools = ["read", "write", "edit", "bash", "ask_user", "checkpoint"];
    expect(filterToolsForWorkMode(tools, "agent")).toEqual(tools);
    expect(filterToolsForWorkMode(tools, "plan")).toEqual(["read", "checkpoint"]);
    expect(filterToolsForWorkMode(tools, "plan", { clarificationAvailable: true })).toEqual(["read", "ask_user", "checkpoint"]);
    expect(filterToolsForWorkMode(tools, "goal")).toEqual(["read", "checkpoint"]);
  });

  test("blocks every bash invocation in restricted modes", () => {
    for (const command of ["git status --short", "git branch release", "tee owned.txt", "env rm -rf dist", "bun run lint:fix", "awk 'BEGIN { system(\"touch owned\") }'"]) {
      expect(isCommandAllowedInPlanMode(command).allowed).toBe(false);
    }
  });

  test("blocks likely-mutating MCP tool names and unknown tools", () => {
    expect(isToolAllowedInPlanMode("github_create_issue").allowed).toBe(false);
    expect(isToolAllowedInPlanMode("fs_write_file").allowed).toBe(false);
    expect(isToolAllowedInPlanMode("custom_mystery_tool").allowed).toBe(false);
  });

  test("uses declared semantics for custom tools instead of guessing from names", () => {
    expect(isToolAllowedInPlanMode("anything", {
      effects: ["inspect"],
      parallelSafe: true,
      restrictedMode: "allow",
    }).allowed).toBe(true);
    expect(isToolAllowedInPlanMode("harmless_name", {
      effects: ["mutation"],
      parallelSafe: false,
      restrictedMode: "deny",
    }).allowed).toBe(false);
  });

  test("exposes plan and goal mode system guidelines", () => {
    const planGuidelines = planModeSystemGuidelines();
    expect(planGuidelines.length).toBeGreaterThan(0);
    expect(planGuidelines.some((line) => /PLAN MODE/i.test(line))).toBe(true);

    const goalGuidelines = goalModeSystemGuidelines();
    expect(goalGuidelines.some((line) => /GOAL MODE/i.test(line))).toBe(true);
    expect(systemGuidelinesForWorkMode("goal")).toEqual(goalGuidelines);
    expect(systemGuidelinesForWorkMode("agent")).toEqual([]);
  });

  test("normalizes ACP mode ids onto work modes", () => {
    expect(normalizeWorkModeId("planning")).toBe("plan");
    expect(normalizeWorkModeId("plan")).toBe("plan");
    expect(normalizeWorkModeId("goal")).toBe("goal");
    expect(normalizeWorkModeId("agent")).toBe("agent");
    expect(normalizeWorkModeId("architect")).toBeUndefined();
  });
});
