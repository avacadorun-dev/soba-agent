import type { ItemParam } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { ItemParam as SessionItemParam } from "../../kernel/transcript/types";
import type { WorkingNarrationEventType } from "./narration";
import { createTurnError, createUserItem } from "./turn-helpers";
import type { AgentEvent, AgentTurnError, TurnStopReasonEvent } from "./types";

export type ResponseContinuationAction = "next" | "continue" | "break";

export interface ResponseContinuationDecisionInput {
  shouldContinue: boolean;
  toolCallsLength: number;
  continuationAttempts: number;
  maxContinuationAttempts: number;
  session: SessionPort;
  allItems: ItemParam[];
  errors: AgentTurnError[];
  iteration: number;
  appendAssistantMessagesToSession: () => void;
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

export interface ResponseContinuationDecisionResult {
  action: ResponseContinuationAction;
  continuationAttempts: number;
  iteration: number;
}

export function decideResponseContinuation(
  input: ResponseContinuationDecisionInput,
): ResponseContinuationDecisionResult {
  if (!input.shouldContinue) {
    return unchanged(input, "next");
  }

  if (input.continuationAttempts < input.maxContinuationAttempts) {
    input.appendAssistantMessagesToSession();
    const continuationItem = createUserItem(continuationPrompt(input.toolCallsLength));
    input.session.appendItem(continuationItem as unknown as SessionItemParam);
    input.allItems.push(continuationItem as unknown as ItemParam);
    return {
      action: "continue",
      continuationAttempts: input.continuationAttempts + 1,
      iteration: input.iteration + 1,
    };
  }

  const message = input.toolCallsLength > 0
    ? `Response remained incomplete while generating tool calls after ${input.maxContinuationAttempts} automatic continuations`
    : `Response remained incomplete after ${input.maxContinuationAttempts} automatic continuations`;
  input.narrate("blocked", message);
  input.errors.push(createTurnError("api_error", message, input.iteration));
  input.emit({
    type: "turn_error",
    timestamp: Date.now(),
    error: message,
    status: "incomplete",
  });
  input.emitStopReason("continuation-exhausted", message);
  return unchanged(input, "break");
}

function continuationPrompt(toolCallsLength: number): string {
  if (toolCallsLength > 0) {
    return (
      "Your previous response was cut off while generating a tool call. " +
      "Discard the incomplete tool call and re-issue the intended tool call from scratch with complete valid JSON arguments."
    );
  }

  return "Continue exactly where you stopped. Do not repeat completed text. Keep working until the task is complete.";
}

function unchanged(
  input: ResponseContinuationDecisionInput,
  action: ResponseContinuationAction,
): ResponseContinuationDecisionResult {
  return {
    action,
    continuationAttempts: input.continuationAttempts,
    iteration: input.iteration,
  };
}
