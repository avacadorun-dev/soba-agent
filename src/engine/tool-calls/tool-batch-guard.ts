import type { FunctionCallField } from "../../kernel/model/openresponses-types";
import { hasToolEffect, resolveToolSemantics, type ToolSemantics } from "../../kernel/tools/semantics";
import { isVerificationCommand } from "../evidence/evidence-ledger";

export type ToolBatchGuardDecision =
  | { action: "allow" }
  | { action: "reject"; code: string; message: string };

export function evaluateToolBatch(
  toolCalls: FunctionCallField[],
  semanticsFor: (toolName: string) => ToolSemantics = (toolName) => resolveToolSemantics(toolName),
): ToolBatchGuardDecision {
  if (toolCalls.length <= 1) return { action: "allow" };

  const mutationCalls = toolCalls.filter((toolCall) => hasToolEffect(semanticsFor(toolCall.name), "mutation"));
  if (mutationCalls.length === 0) return { action: "allow" };

  const verificationCalls = toolCalls.filter((toolCall) => {
    if (toolCall.name !== "bash") return false;
    const command = readCommandArgument(toolCall.arguments);
    return command ? isVerificationCommand(command) : false;
  });

  if (verificationCalls.length === 0) return { action: "allow" };

  return {
    action: "reject",
    code: "mutating_batch_requires_observation",
    message:
      "Tool batch rejected: edit/write and dependent verification cannot run in the same unobserved response. " +
      "Next allowed step: perform the mutation only, observe the tool result, then run verification in a later response.",
  };
}

export function isMutationToolName(toolName: string): boolean {
  return hasToolEffect(resolveToolSemantics(toolName), "mutation");
}

function readCommandArgument(argumentsJson: string): string {
  try {
    const parsed = JSON.parse(argumentsJson) as Record<string, unknown>;
    if (typeof parsed.command === "string") return parsed.command;
    return typeof parsed.input === "string" ? parsed.input : "";
  } catch {
    return "";
  }
}
