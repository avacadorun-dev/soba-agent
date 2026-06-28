import type { EvidenceLedger } from "../evidence/evidence-ledger";
import { isVerificationCommand } from "../evidence/evidence-ledger";
import { FixUntilGreenController, type FixUntilGreenDecision } from "../recovery";
import { type AutoVerifierOptions, type AutoVerifierResult, runAutoVerifier } from "./auto-verifier";

export interface AutoVerificationOutcome {
  result: AutoVerifierResult;
  activityCount: number;
  didExecute: boolean;
}

export type VerificationToolOutcome =
  | { kind: "none" }
  | { kind: "passed"; decision: Extract<FixUntilGreenDecision, { action: "passed" }> }
  | { kind: "recover"; decision: Extract<FixUntilGreenDecision, { action: "recover" }>; message: string }
  | { kind: "stop"; decision: Extract<FixUntilGreenDecision, { action: "stop" }>; message: string };

export class VerificationController {
  private readonly attemptedFingerprints = new Set<string>();
  private readonly fixUntilGreen: FixUntilGreenController;

  constructor(options: { fixUntilGreen?: FixUntilGreenController } = {}) {
    this.fixUntilGreen = options.fixUntilGreen ?? new FixUntilGreenController();
  }

  async runAutoVerification(
    options: Omit<AutoVerifierOptions, "attemptedFingerprints">,
  ): Promise<AutoVerificationOutcome> {
    const result = await runAutoVerifier({
      ...options,
      attemptedFingerprints: this.attemptedFingerprints,
    });

    return {
      result,
      activityCount: result.selected.length + result.skipped.length,
      didExecute: result.executions.length > 0,
    };
  }

  recordMutationProgress(evidenceId: string): void {
    this.fixUntilGreen.recordProgress(evidenceId);
  }

  observeVerificationToolResult(input: {
    toolName: string;
    command: string;
    isError: boolean;
    output: string;
    ledger: EvidenceLedger;
  }): VerificationToolOutcome {
    if (input.toolName !== "bash" || !isVerificationCommand(input.command)) {
      return { kind: "none" };
    }

    if (input.isError) {
      const decision = this.fixUntilGreen.recordVerificationFailure({
        command: input.command,
        output: input.output,
      });
      input.ledger.recordRecoveryIteration(decision);
      if (decision.action === "recover") {
        return { kind: "recover", decision, message: decision.message };
      }
      if (decision.action === "stop") {
        return { kind: "stop", decision, message: decision.message };
      }
      throw new Error("Unexpected passed decision after failed verification.");
    }

    const decision = this.fixUntilGreen.recordVerificationPassed(input.command);
    input.ledger.recordRecoveryIteration(decision);
    if (decision.action !== "passed") {
      throw new Error("Unexpected non-passed decision after successful verification.");
    }
    return { kind: "passed", decision };
  }
}
