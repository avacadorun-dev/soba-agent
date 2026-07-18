import type { ItemParam, ResponseResource, Usage } from "../../kernel/model/openresponses-types";
import type { ToolRegistry } from "../../kernel/tools/tool-registry";
import type { DebugEntry } from "../../kernel/transcript/types";
import type { ContextController } from "../context/context-controller";
import type { EvidenceLedgerSummary } from "../evidence/evidence-ledger";
import { createLoopErrorResponse } from "./turn-helpers";
import type {
  AgentEvent,
  AgentTurnError,
  AgentTurnResult,
  CheckpointWorkPlanState,
} from "./types";

export function completeAgentTurn(input: {
  currentResponse: ResponseResource | null;
  turnIndex: number;
  iteration: number;
  allItems: ItemParam[];
  totalUsage: Usage;
  errors: AgentTurnError[];
  hasUsedTools: boolean;
  needsVerification: boolean;
  autonomousFollowUps: number;
  evidenceSummary: EvidenceLedgerSummary;
  checkpointState: CheckpointWorkPlanState | undefined;
  systemPrompt: string;
  tools: ToolRegistry;
  contextController: ContextController;
  emit: (event: AgentEvent) => void;
  debug: (data: DebugEntry["data"]) => void;
}): AgentTurnResult {
  const finalResponse = input.currentResponse ?? createLoopErrorResponse();

  input.emit({
    type: "turn_end",
    timestamp: Date.now(),
    turnIndex: input.turnIndex,
    response: finalResponse,
    totalUsage: { ...input.totalUsage },
  });

  input.debug({
    event: "loop/turn-end",
    turn: input.turnIndex,
    iteration: input.iteration,
    responseId: input.currentResponse?.id,
    responseStatus: input.currentResponse?.status ?? "failed",
    hasUsedTools: input.hasUsedTools,
    needsVerification: input.needsVerification,
    autonomousFollowUps: input.autonomousFollowUps,
    errors: input.errors.length,
    activeErrors: input.errors.filter((error) => error.status === "active").length,
  });

  const turnCompleteSystemPromptTokens = Math.ceil(input.systemPrompt.length / 4);
  const turnCompleteToolSchemaTokens = Math.ceil(JSON.stringify(input.tools.getOpenAITools()).length / 4);
  input.contextController.scheduleTurnComplete({
    responseStatus: input.currentResponse?.status,
    errorCount: input.errors.length,
    metrics: {
      systemPromptTokens: turnCompleteSystemPromptTokens,
      toolSchemaTokens: turnCompleteToolSchemaTokens,
      requestFingerprint: `turn_${input.turnIndex}_complete`,
      turnIndex: input.turnIndex,
    },
  });

  return {
    items: input.allItems,
    response: finalResponse,
    usage: { ...input.totalUsage },
    errors: input.errors,
    activeErrors: input.errors.filter((error) => error.status === "active"),
    evidenceSummary: input.evidenceSummary,
    checkpointState: input.checkpointState,
  };
}
