export type ToolEffect = "inspect" | "search" | "mutation" | "state_read" | "state_mutation" | "execute" | "control";

export interface ToolSemantics {
  effects: readonly ToolEffect[];
  parallelSafe: boolean;
  restrictedMode: "allow" | "deny";
}

const UNKNOWN_TOOL_SEMANTICS: ToolSemantics = {
  effects: ["execute"],
  parallelSafe: false,
  restrictedMode: "deny",
};

/**
 * Compatibility metadata for built-ins. New tools should declare semantics on
 * their ToolDefinition; this map keeps older registrations and control tools
 * deterministic without scattering name lists through engine policies.
 */
export const BUILTIN_TOOL_SEMANTICS: Readonly<Record<string, ToolSemantics>> = {
  read: { effects: ["inspect"], parallelSafe: true, restrictedMode: "allow" },
  inspect_file: { effects: ["inspect"], parallelSafe: true, restrictedMode: "allow" },
  ls: { effects: ["inspect"], parallelSafe: true, restrictedMode: "allow" },
  search_files: { effects: ["search"], parallelSafe: true, restrictedMode: "allow" },
  read_project_memory: { effects: ["state_read"], parallelSafe: true, restrictedMode: "allow" },
  write: { effects: ["mutation"], parallelSafe: false, restrictedMode: "deny" },
  edit: { effects: ["mutation"], parallelSafe: false, restrictedMode: "deny" },
  write_project_memory: { effects: ["state_mutation"], parallelSafe: false, restrictedMode: "deny" },
  bash: { effects: ["execute"], parallelSafe: false, restrictedMode: "deny" },
  checkpoint: { effects: ["control"], parallelSafe: false, restrictedMode: "allow" },
  ask_user: { effects: ["control"], parallelSafe: false, restrictedMode: "allow" },
  activate_skill: { effects: ["control"], parallelSafe: false, restrictedMode: "allow" },
  deactivate_skill: { effects: ["control"], parallelSafe: false, restrictedMode: "allow" },
  finish: { effects: ["control"], parallelSafe: false, restrictedMode: "allow" },
};

export function resolveToolSemantics(
  toolName: string,
  declared?: ToolSemantics,
): ToolSemantics {
  return declared ?? BUILTIN_TOOL_SEMANTICS[toolName] ?? UNKNOWN_TOOL_SEMANTICS;
}

export function hasToolEffect(semantics: ToolSemantics, effect: ToolEffect): boolean {
  return semantics.effects.includes(effect);
}
