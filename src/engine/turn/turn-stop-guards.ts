import type { LoopGuard } from "./loop-guard";
import { createTurnError } from "./turn-helpers";
import type { AgentEvent, AgentTurnError, TurnStopReasonEvent } from "./types";

const MAX_DENIALS_PER_TURN = 3;

export interface TurnStopGuardInput {
  loopGuard: LoopGuard;
  errors: AgentTurnError[];
  turn: number;
  iteration: number;
  denialCount: number;
  signal?: AbortSignal;
  hasUsedTools: boolean;
  autonomousFollowUps: number;
  emit: (event: AgentEvent) => void;
  emitStopReason: (
    reason: TurnStopReasonEvent["reason"],
    detail: string,
  ) => void;
  narrateBlocked: (message: string) => void;
}

export function evaluateTurnStopGuards(input: TurnStopGuardInput): "continue" | "break" {
  const limitDecision = input.loopGuard.checkLimits(input.iteration);
  if (limitDecision.action === "stop") {
    const message = limitDecision.message;
    input.narrateBlocked(message);
    input.errors.push(createTurnError("timeout", message, input.iteration));
    input.emit({
      type: "loop_guard",
      timestamp: Date.now(),
      action: "stop",
      iteration: input.iteration,
      message,
    });
    input.emit({
      type: "turn_error",
      timestamp: Date.now(),
      error: message,
    });
    input.emitStopReason("loop-guard", message);
    return "break";
  }

  if (input.denialCount >= MAX_DENIALS_PER_TURN) {
    const message = `Turn terminated: ${input.denialCount} operations were denied by security policy in this turn. The user has repeatedly blocked these operations — do not continue.`;
    input.narrateBlocked(message);
    input.errors.push(createTurnError("security_denial", message, input.iteration));
    input.emit({
      type: "loop_guard",
      timestamp: Date.now(),
      action: "stop",
      iteration: input.iteration,
      message,
    });
    input.emit({
      type: "turn_error",
      timestamp: Date.now(),
      error: message,
    });
    input.emitStopReason("security-denial", message);
    return "break";
  }

  if (input.signal?.aborted) {
    const cancelMsg = "Operation cancelled by user";
    input.errors.push(createTurnError("cancelled", cancelMsg, input.iteration));
    input.emit({
      type: "turn_stop_reason",
      timestamp: Date.now(),
      turn: input.turn,
      iteration: input.iteration,
      reason: "aborted",
      detail: cancelMsg,
      hasUsedTools: input.hasUsedTools,
      autonomousFollowUps: input.autonomousFollowUps,
    });
    return "break";
  }

  return "continue";
}
