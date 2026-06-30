import type { FunctionCallField, ItemParam, MessageField } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { DebugEntry, FlightRecordData } from "../../kernel/transcript/types";
import type { CompletionController } from "../completion/completion-controller";
import type { EvidenceProofSink } from "../evidence";
import type { EvidenceLedger } from "../evidence/evidence-ledger";
import type { TaskKind } from "../verification/verification-policy";
import type { AgentTurnResponseStageResult } from "./agent-turn-response-stage";
import { handleFinishCall } from "./finish-call-handler";
import type { WorkingNarrationEventType } from "./narration";
import { decideTextOnlyResponse } from "./text-only-response-decision";
import { FINISH_TOOL_NAME } from "./turn-helpers";
import type { AgentEvent, AgentTurnError, TurnStopReasonEvent } from "./types";

type ReadyResponseStage = Extract<AgentTurnResponseStageResult, { action: "ready" }>;

export type AgentTurnCompletionStageResult =
  | {
      action: "continue" | "break";
      iteration: number;
      autonomousFollowUps: number;
    }
  | {
      action: "tool_calls";
      toolCalls: FunctionCallField[];
      appendToolCallGroupToSession(toolCalls: FunctionCallField[]): void;
      iteration: number;
      autonomousFollowUps: number;
    };

export async function handleAgentTurnCompletionStage(input: {
  responseStage: ReadyResponseStage;
  completionController: CompletionController;
  evidenceLedger: EvidenceLedger;
  errors: AgentTurnError[];
  taskKind: TaskKind;
  allowUnverifiedCompletion: boolean;
  runAutoVerification(opportunity: string): Promise<boolean>;
  session: SessionPort;
  allItems: ItemParam[];
  turnIndex: number;
  iteration: number;
  hasUsedTools: boolean;
  needsVerification: boolean;
  hasMutatedFiles: boolean;
  autonomousFollowUps: number;
  maxAutonomousFollowUps: number;
  verificationEvidenceCallIds: Set<string>;
  successfulToolCallIds: Set<string>;
  evidenceProofSink?: EvidenceProofSink;
  emit(event: AgentEvent): void;
  flight(data: Omit<FlightRecordData, "version">): void;
  debug(data: DebugEntry["data"]): void;
  emitStopReason(reason: TurnStopReasonEvent["reason"], detail: string): void;
  narrate(eventType: WorkingNarrationEventType, message: string, evidenceIds?: string[]): void;
}): Promise<AgentTurnCompletionStageResult> {
  const {
    responseStage,
    completionController,
    evidenceLedger,
    errors,
    taskKind,
    allowUnverifiedCompletion,
    runAutoVerification,
    session,
    allItems,
    turnIndex,
    iteration,
    hasUsedTools,
    needsVerification,
    hasMutatedFiles,
    autonomousFollowUps,
    maxAutonomousFollowUps,
    verificationEvidenceCallIds,
    successfulToolCallIds,
    evidenceProofSink,
    emit,
    flight,
    debug,
    emitStopReason,
    narrate,
  } = input;
  const {
    appendAssistantMessagesToSession,
    appendToolCallGroupToSession,
    supersedeVisibleAssistantMessages,
  } = responseStage.recorder;
  const finishCall = finishCallFrom(responseStage.toolCalls);

  if (finishCall) {
    const finishDecision = await handleFinishCall({
      finishCall,
      completionController,
      evidenceLedger,
      errors,
      taskKind,
      allowUnverifiedCompletion,
      runAutoVerification: () => runAutoVerification("finish"),
      appendAssistantMessagesToSession,
      session,
      allItems,
      turn: turnIndex,
      iteration,
      hasUsedTools,
      needsVerification,
      autonomousFollowUps,
      verificationEvidenceCallIds,
      successfulToolCallIds,
      evidenceProofSink,
      emit,
      flight,
      debug,
      emitStopReason,
      narrate,
    });
    if (finishDecision === "continue") {
      return {
        action: "continue",
        iteration: iteration + 1,
        autonomousFollowUps,
      };
    }
    return { action: "break", iteration, autonomousFollowUps };
  }

  if (responseStage.toolCalls.length === 0) {
    return handleTextOnlyResponse({
      assistantMessages: responseStage.assistantMessages,
      session,
      allItems,
      errors,
      turnIndex,
      taskKind,
      iteration,
      autonomousFollowUps,
      maxAutonomousFollowUps,
      evidenceLedger,
      needsVerification,
      hasMutatedFiles,
      hasUsedTools,
      runAutoVerification,
      appendAssistantMessagesToSession,
      supersedeVisibleAssistantMessages,
      emit,
      debug,
      emitStopReason,
      narrate,
    });
  }

  return {
    action: "tool_calls",
    toolCalls: responseStage.toolCalls,
    appendToolCallGroupToSession,
    iteration,
    autonomousFollowUps: 0,
  };
}

async function handleTextOnlyResponse(input: {
  assistantMessages: MessageField[];
  session: SessionPort;
  allItems: ItemParam[];
  errors: AgentTurnError[];
  turnIndex: number;
  taskKind: TaskKind;
  iteration: number;
  autonomousFollowUps: number;
  maxAutonomousFollowUps: number;
  evidenceLedger: EvidenceLedger;
  needsVerification: boolean;
  hasMutatedFiles: boolean;
  hasUsedTools: boolean;
  runAutoVerification(opportunity: string): Promise<boolean>;
  appendAssistantMessagesToSession(): void;
  supersedeVisibleAssistantMessages(): void;
  emit(event: AgentEvent): void;
  debug(data: DebugEntry["data"]): void;
  emitStopReason(reason: TurnStopReasonEvent["reason"], detail: string): void;
  narrate(eventType: WorkingNarrationEventType, message: string, evidenceIds?: string[]): void;
}): Promise<AgentTurnCompletionStageResult> {
  const textOnlyDecision = await decideTextOnlyResponse({
    assistantMessages: input.assistantMessages,
    session: input.session,
    allItems: input.allItems,
    errors: input.errors,
    turn: input.turnIndex,
    taskKind: input.taskKind,
    iteration: input.iteration,
    autonomousFollowUps: input.autonomousFollowUps,
    maxAutonomousFollowUps: input.maxAutonomousFollowUps,
    ledgerNeedsVerification: () => input.evidenceLedger.getSummary().needsVerification,
    getTurnState: () => ({
      needsVerification: input.needsVerification,
      hasMutatedFiles: input.hasMutatedFiles,
      hasUsedTools: input.hasUsedTools,
    }),
    runAutoVerification: () => input.runAutoVerification("text-only-stop"),
    appendAssistantMessagesToSession: input.appendAssistantMessagesToSession,
    supersedeVisibleAssistantMessages: input.supersedeVisibleAssistantMessages,
    emit: input.emit,
    debug: input.debug,
    emitStopReason: input.emitStopReason,
    narrate: input.narrate,
  });

  return {
    action: textOnlyDecision.action,
    iteration: textOnlyDecision.iteration,
    autonomousFollowUps: textOnlyDecision.autonomousFollowUps,
  };
}

function finishCallFrom(toolCalls: FunctionCallField[]): FunctionCallField | null {
  return toolCalls.length === 1 && toolCalls[0]?.name === FINISH_TOOL_NAME ? toolCalls[0] : null;
}
