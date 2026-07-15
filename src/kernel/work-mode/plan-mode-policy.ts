import { BUILTIN_TOOL_SEMANTICS, resolveToolSemantics, type ToolSemantics } from "../tools/semantics";
import { isRestrictedWorkMode, type WorkMode } from "./types";

/** Compatibility views derived from the canonical semantics catalogue. */
export const PLAN_MODE_SAFE_TOOLS = new Set(
  Object.entries(BUILTIN_TOOL_SEMANTICS)
    .filter(([, semantics]) => semantics.restrictedMode === "allow")
    .map(([name]) => name),
);

export const PLAN_MODE_BLOCKED_TOOLS = new Set(
  Object.entries(BUILTIN_TOOL_SEMANTICS)
    .filter(([, semantics]) => semantics.restrictedMode === "deny")
    .map(([name]) => name),
);

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
  options: {
    clarificationAvailable?: boolean;
    semanticsFor?: (toolName: string) => ToolSemantics;
  } = {},
): string[] {
  if (!isRestrictedWorkMode(mode)) return [...toolNames];
  return toolNames.filter((name) => {
    if (name === "ask_user" && !options.clarificationAvailable) return false;
    return isToolAllowedInPlanMode(name, options.semanticsFor?.(name)).allowed;
  });
}

export function isToolAllowedInPlanMode(
  toolName: string,
  declaredSemantics?: ToolSemantics,
): PlanModeToolDecision {
  const semantics = resolveToolSemantics(toolName, declaredSemantics);
  if (toolName === "finish") {
    return { allowed: true, reason: "Control tool finish is always available." };
  }
  if (semantics.restrictedMode === "deny") {
    const mutationLabel = semantics.effects.some((effect) => effect === "mutation" || effect === "state_mutation")
      ? "mutation "
      : "";
    return {
      allowed: false,
      reason: `Plan mode blocks ${mutationLabel}tool "${toolName}" because its declared effects are not restricted-mode safe. Switch to agent mode (/plan off) to use it.`,
    };
  }
  if (semantics.restrictedMode === "allow") {
    return { allowed: true, reason: `Tool "${toolName}" is plan-safe.` };
  }
  return {
    allowed: false,
    reason: `Plan mode blocks tool "${toolName}" without safe declared semantics.`,
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
    "Interpret requests to implement, fix, or change something as requests to inspect the relevant context and produce a decision-complete implementation plan",
    "Do not attempt implementation, ask the user to switch modes, or call write, edit, write_project_memory, bash, or any mutating MCP tools",
    "Use only the inspection, search, clarification, checkpoint, and finish tools exposed in the current tool list",
    "Deliver a concrete implementation plan: goal, scope, files to touch, risks, verification commands, and open questions. Prefer finish with that plan when ready",
  ];
}

export function goalModeSystemGuidelines(): string[] {
  return [
    "GOAL MODE IS ACTIVE: clarify objective and success criteria only. Do not mutate repository files, project memory, configs, or git state",
    "Interpret implementation requests as requests to clarify the objective, constraints, and success criteria without attempting implementation",
    "Do not call write, edit, write_project_memory, bash, or any mutating MCP tools",
    "Use only the inspection, search, clarification, checkpoint, and finish tools exposed in the current tool list",
    "Deliver a crisp goal brief: objective, in/out of scope, success criteria, constraints, key risks, and open questions. Prefer finish with that brief when ready",
  ];
}

export function systemGuidelinesForWorkMode(mode: WorkMode): string[] {
  if (mode === "plan") return planModeSystemGuidelines();
  if (mode === "goal") return goalModeSystemGuidelines();
  return [];
}
