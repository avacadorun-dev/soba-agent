import type { FunctionCallField, ItemParam } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import { type CheckpointEvent, extractCheckpointEvent } from "../../kernel/tools/checkpoint";
import { hasToolEffect } from "../../kernel/tools/semantics";
import { toolResultToOutputItem } from "../../kernel/tools/types";
import { recordToolOutcome } from "../completion/completion-gate";
import type { EvidenceLedger } from "../evidence/evidence-ledger";
import { isVerificationCommand } from "../evidence/evidence-ledger";
import type { ProjectMemorySource } from "../memory/memory-injector";
import {
  addRecoveryReflectionFix,
  createRecoveryReflectionDraft,
  type RecoveryReflectionDraft,
  writeRecoveryReflectionLesson,
} from "../memory/reflection-memory-policy";
import type { ToolExecutionResult } from "../tool-calls/tool-call-executor";
import type { VerificationController } from "../verification/verification-controller";
import type { ToolOutcome } from "./loop-guard";
import type { WorkingNarrationEventType } from "./narration";
import type { SkillSource } from "./skill-source";
import {
  extractCommandArgument,
  extractToolResultText,
  summarizeMutationToolCall,
  toCheckpointArgs,
} from "./turn-helpers";
import type { AgentEvent, AgentTurnError } from "./types";

export interface ToolExecutionObservationState {
  needsVerification: boolean;
  hasMutatedFiles: boolean;
  mutationSucceededInCurrentBatch: boolean;
  recoveryReflectionDraft: RecoveryReflectionDraft | null;
  fixUntilGreenFollowUp: string | null;
  fixUntilGreenStop: string | null;
}

export interface ToolExecutionObservationInput {
  toolCall: FunctionCallField;
  execution: ToolExecutionResult;
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

export interface ToolExecutionObservationResult {
  outcome: ToolOutcome;
  checkpointEvent?: CheckpointEvent;
}

export function observeToolExecutionResult(
  input: ToolExecutionObservationInput,
): ToolExecutionObservationResult {
  const { toolCall, execution } = input;
  const { result } = execution;

  if (execution.denied) {
    input.recordDenial(execution.denied.description);
    recordToolOutcome(
      input.errors,
      input.successfulToolCallIds,
      toolCall,
      true,
      extractToolResultText(result),
      input.iteration,
      "security_denial",
    );
    input.evidenceLedger.recordToolOutcome({
      toolCallId: toolCall.call_id,
      toolName: toolCall.name,
      arguments: toolCall.arguments,
      isError: true,
      output: extractToolResultText(result),
      iteration: input.iteration,
      durationMs: execution.durationMs,
      cwd: execution.cwd,
      details: result.details,
      semantics: execution.semantics,
    });
    appendToolOutput(input);
    return { outcome: toolOutcome(toolCall, result) };
  }

  recordToolOutcome(
    input.errors,
    input.successfulToolCallIds,
    toolCall,
    result.isError,
    extractToolResultText(result),
    input.iteration,
  );
  input.evidenceLedger.recordToolOutcome({
    toolCallId: toolCall.call_id,
    toolName: toolCall.name,
    arguments: toolCall.arguments,
    isError: result.isError,
    output: extractToolResultText(result),
    iteration: input.iteration,
    durationMs: execution.durationMs,
    cwd: execution.cwd,
    details: result.details,
    semantics: execution.semantics,
  });

  const checkpointEvent = observeCheckpoint(input);
  observeSkillLifecycle(input);
  observeMutationAndVerificationEvidence(input);
  observeVerificationResult(input);
  appendToolOutput(input);

  return {
    outcome: toolOutcome(toolCall, result),
    checkpointEvent,
  };
}

function observeCheckpoint(
  input: ToolExecutionObservationInput,
): CheckpointEvent | undefined {
  const { toolCall, execution } = input;
  if (execution.result.isError || toolCall.name !== "checkpoint") return undefined;

  const checkpointArgs = toCheckpointArgs(execution.parsedArgs);
  if (!checkpointArgs) return undefined;

  const checkpointEvent = extractCheckpointEvent(checkpointArgs);
  input.evidenceLedger.recordCheckpoint({
    kind: checkpointEvent.kind,
    reason: checkpointEvent.reason,
    nextDirection: checkpointEvent.nextDirection,
    completed: checkpointEvent.completed,
    pending: checkpointEvent.pending,
    toolCallId: toolCall.call_id,
    iteration: input.iteration,
  });
  return checkpointEvent;
}

function observeSkillLifecycle(input: ToolExecutionObservationInput): void {
  const { toolCall, execution } = input;
  if (
    execution.result.isError ||
    (toolCall.name !== "activate_skill" && toolCall.name !== "deactivate_skill")
  ) return;

  let skillName: string | null = null;
  try {
    const parsed = JSON.parse(toolCall.arguments) as Record<string, unknown>;
    skillName = typeof parsed?.name === "string" ? parsed.name : null;
  } catch {
    return;
  }

  if (!skillName) return;
  if (toolCall.name === "deactivate_skill") {
    input.emit({
      type: "skill_deactivated",
      timestamp: Date.now(),
      skillName,
      reason: "deactivated by model",
    });
    return;
  }

  const skill = input.skillManager?.getSkill(skillName);
  if (!skill) return;

  input.emit({
    type: "skill_activated",
    timestamp: Date.now(),
    skillName: skill.name,
    skillRevision: skill.revision ?? "unknown",
    skillScope: skill.scope,
  });
}

function observeMutationAndVerificationEvidence(
  input: ToolExecutionObservationInput,
): void {
  const { toolCall, execution, state } = input;
  const { parsedArgs, result } = execution;
  const producedVerificationEvidence = !result.isError &&
    !state.mutationSucceededInCurrentBatch &&
    (hasToolEffect(execution.semantics, "inspect") ||
      (toolCall.name === "bash" &&
        isVerificationCommand(extractCommandArgument(parsedArgs))));

  if (!result.isError && hasToolEffect(execution.semantics, "mutation")) {
    state.hasMutatedFiles = true;
    state.needsVerification = true;
    state.mutationSucceededInCurrentBatch = true;
    input.verificationEvidenceCallIds.clear();
    input.verificationController.recordMutationProgress(toolCall.call_id);
    if (state.recoveryReflectionDraft) {
      state.recoveryReflectionDraft = addRecoveryReflectionFix(
        state.recoveryReflectionDraft,
        summarizeMutationToolCall(toolCall.name, parsedArgs),
      );
    }
    return;
  }

  if (state.needsVerification && producedVerificationEvidence) {
    state.needsVerification = false;
    recordVerificationEvidence(input);
    return;
  }

  if (state.hasMutatedFiles && producedVerificationEvidence) {
    recordVerificationEvidence(input);
  }
}

function observeVerificationResult(input: ToolExecutionObservationInput): void {
  const { toolCall, execution, state } = input;
  if (toolCall.name !== "bash") return;

  const command = extractCommandArgument(execution.parsedArgs);
  const verificationOutcome = input.verificationController.observeVerificationToolResult({
    toolName: toolCall.name,
    command,
    isError: execution.result.isError,
    output: extractToolResultText(execution.result),
    ledger: input.evidenceLedger,
  });
  if (verificationOutcome.kind === "recover") {
    state.recoveryReflectionDraft = createRecoveryReflectionDraft(
      verificationOutcome.decision.diagnostic,
    );
    state.fixUntilGreenFollowUp = verificationOutcome.message;
    return;
  }
  if (verificationOutcome.kind === "stop") {
    state.recoveryReflectionDraft = null;
    state.fixUntilGreenStop = verificationOutcome.message;
    return;
  }
  if (verificationOutcome.kind !== "passed" || !state.recoveryReflectionDraft) {
    return;
  }
  if (input.skillManager?.getMemoryAccess?.().write === false) {
    state.recoveryReflectionDraft = null;
    return;
  }

  const reflectionResult = writeRecoveryReflectionLesson(input.projectMemory, {
    task: input.taskText,
    sessionId: input.session.getSessionId(),
    draft: state.recoveryReflectionDraft,
    verification: verificationOutcome.decision.message,
    observableSuccess: true,
  });
  if (reflectionResult.status === "written") {
    input.evidenceLedger.recordReflection(
      `Stored recovery lesson: ${reflectionResult.capsule.summary}`,
    );
  } else if (reflectionResult.reason !== "no_memory") {
    input.evidenceLedger.recordReflection(
      `Skipped recovery lesson: ${reflectionResult.reason}`,
    );
  }
  state.recoveryReflectionDraft = null;
}

function recordVerificationEvidence(input: ToolExecutionObservationInput): void {
  input.verificationEvidenceCallIds.add(input.toolCall.call_id);
  input.narrate(
    "verification",
    `Recorded ${input.toolCall.name} as accepted verification evidence after mutation.`,
    [input.toolCall.call_id],
  );
}

function appendToolOutput(input: ToolExecutionObservationInput): void {
  const outputItem = toolResultToOutputItem(
    input.execution.result,
    input.toolCall.call_id,
    input.toolCall.name,
  );
  input.session.appendItem(outputItem);
  input.allItems.push(outputItem);
}

function toolOutcome(
  toolCall: FunctionCallField,
  result: ToolExecutionResult["result"],
): ToolOutcome {
  return {
    toolName: toolCall.name,
    arguments: toolCall.arguments,
    result: extractToolResultText(result),
    isError: result.isError,
    error: result.error,
  };
}
