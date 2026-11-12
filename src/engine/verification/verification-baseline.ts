/**
 * Verification failure baselines and classification.
 *
 * A baseline is recorded automatically on the first failing run of each
 * command in a session. A later failure is attributed relative to that
 * baseline, to the agent's change set, and to user/repo-policy declarations.
 * This module is pure: file hashing and output parsing happen in the tool
 * layer, classification happens here.
 */

export interface FailureFileSignal {
  path: string;
  sha256?: string;
}

export interface FailureSignal {
  command: string;
  exitCode: number | null;
  failingTestIds: string[];
  implicatedFiles: FailureFileSignal[];
}

export type BaselineMatch = "recorded_baseline" | "matches_baseline" | "differs_from_baseline";

export interface KnownFailureDeclaration {
  /** Who declared the exception. The agent can cite an existing one but can never create it. */
  declaredBy: "user" | "repo_policy";
  command?: string;
  failingTestIds?: string[];
  files?: string[];
  note?: string;
}

export type FailureStatus =
  | "agent_caused"
  | "new_failure"
  | "unrelated_pre_existing_failure"
  | "unverified_change"
  | "blocked_by_environment";

export interface FailureClassification {
  failureId: string;
  status: FailureStatus;
  /** Human-readable reason naming the baseline failure and its owning file when known. */
  reason: string;
  blocking: boolean;
}

function normalizeCommand(command: string): string {
  return command.replaceAll(/\s+/g, " ").trim();
}

export function failureSignature(signal: FailureSignal): string {
  const testIds = [...signal.failingTestIds].sort().join("|");
  const files = signal.implicatedFiles
    .map((file) => `${file.path}#${file.sha256 ?? "?"}`)
    .sort()
    .join("|");
  return `${normalizeCommand(signal.command)}#${signal.exitCode ?? "null"}#${testIds}#${files}`;
}

function pathsIntersect(signal: FailureSignal | undefined, changedFiles: readonly string[]): string[] {
  if (!signal) return [];
  const changed = new Set(changedFiles.map((file) => file.toLowerCase()));
  return signal.implicatedFiles
    .map((file) => file.path)
    .filter((path) => changed.has(path.toLowerCase()));
}

function matchesDeclaration(signal: FailureSignal, declaration: KnownFailureDeclaration): boolean {
  if (declaration.command && !normalizeCommand(signal.command).includes(normalizeCommand(declaration.command))) {
    return false;
  }
  if (declaration.failingTestIds && declaration.failingTestIds.length > 0) {
    const ids = new Set(signal.failingTestIds);
    if (!declaration.failingTestIds.some((id) => ids.has(id))) return false;
  }
  if (declaration.files && declaration.files.length > 0) {
    const files = new Set(signal.implicatedFiles.map((file) => file.path.toLowerCase()));
    if (!declaration.files.some((file) => files.has(file.toLowerCase()))) return false;
  }
  return true;
}

export interface FailureRecord {
  id: string;
  command?: string;
  failureSignal?: FailureSignal;
  baselineMatch?: BaselineMatch;
  timedOut?: boolean;
  summary?: string;
}

export interface ClassifyFailureInput {
  record: FailureRecord;
  /** All files the agent mutated in this session (verified or not). */
  agentChangedFiles: readonly string[];
  /** Explicit acceptance commands for the current task; their failures always block. */
  acceptanceCommands: readonly string[];
  /** Exceptions declared by the user or a repository policy file. */
  knownFailures: readonly KnownFailureDeclaration[];
}

/**
 * Classify one unresolved verification failure.
 * Fails closed: anything that is not provably pre-existing and untouched by
 * the agent's diff blocks completion.
 */
export function classifyFailure(input: ClassifyFailureInput): FailureClassification {
  const { record, agentChangedFiles, acceptanceCommands, knownFailures } = input;
  const signal = record.failureSignal;
  const command = record.command ?? signal?.command ?? "";

  const base = { failureId: record.id, status: "new_failure" as FailureStatus, blocking: true };

  if (record.timedOut || signal?.exitCode === null) {
    return {
      ...base,
      status: "blocked_by_environment",
      reason:
        `Verification ${command ? `"${command}" ` : ""}timed out or was terminated without an exit code; ` +
        "it cannot be recorded as passing evidence. Re-run it to completion or use status blocked with the concrete environment limitation.",
    };
  }

  const touched = pathsIntersect(signal, agentChangedFiles);
  if (touched.length > 0) {
    return {
      ...base,
      status: "agent_caused",
      reason:
        `Failure ${command ? `of "${command}" ` : ""}implicates files changed in this session: ${touched.join(", ")}. ` +
        "A failure that touches the agent's change set always blocks completion and can never be covered by a pre-existing exception.",
    };
  }

  const isAcceptance = acceptanceCommands.some(
    (acceptance) => acceptance.length > 0 && normalizeCommand(command).includes(normalizeCommand(acceptance)),
  );
  if (isAcceptance) {
    return {
      ...base,
      status: "new_failure",
      reason: `"${command}" is an explicit acceptance command for this task; its failure blocks completion regardless of baselines.`,
    };
  }

  if (record.baselineMatch === "recorded_baseline" || record.baselineMatch === "matches_baseline") {
    const owner = signal?.implicatedFiles[0]?.path;
    return {
      failureId: record.id,
      status: "unrelated_pre_existing_failure",
      blocking: false,
      reason:
        `Failure of "${command}" matches the session baseline recorded on its first run` +
        (owner ? `; owning file: ${owner}` : "") +
        " and none of its files are in this session's change set.",
    };
  }

  const declaration = knownFailures.find((known) => matchesDeclaration(signal ?? { command, exitCode: null, failingTestIds: [], implicatedFiles: [] }, known));
  if (declaration) {
    const owner = declaration.files?.[0] ?? signal?.implicatedFiles[0]?.path;
    return {
      failureId: record.id,
      status: "unrelated_pre_existing_failure",
      blocking: false,
      reason:
        `Failure of "${command}" is covered by a known-failure exception declared by ${declaration.declaredBy}` +
        (owner ? ` (scope: ${owner})` : "") +
        (declaration.note ? `: ${declaration.note}` : "") +
        ". The exception applies because none of its files were changed in this session.",
    };
  }

  return {
    ...base,
    status: "new_failure",
    reason:
      `Failure of "${command}" is new relative to the session baseline` +
      (signal && signal.failingTestIds.length > 0 ? ` (failing: ${signal.failingTestIds.join(", ")})` : "") +
      " and no user or repo-policy exception declares it. Re-run the check successfully or fix the underlying regression.",
  };
}
