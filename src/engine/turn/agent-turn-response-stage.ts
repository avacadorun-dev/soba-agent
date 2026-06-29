import type { ItemParam, ResponseResource, Usage } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { DebugEntry } from "../../kernel/transcript/types";
import { extractTextFromOutput } from "../model-turn/model-turn-runner";
import type { AgentLoopRuntimeServices } from "./agent-loop-runtime";
import { createAssistantSessionRecorder } from "./assistant-session-recorder";
import type { ModelTurnExecutionResult } from "./model-turn-execution";
import type { WorkingNarrationEventType } from "./narration";
import { decideResponseContinuation } from "./response-continuation-decision";
import { handleResponseStatus, recordResponseUsage } from "./response-lifecycle";
import { FINISH_TOOL_NAME } from "./turn-helpers";
import type { AgentEvent, AgentTurnError, TurnStopReasonEvent } from "./types";

type ResponseExecution = Extract<ModelTurnExecutionResult, { action: "response" }>;
type AssistantSessionRecorder = ReturnType<typeof createAssistantSessionRecorder>;

export type AgentTurnResponseStageResult =
  | {
      action: "continue" | "break";
      response: ResponseResource;
      iteration: number;
      continuationAttempts: number;
    }
  | {
      action: "ready";
      response: ResponseResource;
      toolCalls: ResponseExecution["toolCalls"];
      assistantMessages: ResponseExecution["assistantMessages"];
      recorder: AssistantSessionRecorder;
      iteration: number;
      continuationAttempts: number;
    };

export function handleAgentTurnResponseStage(input: {
  execution: ResponseExecution;
  runtime: AgentLoopRuntimeServices;
  session: SessionPort;
  allItems: ItemParam[];
  errors: AgentTurnError[];
  turnIndex: number;
  turnCount: number;
  totalUsage: Usage;
  iteration: number;
  continuationAttempts: number;
  contextWindow: number;
  hasUsedTools: boolean;
  needsVerification: boolean;
  autonomousFollowUps: number;
  emit(event: AgentEvent): void;
  debug(data: DebugEntry["data"]): void;
  emitStopReason(reason: TurnStopReasonEvent["reason"], detail: string): void;
  narrate: (eventType: WorkingNarrationEventType, message: string, evidenceIds?: string[]) => void;
}): AgentTurnResponseStageResult {
  const {
    execution,
    runtime,
    session,
    allItems,
    errors,
    turnIndex,
    turnCount,
    totalUsage,
    iteration,
    continuationAttempts,
    contextWindow,
    hasUsedTools,
    needsVerification,
    autonomousFollowUps,
    emit,
    debug,
    emitStopReason,
    narrate,
  } = input;
  const { response, toolCalls, assistantMessages, systemPromptTokens, toolSchemaTokens } = execution;

  runtime.contextController.recordProviderUsage(response, `turn_${turnCount}`);
  debug({
    event: "loop/response",
    turn: turnIndex,
    iteration,
    responseId: response.id,
    responseStatus: response.status,
    toolCalls: toolCalls.length,
    assistantMessages: assistantMessages.length,
    hasUsedTools,
    needsVerification,
    autonomousFollowUps,
    textPreview: assistantMessages.map(extractTextFromOutput).join(" ").slice(0, 100),
    assistantPhases: assistantMessages.map((message) => message.phase ?? null),
    finishCalls: toolCalls.filter((toolCall) => toolCall.name === FINISH_TOOL_NAME).length,
  });

  const responseStatus = handleResponseStatus({
    response,
    errors,
    iteration,
    emit,
    emitStopReason,
    narrateBlocked: (message) => narrate("blocked", message),
  });
  if (responseStatus.action === "break") {
    return { action: "break", response, iteration, continuationAttempts };
  }

  recordResponseUsage({
    response,
    totalUsage,
    budgetTracker: runtime.budgetTracker,
    contextController: runtime.contextController,
    tokenBudget: runtime.options.tokenBudget,
    contextWindow,
    systemPromptTokens,
    toolSchemaTokens,
    turn: turnIndex,
    emit,
  });

  const recorder = createAssistantSessionRecorder({
    session,
    allItems,
    assistantMessages,
    emit,
  });
  const continuationDecision = decideResponseContinuation({
    shouldContinue: responseStatus.shouldContinue,
    toolCallsLength: toolCalls.length,
    continuationAttempts,
    maxContinuationAttempts: runtime.options.maxContinuationAttempts,
    session,
    allItems,
    errors,
    iteration,
    appendAssistantMessagesToSession: recorder.appendAssistantMessagesToSession,
    emit,
    emitStopReason,
    narrate,
  });

  if (continuationDecision.action !== "next") {
    return {
      action: continuationDecision.action,
      response,
      iteration: continuationDecision.iteration,
      continuationAttempts: continuationDecision.continuationAttempts,
    };
  }

  return {
    action: "ready",
    response,
    toolCalls,
    assistantMessages,
    recorder,
    iteration: continuationDecision.iteration,
    continuationAttempts: continuationDecision.continuationAttempts,
  };
}
