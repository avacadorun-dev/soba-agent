import type { ItemParam, MessageField } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type {
  DebugEntry,
  ItemParam as SessionItemParam,
} from "../../kernel/transcript/types";
import type { WorkMode } from "../../kernel/work-mode/public";
import { extractTextFromOutput } from "../model-turn/model-turn-runner";
import type { TaskKind } from "../verification/verification-policy";
import type { WorkingNarrationEventType } from "./narration";
import {
  createTurnError,
  createUserItem,
  getAutonomousFollowUpReason,
  hasVisibleAssistantText,
} from "./turn-helpers";
import type { AgentEvent, AgentTurnError, TurnStopReasonEvent } from "./types";

export type TextOnlyResponseAction = "break" | "continue";

export interface TextOnlyTurnState {
  needsVerification: boolean;
  hasMutatedFiles: boolean;
  hasUsedTools: boolean;
}

export interface TextOnlyResponseDecisionInput {
  assistantMessages: MessageField[];
  session: SessionPort;
  allItems: ItemParam[];
  errors: AgentTurnError[];
  turn: number;
  taskKind: TaskKind;
  workMode: WorkMode;
  iteration: number;
  autonomousFollowUps: number;
  maxAutonomousFollowUps: number;
  ledgerNeedsVerification: () => boolean;
  getTurnState: () => TextOnlyTurnState;
  runAutoVerification: () => Promise<boolean>;
  appendAssistantMessagesToSession: () => void;
  supersedeVisibleAssistantMessages: () => void;
  emit: (event: AgentEvent) => void;
  debug: (data: DebugEntry["data"]) => void;
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

export interface TextOnlyResponseDecisionResult {
  action: TextOnlyResponseAction;
  iteration: number;
  autonomousFollowUps: number;
}

export async function decideTextOnlyResponse(
  input: TextOnlyResponseDecisionInput,
): Promise<TextOnlyResponseDecisionResult> {
  if (input.ledgerNeedsVerification()) {
    await input.runAutoVerification();
  }

  const state = input.getTurnState();
  const autonomousReason = getAutonomousFollowUpReason(
    input.assistantMessages,
    state.needsVerification,
    input.errors.filter((error) => error.status === "active"),
    state.hasMutatedFiles,
    state.hasUsedTools,
    input.taskKind,
    input.workMode,
  );

  const hadSecurityDenialThisTurn = input.errors.some(
    (error) => error.type === "security_denial",
  );
  if (hadSecurityDenialThisTurn && autonomousReason) {
    input.appendAssistantMessagesToSession();
    input.emitStopReason(
      "security-denial",
      "Turn stopped after security denial. The model has been instructed not to continue.",
    );
    return unchanged(input, "break");
  }

  if (
    autonomousReason &&
    input.autonomousFollowUps < input.maxAutonomousFollowUps
  ) {
    const autonomousFollowUps = input.autonomousFollowUps + 1;
    input.supersedeVisibleAssistantMessages();
    input.debug({
      event: "loop/auto-continue",
      turn: input.turn,
      iteration: input.iteration,
      toolCalls: 0,
      hasUsedTools: state.hasUsedTools,
      needsVerification: state.needsVerification,
      autonomousFollowUps,
      autoContinue: true,
      textPreview: input.assistantMessages
        .map(extractTextFromOutput)
        .join(" ")
        .slice(0, 100),
    });
    const hasActiveErrors = input.errors.some(
      (error) => error.status === "active",
    );
    const requiredAction = hasActiveErrors
      ? "Call a different available tool or command now to resolve or bypass the error. Do not call finish while the error is active."
      : "Either call a tool to make progress, or call finish with your final response and completion criteria.";
    const followUpItem = createUserItem(
      `${autonomousReason} Do not output commentary about the situation. ${requiredAction}`,
    );
    input.session.appendItem(followUpItem as unknown as SessionItemParam);
    input.allItems.push(followUpItem as unknown as ItemParam);
    return {
      action: "continue",
      iteration: input.iteration + 1,
      autonomousFollowUps,
    };
  }

  if (autonomousReason) {
    return stopAfterAutonomousFollowUps(input);
  }

  input.appendAssistantMessagesToSession();
  input.emitStopReason("completed", "Model returned a final response");
  input.narrate("completion", "Finishing with a visible final response.");
  return unchanged(input, "break");
}

function stopAfterAutonomousFollowUps(
  input: TextOnlyResponseDecisionInput,
): TextOnlyResponseDecisionResult {
  const activeErrors = input.errors.filter((error) => error.status === "active");
  if (activeErrors.length > 0) {
    input.appendAssistantMessagesToSession();
    const actualCount = input.autonomousFollowUps + 1;
    const message = `No tool calls or finish after ${actualCount} attempts. Active errors remain unresolved.`;
    input.narrate("blocked", message);
    input.errors.push(createTurnError("timeout", message, input.iteration));
    input.emit({
      type: "turn_error",
      timestamp: Date.now(),
      error: message,
    });
    input.emitStopReason("loop-guard", message);
    return unchanged(input, "break");
  }

  if (!hasVisibleAssistantText(input.assistantMessages)) {
    input.appendAssistantMessagesToSession();
    const actualCount = input.autonomousFollowUps + 1;
    const message = `No visible response after ${actualCount} attempts. The model kept producing only thinking without substantive output.`;
    input.narrate("blocked", message);
    input.errors.push(createTurnError("timeout", message, input.iteration));
    input.emit({
      type: "turn_error",
      timestamp: Date.now(),
      error: message,
    });
    input.emitStopReason("loop-guard", message);
    return unchanged(input, "break");
  }

  input.appendAssistantMessagesToSession();
  input.emitStopReason(
    "completed",
    "Model returned a text-only response; accepting as final answer",
  );
  input.narrate("completion", "Finishing with a visible final response.");
  return unchanged(input, "break");
}

function unchanged(
  input: TextOnlyResponseDecisionInput,
  action: TextOnlyResponseAction,
): TextOnlyResponseDecisionResult {
  return {
    action,
    iteration: input.iteration,
    autonomousFollowUps: input.autonomousFollowUps,
  };
}
