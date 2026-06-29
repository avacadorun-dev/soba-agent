import type { FunctionCallField, ItemParam } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { CheckpointEvent } from "../../kernel/tools/checkpoint";
import { type EvidenceLedger, isVerificationCommand } from "../evidence/evidence-ledger";
import type { ProjectMemorySource } from "../memory/memory-injector";
import type { ToolCallExecutor } from "../tool-calls/tool-call-executor";
import type { VerificationController } from "../verification/verification-controller";
import type { ToolOutcome } from "./loop-guard";
import type { WorkingNarrationEventType } from "./narration";
import type { SkillSource } from "./skill-source";
import {
  observeToolExecutionResult,
  type ToolExecutionObservationState,
} from "./tool-execution-observer";
import {
  canExecuteReadOnlyBatchInParallel,
  safeParseArgs,
} from "./turn-helpers";
import type { AgentEvent, AgentTurnError } from "./types";

export interface ToolBatchExecutionInput {
  toolCalls: FunctionCallField[];
  toolExecutor: ToolCallExecutor;
  signal: AbortSignal | undefined;
  session: SessionPort;
  allItems: ItemParam[];
  errors: AgentTurnError[];
  successfulToolCallIds: Set<string>;
  verificationEvidenceCallIds: Set<string>;
  evidenceLedger: EvidenceLedger;
  verificationController: VerificationController;
  skillManager: SkillSource | undefined;
  projectMemory: ProjectMemorySource | undefined;
  taskText: string;
  iteration: number;
  state: ToolExecutionObservationState;
  recordDenial: (description: string) => void;
  emit: (event: AgentEvent) => void;
  narrate: (
    eventType: WorkingNarrationEventType,
    message: string,
    evidenceIds?: string[],
  ) => void;
}

export interface ToolBatchExecutionResult {
  usedTools: boolean;
  iterationOutcomes: ToolOutcome[];
  checkpointEvents: CheckpointEvent[];
  state: ToolExecutionObservationState;
}

export async function executeObservedToolBatch(
  input: ToolBatchExecutionInput,
): Promise<ToolBatchExecutionResult> {
  const iterationOutcomes: ToolOutcome[] = [];
  const checkpointEvents: CheckpointEvent[] = [];
  const parallelReadOnlyExecutions = canExecuteReadOnlyBatchInParallel(input.toolCalls)
    ? await Promise.all(
        input.toolCalls.map((toolCall) =>
          input.toolExecutor.executeToolCall(toolCall, input.signal),
        ),
      )
    : null;

  for (let toolCallIndex = 0; toolCallIndex < input.toolCalls.length; toolCallIndex += 1) {
    const toolCall = input.toolCalls[toolCallIndex];
    if (!toolCall) continue;

    narrateToolIntent(input, toolCall);

    const execution = parallelReadOnlyExecutions
      ? parallelReadOnlyExecutions[toolCallIndex]
      : await input.toolExecutor.executeToolCall(toolCall, input.signal);
    if (!execution) continue;

    const observation = observeToolExecutionResult({
      toolCall,
      execution,
      session: input.session,
      allItems: input.allItems,
      errors: input.errors,
      successfulToolCallIds: input.successfulToolCallIds,
      verificationEvidenceCallIds: input.verificationEvidenceCallIds,
      evidenceLedger: input.evidenceLedger,
      verificationController: input.verificationController,
      skillManager: input.skillManager,
      projectMemory: input.projectMemory,
      taskText: input.taskText,
      iteration: input.iteration,
      state: input.state,
      recordDenial: input.recordDenial,
      emit: input.emit,
      narrate: input.narrate,
    });
    iterationOutcomes.push(observation.outcome);
    if (observation.checkpointEvent) {
      checkpointEvents.push(observation.checkpointEvent);
    }
  }

  return {
    usedTools: input.toolCalls.length > 0,
    iterationOutcomes,
    checkpointEvents,
    state: input.state,
  };
}

function narrateToolIntent(
  input: Pick<ToolBatchExecutionInput, "narrate">,
  toolCall: FunctionCallField,
): void {
  const narrationArgs = safeParseArgs(toolCall.arguments);

  if (toolCall.name === "edit" || toolCall.name === "write") {
    input.narrate(
      "edit_intent",
      `Preparing a scoped ${toolCall.name} change before running verification.`,
    );
    return;
  }

  if (toolCall.name !== "bash" || typeof narrationArgs.command !== "string") {
    return;
  }

  const command = narrationArgs.command.toLowerCase();
  if (isVerificationCommand(command)) {
    input.narrate("verification", "Running a project verification command.", [
      toolCall.call_id,
    ]);
  }
}
