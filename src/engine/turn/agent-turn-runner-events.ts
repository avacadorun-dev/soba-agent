import type { ToolResult } from "../../kernel/tools/types";
import type { DebugEntry } from "../../kernel/transcript/types";
import {
  buildDenialEphemeralMessages as buildDenialEphemeralMessagesForState,
  turnStopDebugData,
  turnStopReasonEvent,
} from "./agent-loop-event-recording";
import {
  createWorkingNarration,
  type WorkingNarrationEventType,
} from "./narration";
import type { AgentEvent, TurnStopReasonEvent } from "./types";

interface DenialState {
  denialCount: number;
  lastDeniedOperation: string;
}

export function createTurnStopEmitter(input: {
  emit(event: AgentEvent): void;
  debug(data: DebugEntry["data"]): void;
}): (
  turn: number,
  iteration: number,
  reason: TurnStopReasonEvent["reason"],
  detail: string,
  hasUsedTools: boolean,
  autonomousFollowUps: number,
) => void {
  return (turn, iteration, reason, detail, hasUsedTools, autonomousFollowUps) => {
    const eventInput = {
      turn,
      iteration,
      reason,
      detail,
      hasUsedTools,
      autonomousFollowUps,
    };
    input.emit(turnStopReasonEvent(eventInput));
    input.debug(turnStopDebugData(eventInput));
  };
}

export function emitWorkingNarration(
  emit: (event: AgentEvent) => void,
  eventType: WorkingNarrationEventType,
  message: string,
  evidenceIds: string[] = [],
): void {
  const narration = createWorkingNarration({ eventType, message, evidenceIds });
  emit({
    type: "working_narration",
    timestamp: Date.now(),
    eventType: narration.eventType,
    message: narration.message,
    evidenceIds: narration.evidenceIds,
  });
}

export function buildDenialEphemeralMessages(state: DenialState): Array<{
  role: "developer";
  content: string;
}> {
  return buildDenialEphemeralMessagesForState(state.denialCount, state.lastDeniedOperation);
}

export function emitToolResultAndEnd(
  emit: (event: AgentEvent) => void,
  toolCall: {
    call_id: string;
    name: string;
  },
  result: ToolResult,
  startTime: number,
): void {
  const durationMs = Date.now() - startTime;
  emit({
    type: "tool_call_result",
    timestamp: Date.now(),
    toolCallId: toolCall.call_id,
    toolName: toolCall.name,
    result,
  });
  emit({
    type: "tool_call_end",
    timestamp: Date.now(),
    toolCallId: toolCall.call_id,
    toolName: toolCall.name,
    durationMs,
  });
}
