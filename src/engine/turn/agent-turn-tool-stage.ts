import type { FunctionCallField, ItemParam } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { DebugEntry } from "../../kernel/transcript/types";
import type { EvidenceLedger } from "../evidence/evidence-ledger";
import type { RecoveryReflectionDraft } from "../memory/reflection-memory-policy";
import { evaluateToolBatch } from "../tool-calls/tool-batch-guard";
import type { VerificationController } from "../verification/verification-controller";
import type { AgentLoopRuntimeServices } from "./agent-loop-runtime";
import { emitToolResultAndEnd } from "./agent-turn-runner-events";
import { scheduleCheckpointCompactionForTurn } from "./checkpoint-compaction-scheduler";
import type { LoopGuard } from "./loop-guard";
import type { WorkingNarrationEventType } from "./narration";
import { handleRejectedToolBatch } from "./rejected-tool-batch-handler";
import { executeObservedToolBatch } from "./tool-batch-execution";
import type { ToolExecutionObservationState } from "./tool-execution-observer";
import { decideAfterToolIteration } from "./tool-iteration-decision";
import { checkpointEventToPlanState } from "./turn-helpers";
import type {
  AgentEvent,
  AgentTurnError,
  CheckpointWorkPlanState,
  TurnStopReasonEvent,
} from "./types";

export type AgentTurnToolStageResult =
  | {
      action: "continue" | "break";
      usedTools: boolean;
      iteration: number;
      needsVerification: boolean;
      hasMutatedFiles: boolean;
      recoveryReflectionDraft: RecoveryReflectionDraft | null;
      checkpointState: CheckpointWorkPlanState | undefined;
    }
  | {
      action: "next";
      usedTools: boolean;
      iteration: number;
      needsVerification: boolean;
      hasMutatedFiles: boolean;
      recoveryReflectionDraft: RecoveryReflectionDraft | null;
      checkpointState: CheckpointWorkPlanState | undefined;
    };

export async function handleAgentTurnToolStage(input: {
  toolCalls: FunctionCallField[];
  appendToolCallGroupToSession(toolCalls: FunctionCallField[]): void;
  runtime: AgentLoopRuntimeServices;
  signal: AbortSignal;
  session: SessionPort;
  allItems: ItemParam[];
  errors: AgentTurnError[];
  successfulToolCallIds: Set<string>;
  verificationEvidenceCallIds: Set<string>;
  evidenceLedger: EvidenceLedger;
  verificationController: VerificationController;
  loopGuard: LoopGuard;
  taskText: string;
  turnIndex: number;
  iteration: number;
  systemPrompt: string;
  needsVerification: boolean;
  hasMutatedFiles: boolean;
  recoveryReflectionDraft: RecoveryReflectionDraft | null;
  recordDenial(description: string): void;
  emit(event: AgentEvent): void;
  debug(data: DebugEntry["data"]): void;
  emitStopReason(
    iteration: number,
    hasUsedTools: boolean,
    reason: TurnStopReasonEvent["reason"],
    detail: string,
  ): void;
  narrate(eventType: WorkingNarrationEventType, message: string, evidenceIds?: string[]): void;
}): Promise<AgentTurnToolStageResult> {
  input.appendToolCallGroupToSession(input.toolCalls);

  const batchDecision = evaluateToolBatch(input.toolCalls);
  if (batchDecision.action === "reject") {
    const rejectedBatchResult = handleRejectedToolBatch({
      batchDecision,
      toolCalls: input.toolCalls,
      session: input.session,
      allItems: input.allItems,
      errors: input.errors,
      successfulToolCallIds: input.successfulToolCallIds,
      evidenceLedger: input.evidenceLedger,
      loopGuard: input.loopGuard,
      iteration: input.iteration,
      emit: input.emit,
      emitToolResultAndEnd: (toolCall, result, startedAt) =>
        emitToolResultAndEnd(input.emit, toolCall, result, startedAt),
      emitStopReason: (reason, detail) =>
        input.emitStopReason(input.iteration, true, reason, detail),
      narrate: input.narrate,
    });

    return {
      action: rejectedBatchResult.action,
      usedTools: rejectedBatchResult.usedTools,
      iteration: input.iteration + (rejectedBatchResult.action === "continue" ? 1 : 0),
      needsVerification: input.needsVerification,
      hasMutatedFiles: input.hasMutatedFiles,
      recoveryReflectionDraft: input.recoveryReflectionDraft,
      checkpointState: undefined,
    };
  }

  let fixUntilGreenFollowUp: string | null = null;
  let fixUntilGreenStop: string | null = null;
  const toolObservationState: ToolExecutionObservationState = {
    needsVerification: input.needsVerification,
    hasMutatedFiles: input.hasMutatedFiles,
    mutationSucceededInCurrentBatch: false,
    recoveryReflectionDraft: input.recoveryReflectionDraft,
    fixUntilGreenFollowUp,
    fixUntilGreenStop,
  };
  const toolBatchExecution = await executeObservedToolBatch({
    toolCalls: input.toolCalls,
    toolExecutor: input.runtime.toolExecutor,
    signal: input.signal,
    session: input.session,
    allItems: input.allItems,
    errors: input.errors,
    successfulToolCallIds: input.successfulToolCallIds,
    verificationEvidenceCallIds: input.verificationEvidenceCallIds,
    evidenceLedger: input.evidenceLedger,
    verificationController: input.verificationController,
    skillManager: input.runtime.skillManager,
    projectMemory: input.runtime.projectMemory,
    taskText: input.taskText,
    iteration: input.iteration,
    state: toolObservationState,
    recordDenial: input.recordDenial,
    emit: input.emit,
    narrate: input.narrate,
  });

  let checkpointState: CheckpointWorkPlanState | undefined;
  for (const checkpointEvent of toolBatchExecution.checkpointEvents) {
    checkpointState = checkpointEventToPlanState(checkpointEvent);
  }

  const nextNeedsVerification = toolBatchExecution.state.needsVerification;
  const nextHasMutatedFiles = toolBatchExecution.state.hasMutatedFiles;
  const nextRecoveryReflectionDraft = toolBatchExecution.state.recoveryReflectionDraft;
  fixUntilGreenFollowUp = toolBatchExecution.state.fixUntilGreenFollowUp;
  fixUntilGreenStop = toolBatchExecution.state.fixUntilGreenStop;

  if (toolBatchExecution.checkpointEvents.length > 0) {
    scheduleCheckpointCompactionForTurn({
      checkpointEvents: toolBatchExecution.checkpointEvents,
      contextController: input.runtime.contextController,
      tools: input.runtime.tools,
      turnIndex: input.turnIndex,
      iteration: input.iteration,
      systemPrompt: input.systemPrompt,
      debug: input.debug,
    });
  }

  const nextIteration = input.iteration + 1;
  const afterToolDecision = decideAfterToolIteration({
    fixUntilGreenStop,
    fixUntilGreenFollowUp,
    loopGuard: input.loopGuard,
    iterationOutcomes: toolBatchExecution.iterationOutcomes,
    session: input.session,
    allItems: input.allItems,
    errors: input.errors,
    iteration: nextIteration,
    emit: input.emit,
    emitStopReason: (reason, detail) =>
      input.emitStopReason(nextIteration, true, reason, detail),
    narrate: input.narrate,
  });

  return {
    action: afterToolDecision,
    usedTools: toolBatchExecution.usedTools,
    iteration: nextIteration,
    needsVerification: nextNeedsVerification,
    hasMutatedFiles: nextHasMutatedFiles,
    recoveryReflectionDraft: nextRecoveryReflectionDraft,
    checkpointState,
  };
}
