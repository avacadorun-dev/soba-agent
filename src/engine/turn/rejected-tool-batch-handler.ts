import type { FunctionCallField, ItemParam } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import { createToolErrorResult } from "../../kernel/tools/errors";
import { toolResultToOutputItem } from "../../kernel/tools/types";
import type { ItemParam as SessionItemParam } from "../../kernel/transcript/types";
import { recordToolOutcome } from "../completion/completion-gate";
import type { EvidenceLedger } from "../evidence/evidence-ledger";
import type { ToolBatchGuardDecision } from "../tool-calls/tool-batch-guard";
import type { LoopGuard, ToolOutcome } from "./loop-guard";
import type { WorkingNarrationEventType } from "./narration";
import {
  createTurnError,
  createUserItem,
  extractToolResultText,
  safeParseArgs,
} from "./turn-helpers";
import type { AgentEvent, AgentTurnError, TurnStopReasonEvent } from "./types";

export type RejectedToolBatchDecision = Extract<ToolBatchGuardDecision, { action: "reject" }>;

export type RejectedToolBatchResult =
  | { action: "continue"; usedTools: boolean }
  | { action: "break"; usedTools: boolean };

export interface RejectedToolBatchHandlerInput {
  batchDecision: RejectedToolBatchDecision;
  toolCalls: FunctionCallField[];
  session: SessionPort;
  allItems: ItemParam[];
  errors: AgentTurnError[];
  successfulToolCallIds: Set<string>;
  evidenceLedger: EvidenceLedger;
  loopGuard: LoopGuard;
  iteration: number;
  emit: (event: AgentEvent) => void;
  emitToolResultAndEnd: (toolCall: FunctionCallField, result: ReturnType<typeof createToolErrorResult>, startedAt: number) => void;
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

export function handleRejectedToolBatch(
  input: RejectedToolBatchHandlerInput,
): RejectedToolBatchResult {
  input.narrate("recovery", input.batchDecision.message);
  const iterationOutcomes: ToolOutcome[] = [];
  let usedTools = false;

  for (const toolCall of input.toolCalls) {
    usedTools = true;
    const result = createToolErrorResult({
      code: input.batchDecision.code,
      category: "validation",
      message: input.batchDecision.message,
      nextAction: "Run only the mutation now; after observing that result, call the verification tool separately.",
      fingerprint: `validation:${input.batchDecision.code}`,
    });
    input.emit({
      type: "tool_call_start",
      timestamp: Date.now(),
      toolCallId: toolCall.call_id,
      toolName: toolCall.name,
      args: safeParseArgs(toolCall.arguments),
    });
    input.emitToolResultAndEnd(toolCall, result, Date.now());
    recordToolOutcome(
      input.errors,
      input.successfulToolCallIds,
      toolCall,
      true,
      extractToolResultText(result),
      input.iteration,
    );
    input.evidenceLedger.recordToolOutcome({
      toolCallId: toolCall.call_id,
      toolName: toolCall.name,
      arguments: toolCall.arguments,
      isError: true,
      output: extractToolResultText(result),
      iteration: input.iteration,
    });
    const outputItem = toolResultToOutputItem(result, toolCall.call_id, toolCall.name);
    input.session.appendItem(outputItem);
    input.allItems.push(outputItem);
    iterationOutcomes.push({
      toolName: toolCall.name,
      arguments: toolCall.arguments,
      result: extractToolResultText(result),
      isError: true,
      error: result.error,
    });
  }

  const progressDecision = input.loopGuard.observeToolIteration(iterationOutcomes);
  if (progressDecision.action === "recover") {
    input.narrate("recovery", progressDecision.message);
    input.emit({
      type: "loop_guard",
      timestamp: Date.now(),
      action: "recover",
      iteration: input.iteration,
      message: progressDecision.message,
    });
    const recoveryItem = createUserItem(progressDecision.message);
    input.session.appendItem(recoveryItem as unknown as SessionItemParam);
    input.allItems.push(recoveryItem as unknown as ItemParam);
    return { action: "continue", usedTools };
  }

  if (progressDecision.action === "stop") {
    input.narrate("blocked", progressDecision.message);
    input.errors.push(createTurnError("timeout", progressDecision.message, input.iteration));
    input.emit({
      type: "turn_error",
      timestamp: Date.now(),
      error: progressDecision.message,
    });
    input.emitStopReason("loop-guard", progressDecision.message);
    return { action: "break", usedTools };
  }

  return { action: "continue", usedTools };
}
