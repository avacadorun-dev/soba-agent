import type { ResponseResource, Usage } from "../../kernel/model/openresponses-types";
import type { BudgetTracker } from "../budget/budget-tracker";
import type { ContextController } from "../context/context-controller";
import { createTurnError } from "./turn-helpers";
import type { AgentEvent, AgentTurnError, TurnStopReasonEvent } from "./types";

export interface ResponseStatusDecision {
  action: "continue" | "break";
  shouldContinue: boolean;
}

export function handleResponseStatus(input: {
  response: ResponseResource;
  errors: AgentTurnError[];
  iteration: number;
  emit: (event: AgentEvent) => void;
  emitStopReason: (
    reason: TurnStopReasonEvent["reason"],
    detail: string,
  ) => void;
  narrateBlocked: (message: string) => void;
}): ResponseStatusDecision {
  if (input.response.status === "failed") {
    const errorMsg = input.response.error?.message ?? "Unknown error";
    input.narrateBlocked(errorMsg);
    input.errors.push(createTurnError("api_error", errorMsg, input.iteration));
    input.emit({
      type: "turn_error",
      timestamp: Date.now(),
      error: errorMsg,
      status: "failed",
    });
    input.emitStopReason("api-error", errorMsg);
    return { action: "break", shouldContinue: false };
  }

  const shouldContinue =
    input.response.status === "incomplete" &&
    input.response.incomplete_details?.reason === "max_output_tokens";

  if (input.response.status === "incomplete" && !shouldContinue) {
    const reason = input.response.incomplete_details?.reason ?? "unknown";
    const message = `Response incomplete: ${reason}`;
    input.errors.push(createTurnError("api_error", message, input.iteration));
    input.narrateBlocked(message);
    input.emit({
      type: "turn_error",
      timestamp: Date.now(),
      error: message,
      status: "incomplete",
    });
  }

  return { action: "continue", shouldContinue };
}

export function recordResponseUsage(input: {
  response: ResponseResource;
  totalUsage: Usage;
  budgetTracker: BudgetTracker;
  contextController: ContextController;
  tokenBudget: number;
  contextWindow: number;
  systemPromptTokens: number;
  toolSchemaTokens: number;
  turn: number;
  emit: (event: AgentEvent) => void;
}): void {
  const usage = input.response.usage;
  if (!usage) return;

  input.totalUsage.input_tokens += usage.input_tokens;
  input.totalUsage.output_tokens += usage.output_tokens;
  input.totalUsage.total_tokens += usage.total_tokens;
  input.budgetTracker.addUsage(usage.input_tokens, usage.output_tokens);

  const percentage =
    input.tokenBudget > 0
      ? Math.round((input.totalUsage.total_tokens / input.tokenBudget) * 100)
      : 0;
  const effectiveContextTokens = input.contextController.getEffectiveContextTokens({
    systemPromptTokens: input.systemPromptTokens,
    toolSchemaTokens: input.toolSchemaTokens,
    requestFingerprint: `turn_${input.turn}_ctx`,
  });

  input.emit({
    type: "budget_update",
    timestamp: Date.now(),
    usedTokens: input.totalUsage.total_tokens,
    totalBudget: input.tokenBudget,
    contextWindow: input.contextWindow,
    percentage,
    effectiveContextTokens,
  });
}
