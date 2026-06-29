import type { ItemParam } from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { ToolContext } from "../../kernel/tools/types";
import type { DebugEntry } from "../../kernel/transcript/types";
import type { EvidenceLedger } from "../evidence/evidence-ledger";
import type { VerificationController } from "../verification/verification-controller";
import type { TaskKind } from "../verification/verification-policy";
import type { AgentLoopRuntimeServices } from "./agent-loop-runtime";
import { runAutoVerificationOpportunity } from "./auto-verification-opportunity";
import { autoVerifierTimeoutSeconds, wantsFullVerification } from "./turn-helpers";
import type { AgentEvent, AgentTurnError } from "./types";

export interface AgentTurnVerificationStage {
  run(input: {
    opportunity: string;
    iteration: number;
  }): Promise<AgentTurnVerificationStageResult>;
}

export interface AgentTurnVerificationStageResult {
  didExecute: boolean;
  usedTools: boolean;
  needsVerification: boolean;
  hasMutatedFiles: boolean;
}

export function createAgentTurnVerificationStage(input: {
  cwd: string;
  taskText: string;
  taskKind: TaskKind;
  turnIndex: number;
  runtime: AgentLoopRuntimeServices;
  verificationController: VerificationController;
  evidenceLedger: EvidenceLedger;
  session: SessionPort;
  allItems: ItemParam[];
  errors: AgentTurnError[];
  successfulToolCallIds: Set<string>;
  verificationEvidenceCallIds: Set<string>;
  signal: AbortSignal;
  projectInstructions: string[];
  createToolContext(): ToolContext;
  emit(event: AgentEvent): void;
  debug(data: DebugEntry["data"]): void;
  narrate(message: string, evidenceIds?: string[]): void;
}): AgentTurnVerificationStage {
  const includeFullGate = wantsFullVerification(input.taskText) || input.taskKind === "release_task";

  return {
    async run({ opportunity, iteration }) {
      const autoVerification = await runAutoVerificationOpportunity({
        opportunity,
        cwd: input.cwd,
        turn: input.turnIndex,
        iteration,
        taskKind: input.taskKind,
        ledger: input.evidenceLedger,
        verificationController: input.verificationController,
        tools: input.runtime.tools,
        createToolContext: input.createToolContext,
        trustManager: input.runtime.trustManager,
        projectInstructions: input.projectInstructions,
        projectFiles: input.runtime.projectCommandFiles,
        includeFullGate,
        includeReleaseGate: input.taskKind === "release_task",
        timeoutSeconds: autoVerifierTimeoutSeconds(input.runtime.options.bashMaxTimeoutSeconds),
        signal: input.signal,
        session: input.session,
        allItems: input.allItems,
        errors: input.errors,
        successfulToolCallIds: input.successfulToolCallIds,
        verificationEvidenceCallIds: input.verificationEvidenceCallIds,
        emit: input.emit,
        debug: input.debug,
        narrate: input.narrate,
      });

      return {
        didExecute: autoVerification.didExecute,
        usedTools: autoVerification.didExecute,
        needsVerification: autoVerification.needsVerification,
        hasMutatedFiles: autoVerification.hasMutatedFiles,
      };
    },
  };
}
