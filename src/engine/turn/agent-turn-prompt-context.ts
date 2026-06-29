import type { FlightRecordData } from "../../kernel/transcript/types";
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
  const preparedPrompt = await prepareTurnPrompt({
    cwd,
    userText,
    selectedTools: runtime.tools.getNames(),
    contextReader: runtime.projectContextReader,
    skillManager: runtime.skillManager,
    projectMemory: runtime.projectMemory,
    modelConfig: runtime.client.getConfig(),
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
      selectedTools: runtime.tools.getNames(),
      contextFiles: contextFiles.map((file) => file.path),
      systemPrompt,
    },
  });
  narrate(
    "plan",
    "Proceeding in small steps: inspect relevant context, act with tools, then verify before completion.",
  );

  return preparedPrompt;
}
