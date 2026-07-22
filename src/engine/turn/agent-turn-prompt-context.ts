import { resolveOutputReserveTokens } from "../../kernel/model/model-limits";
import type { FlightRecordData } from "../../kernel/transcript/types";
import { filterToolsForWorkMode } from "../../kernel/work-mode/public";
import type { AgentLoopRuntimeServices } from "./agent-loop-runtime";
import type { WorkingNarrationEmitter } from "./narration";
import { prepareTurnPrompt } from "./turn-prompt-preparation";

export async function prepareAgentTurnPromptContext(input: {
  cwd: string;
  userText: string;
  turnIndex: number;
  taskKind: string;
  runtime: AgentLoopRuntimeServices;
  narrate: WorkingNarrationEmitter;
  flight(data: Omit<FlightRecordData, "version">): void;
}): ReturnType<typeof prepareTurnPrompt> {
  const { cwd, userText, turnIndex, taskKind, runtime, narrate, flight } = input;

  narrate(
    "context_scan",
    "Checking project instructions, available skills, and memory before choosing the next action.",
  );
  const workMode = runtime.workModeController.getWorkMode();
  const modelConfig = runtime.client.getConfig();
  // The provider proxy can replace a same-id client's synthetic limits after
  // live metadata refresh. Directly constructed AgentLoops may intentionally
  // use a ContextManager with independent test/application limits, so only
  // synchronize proxy-backed runtimes.
  if (
    "getActiveSelection" in runtime.client &&
    typeof runtime.contextManager?.updateModelLimits === "function"
  ) {
    runtime.contextManager.updateModelLimits(
      modelConfig.contextWindow,
      resolveOutputReserveTokens(
        modelConfig.maxOutputTokens,
        modelConfig.maxCompletionTokens,
      ),
    );
  }
  const preparedPrompt = await prepareTurnPrompt({
    cwd,
    userText,
    selectedTools: runtime.tools.getNames(),
    workMode,
    clarificationAvailable: runtime.clarificationAvailable(),
    contextReader: runtime.projectContextReader,
    skillManager: runtime.skillManager,
    projectMemory: runtime.projectMemory,
    modelConfig,
  });
  const { contextFiles, systemPrompt, model } = preparedPrompt;
  narrate(
    "observation",
    contextFiles.length > 0
      ? `Loaded project instructions from ${contextFiles.map((file) => file.path).join(", ")}.`
      : "No project instruction file was found; using repository structure and targeted reads.",
  );
  flight({
    kind: "prompt_snapshot",
    turn: turnIndex,
    payload: {
      cwd,
      userInput: userText,
      taskKind,
      model,
      reasoningRequested: modelConfig.reasoning ?? { mode: "provider_default" },
      reasoningEffective: modelConfig.reasoningEffective ?? { mode: "provider_default" },
      reasoningFallbackReason: modelConfig.reasoningFallbackReason,
      workMode,
      selectedTools: filterToolsForWorkMode(runtime.tools.getNames(), workMode, {
        clarificationAvailable: runtime.clarificationAvailable(),
        semanticsFor: (toolName) => runtime.tools.getSemantics(toolName),
      }),
      contextFiles: contextFiles.map((file) => file.path),
      systemPrompt,
    },
  });
  narrate(
    "plan",
    workMode === "plan"
      ? "Plan mode is active: inspect and design only; mutations stay blocked until /plan off."
      : workMode === "goal"
        ? "Goal mode is active: clarify objective and success criteria only; mutations stay blocked until /plan off."
        : "Proceeding in small steps: inspect relevant context, act with tools, then verify before completion.",
  );

  return preparedPrompt;
}
