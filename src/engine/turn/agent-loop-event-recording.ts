import type { FlightRecordData } from "../../kernel/transcript/types";
import type { AgentEvent, TurnStopReasonEvent } from "./types";

export interface TurnStopReasonInput {
  turn: number;
  iteration: number;
  reason: TurnStopReasonEvent["reason"];
  detail: string;
  hasUsedTools: boolean;
  autonomousFollowUps: number;
}

export function runtimeFlightRecords(event: AgentEvent): Array<Omit<FlightRecordData, "version">> {
  const turn = "turnIndex" in event
    ? event.turnIndex
    : "turn" in event && typeof event.turn === "number"
      ? event.turn
      : undefined;
  const iteration = "iteration" in event && typeof event.iteration === "number" ? event.iteration : undefined;

  const records: Array<Omit<FlightRecordData, "version">> = [
    {
      kind: "runtime_event",
      turn,
      iteration,
      payload: event,
    },
  ];

  if (event.type === "tool_call_start") {
    records.push({
      kind: "tool_call",
      turn,
      iteration,
      payload: {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      },
    });
  } else if (event.type === "tool_call_result") {
    records.push({
      kind: "tool_result",
      turn,
      iteration,
      payload: {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
      },
    });
  }

  return records;
}

export function turnStopReasonEvent(input: TurnStopReasonInput): TurnStopReasonEvent {
  return {
    type: "turn_stop_reason",
    timestamp: Date.now(),
    turn: input.turn,
    iteration: input.iteration,
    reason: input.reason,
    detail: input.detail,
    hasUsedTools: input.hasUsedTools,
    autonomousFollowUps: input.autonomousFollowUps,
  };
}

export function turnStopDebugData(input: TurnStopReasonInput) {
  return {
    event: "loop/stop" as const,
    turn: input.turn,
    iteration: input.iteration,
    reason: input.reason,
    detail: input.detail,
    hasUsedTools: input.hasUsedTools,
    autonomousFollowUps: input.autonomousFollowUps,
  };
}

export function buildDenialEphemeralMessages(
  denialCount: number,
  lastDeniedOperation: string,
): Array<{ role: "developer"; content: string }> {
  if (denialCount === 0) return [];

  const op = lastDeniedOperation || "the operation";

  if (denialCount === 1) {
    return [
      {
        role: "developer",
        content:
          `IMPORTANT: Your previous attempt to perform "${op}" was DENIED by the user through the security dialog. ` +
          "This is a FINAL decision - do NOT attempt to achieve the same result through alternative commands, " +
          "indirect approaches, or workarounds. The denial means the user does not want this operation executed. " +
          "Acknowledge the denial and either continue with unrelated parts of the task or ask the user how to proceed.",
      },
    ];
  }

  return [
    {
      role: "developer",
      content:
        `CRITICAL: You have been denied ${denialCount} times in this turn (last: "${op}"). ` +
        "These denials are SECURITY DECISIONS by the user, not transient errors. " +
        "STOP searching for workarounds. Do NOT try: different commands, script wrappers (bun -e, node -e, python -c), " +
        "file moves (mv to /tmp), or any indirect method to achieve the denied outcome. " +
        "Explain what was blocked by security and ask the user how they want to proceed.",
    },
  ];
}
