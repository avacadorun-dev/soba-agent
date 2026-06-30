import type { FunctionCallField, ItemParam } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import { toolResultToOutputItem } from "../../kernel/tools/types";
import type {
  DebugEntry,
  FlightRecordData,
  ItemParam as SessionItemParam,
} from "../../kernel/transcript/types";
import type { CompletionController } from "../completion/completion-controller";
import { acknowledgeErrors } from "../completion/completion-gate";
import { buildEvidenceBundle, type EvidenceProofSink, formatEvidenceBundleForHandoff } from "../evidence";
import type { EvidenceLedger } from "../evidence/evidence-ledger";
import { extractTextFromOutput } from "../model-turn/model-turn-runner";
import type { TaskKind } from "../verification/verification-policy";
import type { WorkingNarrationEventType } from "./narration";
import {
  createTurnError,
  finishRequestToMessage,
  outputItemToSessionItem,
} from "./turn-helpers";
import type { AgentEvent, AgentTurnError, TurnStopReasonEvent } from "./types";

export type FinishCallDecision = "continue" | "break";

export interface FinishCallHandlerInput {
  finishCall: FunctionCallField;
  completionController: CompletionController;
  evidenceLedger: EvidenceLedger;
  errors: AgentTurnError[];
  taskKind: TaskKind;
  allowUnverifiedCompletion: boolean;
  runAutoVerification: () => Promise<boolean>;
  appendAssistantMessagesToSession: () => void;
  session: SessionPort;
  allItems: ItemParam[];
  turn: number;
  iteration: number;
  hasUsedTools: boolean;
  needsVerification: boolean;
  autonomousFollowUps: number;
  verificationEvidenceCallIds: Set<string>;
  successfulToolCallIds: Set<string>;
  evidenceProofSink?: EvidenceProofSink;
  emit: (event: AgentEvent) => void;
  flight: (data: Omit<FlightRecordData, "version">) => void;
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

export async function handleFinishCall(input: FinishCallHandlerInput): Promise<FinishCallDecision> {
  let finishEvaluation = input.completionController.evaluateFinishCall(input.finishCall, {
    ...input.evidenceLedger.toCompletionState(input.errors),
    taskKind: input.taskKind,
    allowUnverifiedCompletion: input.allowUnverifiedCompletion,
  });
  if (finishEvaluation.kind === "rejected" && input.evidenceLedger.getSummary().needsVerification) {
    const didAutoVerify = await input.runAutoVerification();
    if (didAutoVerify) {
      finishEvaluation = input.completionController.evaluateFinishCall(input.finishCall, {
        ...input.evidenceLedger.toCompletionState(input.errors),
        taskKind: input.taskKind,
        allowUnverifiedCompletion: input.allowUnverifiedCompletion,
      });
    }
  }

  if (finishEvaluation.kind === "rejected" || finishEvaluation.kind === "invalid") {
    input.appendAssistantMessagesToSession();
    input.evidenceLedger.recordFinishAttempt(
      "rejected",
      finishEvaluation.kind === "invalid"
        ? "Invalid finish arguments"
        : finishEvaluation.reasons.join("; "),
    );
    input.flight({
      kind: "completion_decision",
      turn: input.turn,
      iteration: input.iteration,
      payload: {
        status: "rejected",
        kind: finishEvaluation.kind,
        toolCallId: input.finishCall.call_id,
        detail: finishEvaluation.kind === "invalid"
          ? finishEvaluation.diagnosis.join(" ")
          : finishEvaluation.reasons.join("; "),
      },
    });
    const fcItem = outputItemToSessionItem(input.finishCall);
    if (fcItem) {
      input.session.appendItem(fcItem as unknown as SessionItemParam);
      input.allItems.push(fcItem);
    }
    const rejection = input.completionController.createRejectionResult(finishEvaluation);
    const outputItem = toolResultToOutputItem(
      rejection,
      input.finishCall.call_id,
      input.finishCall.name,
    );
    input.session.appendItem(outputItem);
    input.allItems.push(outputItem);
    input.debug({
      event: "loop/finish-rejected",
      turn: input.turn,
      iteration: input.iteration,
      toolCalls: 1,
      hasUsedTools: input.hasUsedTools,
      needsVerification: input.needsVerification,
      autonomousFollowUps: input.autonomousFollowUps,
      activeErrors: input.errors.filter((error) => error.status === "active").length,
      detail: finishEvaluation.kind === "invalid"
        ? finishEvaluation.diagnosis.join(" ")
        : finishEvaluation.reasons.join(" "),
    });
    const rejectionState = input.completionController.recordRejection(finishEvaluation);
    if (rejectionState.limitExceeded) {
      input.errors.push(createTurnError("timeout", rejectionState.message, input.iteration));
      input.emit({
        type: "turn_error",
        timestamp: Date.now(),
        error: rejectionState.message,
      });
      input.emitStopReason("loop-guard", rejectionState.message);
      return "break";
    }
    return "continue";
  }

  const finishRequest = finishEvaluation.request;
  acknowledgeErrors(input.errors, finishRequest.acknowledgedErrorIds);
  input.evidenceLedger.recordFinishAttempt("accepted", finishRequest.summary);
  const evidenceBundle = buildEvidenceBundle({
    sessionId: input.session.getSessionId(),
    turnId: `turn_${input.turn}`,
    completionStatus: finishRequest.status,
    summary: finishRequest.summary,
    criteria: finishRequest.criteria,
    ledger: input.evidenceLedger.getSummary(),
  });
  let proofPath: string | undefined;
  if (input.evidenceProofSink) {
    try {
      proofPath = (await input.evidenceProofSink.saveEvidenceBundle(evidenceBundle)).path;
    } catch (error) {
      input.flight({
        kind: "runtime_event",
        turn: input.turn,
        iteration: input.iteration,
        payload: {
          event: "evidence_proof_persist_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  const evidenceFlightPayload = proofPath ? { ...evidenceBundle, proofPath } : evidenceBundle;
  if (evidenceBundle.diff) {
    input.flight({
      kind: "diff_summary",
      turn: input.turn,
      iteration: input.iteration,
      payload: evidenceBundle.diff,
    });
  }
  input.flight({
    kind: "evidence_bundle",
    turn: input.turn,
    iteration: input.iteration,
    payload: evidenceFlightPayload,
  });
  input.flight({
    kind: "completion_decision",
    turn: input.turn,
    iteration: input.iteration,
    payload: {
      status: "accepted",
      completionStatus: finishRequest.status,
      summary: finishRequest.summary,
      criteria: finishRequest.criteria,
      acknowledgedErrorIds: finishRequest.acknowledgedErrorIds,
    },
  });
  const finishMessage = finishRequestToMessage(
    input.finishCall,
    finishRequest.summary,
    finishRequest.status,
    formatEvidenceBundleForHandoff(evidenceBundle),
  );
  const text = extractTextFromOutput(finishMessage);
  const sessionItem = outputItemToSessionItem(finishMessage);
  if (sessionItem) {
    input.session.appendItem(sessionItem as unknown as SessionItemParam);
    input.allItems.push(sessionItem);
  }
  input.emit({
    type: "assistant_message",
    timestamp: Date.now(),
    messageId: finishMessage.id,
    text,
  });
  input.narrate(
    finishRequest.status === "blocked" ? "blocked" : "completion",
    finishRequest.status === "blocked"
      ? "Finishing as blocked with a concrete external blocker."
      : finishRequest.status === "completed_with_unverified_changes"
        ? "Finishing with explicitly visible unverified changes."
        : "Finishing after satisfying the current completion gate.",
    input.verificationEvidenceCallIds.size > 0
      ? [...input.verificationEvidenceCallIds]
      : input.successfulToolCallIds.size > 0
        ? [...input.successfulToolCallIds]
        : [],
  );
  input.debug({
    event: "loop/explicit-finish",
    turn: input.turn,
    iteration: input.iteration,
    toolCalls: 1,
    hasUsedTools: input.hasUsedTools,
    needsVerification: input.needsVerification,
    autonomousFollowUps: input.autonomousFollowUps,
    textPreview: text.slice(0, 100),
    activeErrors: input.errors.filter((error) => error.status === "active").length,
  });
  input.emitStopReason("completed", "Model used the explicit finish control tool");
  return "break";
}
