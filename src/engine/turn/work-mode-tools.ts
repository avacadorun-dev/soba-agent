import { filterToolsForWorkMode } from "../../kernel/work-mode/public";
import type { AgentLoopRuntimeServices } from "./agent-loop-runtime";
import type { SkillSource } from "./skill-source";

/** Model-visible tools for the current work mode and host interaction capabilities. */
export function allowedToolNamesForRuntime(runtime: AgentLoopRuntimeServices): Set<string> {
  return new Set(filterToolsForSkillPolicy(
    filterToolsForWorkMode(runtime.tools.getNames(), runtime.workModeController.getWorkMode(), {
      clarificationAvailable: runtime.clarificationAvailable(),
      semanticsFor: (toolName) => runtime.tools.getSemantics(toolName),
    }),
    runtime.skillManager,
  ));
}

export function filterToolsForSkillPolicy(toolNames: readonly string[], skillSource?: SkillSource): string[] {
  if (!skillSource?.evaluateToolPolicy) return [...toolNames];
  return toolNames.filter((toolName) => skillSource.evaluateToolPolicy?.(toolName).allowed !== false);
}
