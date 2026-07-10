import { isRestrictedWorkMode, type WorkMode } from "./types";

/** Built-in tools that are always available in restricted work modes. */
export const PLAN_MODE_SAFE_TOOLS = new Set([
  "read",
  "ls",
  "search_files",
  "inspect_file",
  "read_project_memory",
  "checkpoint",
  "ask_user",
  "finish",
]);

/** Built-in tools that must never run in plan mode. */
export const PLAN_MODE_BLOCKED_TOOLS = new Set(["write", "edit", "write_project_memory"]);

const PLAN_MODE_MUTATING_MCP_NAME = /(?:^|[_-])(write|edit|delete|remove|rm|create|update|patch|put|post|upload|apply|mutate|install|deploy|exec|execute|run_terminal|run_command|shell)(?:$|[_-])/i;

export interface PlanModeToolDecision {
  allowed: boolean;
  reason: string;
}

export interface PlanModeCommandDecision {
  allowed: boolean;
  reason: string;
}

export function filterToolsForWorkMode(
  toolNames: readonly string[],
  mode: WorkMode,
  options: { clarificationAvailable?: boolean } = {},
): string[] {
  if (!isRestrictedWorkMode(mode)) return [...toolNames];
  return toolNames.filter((name) => {
    if (name === "ask_user" && !options.clarificationAvailable) return false;
    return isToolAllowedInPlanMode(name).allowed;
  });
}

export function isToolAllowedInPlanMode(toolName: string): PlanModeToolDecision {
  if (toolName === "finish") {
    return { allowed: true, reason: "Control tool finish is always available." };
  }
  if (PLAN_MODE_BLOCKED_TOOLS.has(toolName)) {
    return {
      allowed: false,
      reason: `Plan mode blocks mutation tool "${toolName}". Switch to agent mode (/plan off) to implement changes.`,
    };
  }
  if (PLAN_MODE_SAFE_TOOLS.has(toolName)) {
    return { allowed: true, reason: `Tool "${toolName}" is plan-safe.` };
  }
  // MCP / custom tools: allow only when the name does not look mutating.
  if (PLAN_MODE_MUTATING_MCP_NAME.test(toolName)) {
    return {
      allowed: false,
      reason: `Plan mode blocks likely-mutating tool "${toolName}".`,
    };
  }
  // Unknown custom tools default to deny for safety.
  return {
    allowed: false,
    reason: `Plan mode blocks unregistered/custom tool "${toolName}" by default.`,
  };
}

export function isCommandAllowedInPlanMode(command: string): PlanModeCommandDecision {
  void command;
  return {
    allowed: false,
    reason: "Plan and goal modes block bash entirely. Use native inspection tools or switch to agent mode.",
  };
}

export function planModeSystemGuidelines(): string[] {
  return [
    "PLAN MODE IS ACTIVE: inspect and design only. Do not mutate repository files, project memory, configs, or git state",
    "Do not call write, edit, write_project_memory, bash, or any mutating MCP tools. If implementation is requested, tell the user to run /plan off",
    "Use read, ls, search_files, inspect_file, read_project_memory, checkpoint, and ask_user when an ACP clarification form is available",
    "Deliver a concrete implementation plan: goal, scope, files to touch, risks, verification commands, and open questions. Prefer finish with that plan when ready",
  ];
}

export function goalModeSystemGuidelines(): string[] {
  return [
    "GOAL MODE IS ACTIVE: clarify objective and success criteria only. Do not mutate repository files, project memory, configs, or git state",
    "Do not call write, edit, write_project_memory, bash, or any mutating MCP tools. If implementation is requested, tell the user to run /plan off or switch to agent mode",
    "Use read, ls, search_files, inspect_file, read_project_memory, checkpoint, and ask_user when an ACP clarification form is available",
    "Deliver a crisp goal brief: objective, in/out of scope, success criteria, constraints, key risks, and open questions. Prefer finish with that brief when ready",
  ];
}

export function systemGuidelinesForWorkMode(mode: WorkMode): string[] {
  if (mode === "plan") return planModeSystemGuidelines();
  if (mode === "goal") return goalModeSystemGuidelines();
  return [];
}
