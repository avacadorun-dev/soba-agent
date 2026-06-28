import type { CheckpointEvent } from "../../kernel/tools/checkpoint";
import type { ToolRegistry } from "../../kernel/tools/tool-registry";
import type { DebugEntry } from "../../kernel/transcript/types";
import type { ContextController } from "../context/context-controller";

export function scheduleCheckpointCompactionForTurn(input: {
  checkpointEvents: CheckpointEvent[];
  contextController: ContextController;
  tools: ToolRegistry;
  turnIndex: number;
  iteration: number;
  systemPrompt: string;
  debug: (data: DebugEntry["data"]) => void;
}): void {
  const checkpointFingerprint = `turn_${input.turnIndex}_checkpoint_${input.iteration}`;
  const systemPromptTokens = Math.ceil(input.systemPrompt.length / 4);
  const toolSchemaTokens = Math.ceil(JSON.stringify(input.tools.getOpenAITools()).length / 4);
  const decision = input.contextController.scheduleLatestMilestone({
    checkpointEvents: input.checkpointEvents,
    metrics: {
      systemPromptTokens,
      toolSchemaTokens,
      requestFingerprint: checkpointFingerprint,
    },
  });
  if (!decision.evaluated) return;

  input.debug({
    event: "loop/iteration",
    turn: input.turnIndex,
    iteration: input.iteration,
    detail: decision.shouldCompact
      ? `milestone scheduled for capsule candidate: ${decision.reason ?? ""}`
      : `milestone recorded without compaction: ${decision.reason ?? ""}`,
  });
}
