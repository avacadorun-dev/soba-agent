/**
 * Work mode is orthogonal to PermissionMode.
 * - agent: normal autonomous engineering loop
 * - plan: inspect + design an implementation plan; hard-block mutations
 * - goal: inspect + clarify objective/success criteria; hard-block mutations
 *
 * ACP may also send modeId "planning", which normalizes to "plan".
 */
export type WorkMode = "agent" | "plan" | "goal";

export const WORK_MODES = ["agent", "plan", "goal"] as const satisfies readonly WorkMode[];

/** Modes that share the read-only tool/bash policy. */
export const RESTRICTED_WORK_MODES = ["plan", "goal"] as const satisfies readonly WorkMode[];

export function isWorkMode(value: string): value is WorkMode {
  return value === "agent" || value === "plan" || value === "goal";
}

export function isRestrictedWorkMode(value: string): value is "plan" | "goal" {
  return value === "plan" || value === "goal";
}

/**
 * Normalize ACP/CLI mode ids onto WorkMode.
 * Accepts canonical work modes plus ACP alias "planning" → "plan".
 */
export function normalizeWorkModeId(value: string): WorkMode | undefined {
  const raw = value.trim().toLowerCase();
  if (raw === "planning") return "plan";
  if (isWorkMode(raw)) return raw;
  return undefined;
}
