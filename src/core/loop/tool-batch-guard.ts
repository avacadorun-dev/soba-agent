import type { FunctionCallField } from "../client/types";
import { isVerificationCommand } from "./evidence-ledger";

export type ToolBatchGuardDecision =
  | { action: "allow" }
  | { action: "reject"; code: string; message: string };

const MUTATION_TOOLS = new Set(["edit", "write"]);

export function evaluateToolBatch(toolCalls: FunctionCallField[]): ToolBatchGuardDecision {
  if (toolCalls.length <= 1) return { action: "allow" };

  const mutationCalls = toolCalls.filter((toolCall) => MUTATION_TOOLS.has(toolCall.name));
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
  return MUTATION_TOOLS.has(toolName);
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
