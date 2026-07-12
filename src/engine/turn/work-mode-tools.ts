import { filterToolsForWorkMode } from "../../kernel/work-mode/public";
import type { AgentLoopRuntimeServices } from "./agent-loop-runtime";

/** Model-visible tools for the current work mode and host interaction capabilities. */
export function allowedToolNamesForRuntime(runtime: AgentLoopRuntimeServices): Set<string> {
  return new Set(
    filterToolsForWorkMode(runtime.tools.getNames(), runtime.workModeController.getWorkMode(), {
      clarificationAvailable: runtime.clarificationAvailable(),
      semanticsFor: (toolName) => runtime.tools.getSemantics(toolName),
    }),
  );
}
