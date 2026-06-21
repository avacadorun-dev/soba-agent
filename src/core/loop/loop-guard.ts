import type { ToolErrorInfo } from "../tools/types";

export interface LoopGuardOptions {
  maxAgentIterations: number;
  maxStalledIterations: number;
  maxStallRecoveryAttempts: number;
  maxRunDurationMs: number;
}

export interface ToolOutcome {
  toolName: string;
  arguments: string;
  result: string;
  isError: boolean;
  error?: ToolErrorInfo;
}

export type LoopGuardDecision =
  | { action: "continue" }
  | { action: "recover"; message: string }
  | { action: "stop"; message: string };

export class LoopGuard {
  private readonly startedAt = Date.now();
  private readonly options: LoopGuardOptions;
  private previousFingerprint: string | null = null;
  private stalledIterations = 0;
  private failedIterations = 0;
  private recoveryAttempts = 0;
  private progressIterations = 0;

  constructor(options: LoopGuardOptions) {
    this.options = options;
  }

  checkLimits(iteration: number, now = Date.now()): LoopGuardDecision {
    if (this.options.maxAgentIterations > 0 && iteration >= this.options.maxAgentIterations) {
      return {
        action: "stop",
        message: `Reached emergency agent limit (${this.options.maxAgentIterations} model invocations)`,
      };
    }

    if (this.options.maxRunDurationMs > 0 && now - this.startedAt >= this.options.maxRunDurationMs) {
      return {
        action: "stop",
        message: `Reached agent run time limit (${Math.round(this.options.maxRunDurationMs / 60000)} minutes)`,
      };
    }

    return { action: "continue" };
  }

  observeToolIteration(outcomes: ToolOutcome[]): LoopGuardDecision {
    if (outcomes.length === 0 || this.options.maxStalledIterations <= 0) {
      return { action: "continue" };
    }

    const fingerprint = createToolOutcomeFingerprint(outcomes);
    const allFailed = outcomes.every((outcome) => outcome.isError);
    const repeatedFingerprint = fingerprint === this.previousFingerprint;
    if (fingerprint === this.previousFingerprint) {
      this.stalledIterations++;
      this.progressIterations = 0;
    } else {
      this.previousFingerprint = fingerprint;
      this.stalledIterations = 0;
      this.progressIterations = allFailed ? 0 : this.progressIterations + 1;
    }
    this.failedIterations = allFailed ? this.failedIterations + 1 : 0;
    if (this.progressIterations > this.options.maxStalledIterations) {
      this.recoveryAttempts = 0;
    }

    if (isMalformedToolCallValidation(outcomes)) {
      const repeatedFailureAdvice = formatRepeatedFailureAdvice(outcomes);
      return this.recoverOrStop(
        "The previous tool call had invalid arguments before execution. This is a tool-call formatting error, not project state. " +
          "Stop, inspect the required tool schema, and call the same intended tool again with every required argument populated." +
          repeatedFailureAdvice,
      );
    }

    if (repeatedFingerprint && isRepeatedNonRetryableValidation(outcomes)) {
      const repeatedFailureAdvice = formatRepeatedFailureAdvice(outcomes);
      return this.recoverOrStop(
        "You repeated the same invalid non-retryable tool call. Stop retrying it unchanged. " +
          "Inspect the required tool schema, provide all required arguments, or switch to a different implementation approach." +
          repeatedFailureAdvice,
      );
    }

    if (
      this.stalledIterations < this.options.maxStalledIterations &&
      this.failedIterations <= this.options.maxStalledIterations
    ) {
      return { action: "continue" };
    }

    this.stalledIterations = 0;
    this.failedIterations = 0;
    this.progressIterations = 0;
    this.previousFingerprint = null;

    if (this.recoveryAttempts < this.options.maxStallRecoveryAttempts) {
      this.recoveryAttempts++;
      const repeatedFailureAdvice = formatRepeatedFailureAdvice(outcomes);
      return {
        action: "recover",
        message:
          `You made no progress for ${this.options.maxStalledIterations + 1} tool iterations by repeating actions or only producing errors. ` +
          "You are stuck. Reassess the task, inspect different evidence, and change strategy. Do not repeat the same calls again." +
          repeatedFailureAdvice,
      };
    }

    return {
      action: "stop",
      message:
        `Agent remained stuck after ${this.options.maxStallRecoveryAttempts} recovery attempts ` +
        `(${this.options.maxStalledIterations + 1} no-progress tool iterations each)`,
    };
  }

  private recoverOrStop(message: string): LoopGuardDecision {
    this.stalledIterations = 0;
    this.failedIterations = 0;
    this.progressIterations = 0;
    this.previousFingerprint = null;

    if (this.recoveryAttempts < this.options.maxStallRecoveryAttempts) {
      this.recoveryAttempts++;
      return { action: "recover", message };
    }

    return {
      action: "stop",
      message:
        `Agent remained stuck after ${this.options.maxStallRecoveryAttempts} recovery attempts. ` +
        `Last recovery instruction: ${message}`,
    };
  }
}

export function createToolOutcomeFingerprint(outcomes: ToolOutcome[]): string {
  return JSON.stringify(
    outcomes.map((outcome) => ({
      toolName: outcome.toolName,
      arguments: normalize(outcome.arguments),
      result: outcome.error ? undefined : normalize(outcome.result),
      isError: outcome.isError,
      error: outcome.error
        ? {
            code: outcome.error.code,
            category: outcome.error.category,
            fingerprint: outcome.error.fingerprint,
          }
        : undefined,
    })),
  );
}

function normalize(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim().slice(0, 4000);
}

function formatRepeatedFailureAdvice(outcomes: ToolOutcome[]): string {
  const errors = outcomes
    .map((outcome) => outcome.error)
    .filter((error): error is ToolErrorInfo => error !== undefined);
  if (errors.length === 0) return "";

  const unique = new Map<string, ToolErrorInfo>();
  for (const error of errors) {
    unique.set(error.fingerprint, error);
  }

  const advice = Array.from(unique.values())
    .slice(0, 3)
    .map((error) => `${error.code} (${error.category}): ${error.nextAction}`)
    .join(" ");

  return advice ? ` Repeated failure hint: ${advice}` : "";
}

function isRepeatedNonRetryableValidation(outcomes: ToolOutcome[]): boolean {
  return (
    outcomes.length > 0 &&
    outcomes.every(
      (outcome) =>
        outcome.isError &&
        outcome.error?.category === "validation" &&
        outcome.error.retryable === false,
    )
  );
}

function isMalformedToolCallValidation(outcomes: ToolOutcome[]): boolean {
  return (
    outcomes.length > 0 &&
    outcomes.every(
      (outcome) =>
        outcome.isError &&
        outcome.error?.category === "validation" &&
        outcome.error.retryable === false &&
        isMalformedToolCallError(outcome.error.code),
    )
  );
}

function isMalformedToolCallError(code: string): boolean {
  return code.endsWith("_invalid_arguments") || code === "invalid_arguments" || code === "tool_invalid_arguments" || code === "tool_not_registered";
}
