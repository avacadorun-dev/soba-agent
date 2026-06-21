import { parseVerificationDiagnostics } from "./diagnostics";
import type { FixUntilGreenDecision, FixUntilGreenOptions, VerificationFailureInput } from "./types";

const DEFAULT_MAX_ITERATIONS = 3;

export class FixUntilGreenController {
  private readonly maxIterations: number;
  private iteration = 0;
  private lastDiagnosticFingerprint: string | null = null;
  private lastFailureProgressVersion = 0;
  private progressVersion = 0;
  private finalStatus: FixUntilGreenDecision["status"] | null = null;

  constructor(options: FixUntilGreenOptions = {}) {
    this.maxIterations = Math.max(1, Math.floor(options.maxIterations ?? DEFAULT_MAX_ITERATIONS));
  }

  recordProgress(_evidenceId: string): void {
    this.progressVersion++;
  }

  recordVerificationPassed(command: string): FixUntilGreenDecision {
    this.finalStatus = "passed";
    return {
      action: "passed",
      status: "passed",
      iteration: this.iteration,
      message: `Verification passed: ${command}`,
    };
  }

  recordVerificationFailure(input: VerificationFailureInput): FixUntilGreenDecision {
    const diagnostic = parseVerificationDiagnostics(input.command, input.output);

    if (isUnsafeRecoveryAction(input.proposedRecoveryCommand)) {
      this.finalStatus = "unsafe";
      return {
        action: "stop",
        status: "unsafe",
        iteration: this.iteration,
        diagnostic,
        message: `Unsafe recovery action requires user confirmation: ${input.proposedRecoveryCommand}`,
      };
    }

    const repeatedWithoutProgress =
      diagnostic.fingerprint === this.lastDiagnosticFingerprint &&
      this.progressVersion === this.lastFailureProgressVersion;
    if (repeatedWithoutProgress) {
      this.finalStatus = "blocked";
      return {
        action: "stop",
        status: "blocked",
        iteration: this.iteration,
        diagnostic,
        message: `Repeated diagnostic without progress: ${diagnostic.summary}`,
      };
    }

    this.iteration++;
    this.lastDiagnosticFingerprint = diagnostic.fingerprint;
    this.lastFailureProgressVersion = this.progressVersion;

    if (this.iteration > this.maxIterations) {
      this.finalStatus = "max_iterations";
      return {
        action: "stop",
        status: "max_iterations",
        iteration: this.iteration,
        diagnostic,
        message: `Fix-Until-Green stopped after ${this.maxIterations} recovery iterations without a passing verification.`,
      };
    }

    this.finalStatus = "recovering";
    return {
      action: "recover",
      status: "recovering",
      iteration: this.iteration,
      diagnostic,
      message:
        `Verification failed (${diagnostic.tool}): ${diagnostic.summary}\n` +
        "Patch the root cause, then rerun the same targeted verification command. Do not claim completion until it passes.",
    };
  }

  getStatus(): FixUntilGreenDecision["status"] | null {
    return this.finalStatus;
  }
}

export function isUnsafeRecoveryAction(command: string | undefined): boolean {
  if (!command) return false;
  return /\b(?:rm|rmdir|unlink|sudo|curl|wget|ssh|scp|chmod\s+777|git\s+reset|git\s+push)\b/i.test(command);
}
