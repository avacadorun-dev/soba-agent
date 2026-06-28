import type { ItemParam } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { ItemParam as SessionItemParam } from "../../kernel/transcript/types";
import type { LoopGuard, ToolOutcome } from "./loop-guard";
import type { WorkingNarrationEventType } from "./narration";
import { createTurnError, createUserItem } from "./turn-helpers";
import type { AgentEvent, AgentTurnError, TurnStopReasonEvent } from "./types";

export type ToolIterationDecision = "break" | "continue" | "next";

export interface ToolIterationDecisionInput {
  fixUntilGreenStop: string | null;
  fixUntilGreenFollowUp: string | null;
  loopGuard: LoopGuard;
  iterationOutcomes: ToolOutcome[];
  session: SessionPort;
  allItems: ItemParam[];
  errors: AgentTurnError[];
  iteration: number;
  emit: (event: AgentEvent) => void;
  emitStopReason: (
    reason: TurnStopReasonEvent["reason"],
    detail: string,
  ) => void;
  narrate: (
    eventType: WorkingNarrationEventType,
    message: string,
    evidenceIds?: string[],
  ) => void;
}

export function decideAfterToolIteration(
  input: ToolIterationDecisionInput,
): ToolIterationDecision {
  if (input.fixUntilGreenStop) {
    input.narrate("blocked", input.fixUntilGreenStop);
    input.errors.push(
      createTurnError("timeout", input.fixUntilGreenStop, input.iteration),
    );
    input.emit({
      type: "turn_error",
      timestamp: Date.now(),
      error: input.fixUntilGreenStop,
    });
    input.emitStopReason("loop-guard", input.fixUntilGreenStop);
    return "break";
  }

  if (input.fixUntilGreenFollowUp) {
    input.narrate("recovery", input.fixUntilGreenFollowUp);
    appendRecoveryItem(input, input.fixUntilGreenFollowUp);
    return "continue";
  }

  const progressDecision = input.loopGuard.observeToolIteration(
    input.iterationOutcomes,
  );
  if (progressDecision.action === "recover") {
    input.narrate("recovery", progressDecision.message);
    input.emit({
      type: "loop_guard",
      timestamp: Date.now(),
      action: "recover",
      iteration: input.iteration,
      message: progressDecision.message,
    });
    appendRecoveryItem(input, progressDecision.message);
    return "continue";
  }

  if (progressDecision.action === "stop") {
    input.narrate("blocked", progressDecision.message);
    input.errors.push(
      createTurnError("timeout", progressDecision.message, input.iteration),
    );
    input.emit({
      type: "loop_guard",
      timestamp: Date.now(),
      action: "stop",
      iteration: input.iteration,
      message: progressDecision.message,
    });
    input.emit({
      type: "turn_error",
      timestamp: Date.now(),
      error: progressDecision.message,
    });
    input.emitStopReason("loop-guard", progressDecision.message);
    return "break";
  }

  return "next";
}

function appendRecoveryItem(
  input: Pick<ToolIterationDecisionInput, "session" | "allItems">,
  message: string,
): void {
  const recoveryItem = createUserItem(message);
  input.session.appendItem(recoveryItem as unknown as SessionItemParam);
  input.allItems.push(recoveryItem as unknown as ItemParam);
}
