import type { ItemParam } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { ToolRegistry } from "../../kernel/tools/tool-registry";
import { type ToolContext, toolResultToOutputItem } from "../../kernel/tools/types";
import type { DebugEntry } from "../../kernel/transcript/types";
import { recordToolOutcome } from "../completion/completion-gate";
import type { EvidenceLedger } from "../evidence/evidence-ledger";
import type { TrustController } from "../permissions/trust-controller";
import type { ProjectCommandFileReader } from "../verification/types";
import type { VerificationController } from "../verification/verification-controller";
import type { TaskKind } from "../verification/verification-policy";
import {
  autoVerifierCallToSessionItem,
  extractToolResultText,
} from "./turn-helpers";
import type { AgentEvent, AgentTurnError } from "./types";

export interface AutoVerificationOpportunityInput {
  opportunity: string;
  cwd: string;
  turn: number;
  iteration: number;
  taskKind: TaskKind;
  ledger: EvidenceLedger;
  verificationController: VerificationController;
  tools: ToolRegistry;
  createToolContext: () => ToolContext;
  trustManager: TrustController;
  projectFiles?: ProjectCommandFileReader;
  projectInstructions: string[];
  includeFullGate: boolean;
  includeReleaseGate: boolean;
  timeoutSeconds: number;
  signal?: AbortSignal;
  session: SessionPort;
  allItems: ItemParam[];
  errors: AgentTurnError[];
  successfulToolCallIds: Set<string>;
  verificationEvidenceCallIds: Set<string>;
  emit: (event: AgentEvent) => void;
  debug: (data: DebugEntry["data"]) => void;
  narrate: (message: string, evidenceIds?: string[]) => void;
}

export interface AutoVerificationOpportunityResult {
  didExecute: boolean;
  needsVerification: boolean;
  hasMutatedFiles: boolean;
}

export async function runAutoVerificationOpportunity(
  input: AutoVerificationOpportunityInput,
): Promise<AutoVerificationOpportunityResult> {
  const summaryBefore = input.ledger.getSummary();
  if (!summaryBefore.needsVerification) {
    return {
      didExecute: false,
      needsVerification: summaryBefore.needsVerification,
      hasMutatedFiles: summaryBefore.hasMutatedFiles,
    };
  }

  const bashTool = input.tools.get("bash");
  const autoVerification = await input.verificationController.runAutoVerification({
    cwd: input.cwd,
    taskKind: input.taskKind,
    evidenceSummary: summaryBefore,
    ledger: input.ledger,
    bashTool,
    toolContext: input.createToolContext(),
    trustManager: input.trustManager,
    projectFiles: input.projectFiles,
    projectInstructions: input.projectInstructions,
    includeFullGate: input.includeFullGate,
    includeReleaseGate: input.includeReleaseGate,
    timeoutSeconds: input.timeoutSeconds,
    iteration: input.iteration,
    signal: input.signal,
    onToolCallStart: (call) => {
      const fcItem = autoVerifierCallToSessionItem(call);
      input.session.appendItem(fcItem);
      input.allItems.push(fcItem as unknown as ItemParam);
      input.emit({
        type: "tool_call_start",
        timestamp: Date.now(),
        toolCallId: call.callId,
        toolName: call.toolName,
        args: call.args,
      });
    },
    onToolCallResult: (call, toolResult, durationMs) => {
      input.emit({
        type: "tool_call_result",
        timestamp: Date.now(),
        toolCallId: call.callId,
        toolName: call.toolName,
        result: toolResult,
      });
      input.emit({
        type: "tool_call_end",
        timestamp: Date.now(),
        toolCallId: call.callId,
        toolName: call.toolName,
        durationMs,
      });
      recordToolOutcome(
        input.errors,
        input.successfulToolCallIds,
        { call_id: call.callId, name: call.toolName, arguments: call.arguments },
        toolResult.isError,
        extractToolResultText(toolResult),
        input.iteration,
      );
      const outputItem = toolResultToOutputItem(toolResult, call.callId, call.toolName);
      input.session.appendItem(outputItem);
      input.allItems.push(outputItem);
    },
  });
  const { result } = autoVerification;

  if (autoVerification.activityCount > 0) {
    input.debug({
      event: "loop/iteration",
      turn: input.turn,
      iteration: input.iteration,
      detail: `auto-verifier ${input.opportunity}: ${result.executions.length} executed, ${result.skipped.length} skipped`,
    });
  }

  const summaryAfter = input.ledger.getSummary();
  if (!autoVerification.didExecute) {
    return {
      didExecute: false,
      needsVerification: summaryAfter.needsVerification,
      hasMutatedFiles: summaryAfter.hasMutatedFiles,
    };
  }

  for (const execution of result.executions) {
    if (!execution.result.isError) input.verificationEvidenceCallIds.add(execution.call.callId);
  }
  input.narrate(
    `Auto-verifier ran ${result.executions.length} project verification command(s).`,
    result.executions.map((execution) => execution.call.callId),
  );

  return {
    didExecute: true,
    needsVerification: summaryAfter.needsVerification,
    hasMutatedFiles: summaryAfter.hasMutatedFiles,
  };
}
