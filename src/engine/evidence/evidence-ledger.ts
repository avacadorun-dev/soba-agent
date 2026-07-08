import type { FixUntilGreenDecision } from "../recovery";
import type { AgentTurnError } from "../turn/types";
import {
  isCodePath,
  isDocumentationPath,
  type VerificationKind,
  verificationKindFromCommand,
} from "../verification/verification-policy";

export type EvidenceKind =
  | "inspect"
  | "search"
  | "mutation"
  | "diagnostic"
  | "verification"
  | "checkpoint"
  | "reflection"
  | "recovery_attempt"
  | "finish_attempt";

export type EvidenceStatus = "success" | "failure" | "active" | "resolved" | "unverified" | "rejected";

export interface EvidenceEntry {
  id: string;
  kind: EvidenceKind;
  status: EvidenceStatus;
  timestamp: number;
  summary: string;
  checkpointKind?: "milestone" | "plan_pivot";
  nextDirection?: string;
  completed?: string[];
  pending?: string[];
  toolCallId?: string;
  toolName?: string;
  command?: string;
  verificationKind?: VerificationKind;
  durationMs?: number;
  exitCode?: number | null;
  cwd?: string;
  outputPreview?: string;
  outputDigest?: string;
  files?: string[];
  mutationIds?: string[];
  resolves?: string[];
  iteration?: number;
}

export interface EvidenceToolOutcome {
  toolCallId: string;
  toolName: string;
  arguments: string;
  isError: boolean;
  output: string;
  iteration: number;
  verificationKind?: VerificationKind;
  durationMs?: number;
  cwd?: string;
  details?: Record<string, unknown>;
}

export interface VerificationCommandNotice {
  command?: string;
  reason: string;
  verificationKind?: VerificationKind;
}

export interface CheckpointEvidenceNotice {
  kind: "milestone" | "plan_pivot";
  reason: string;
  nextDirection?: string;
  completed: string[];
  pending: string[];
  toolCallId?: string;
  iteration?: number;
}

export interface EvidenceLedgerSummary {
  successfulToolCallIds: Set<string>;
  verificationEvidenceCallIds: Set<string>;
  inspectionEvidenceCallIds: Set<string>;
  verificationKinds: Set<VerificationKind>;
  needsVerification: boolean;
  hasUsedTools: boolean;
  hasMutatedFiles: boolean;
  hasCodeMutations: boolean;
  hasDocsMutations: boolean;
  unverifiedMutationIds: string[];
  unverifiedCodeMutationIds: string[];
  unverifiedDocsMutationIds: string[];
  activeDiagnosticIds: string[];
  unresolvedVerificationFailureIds: string[];
  entries: EvidenceEntry[];
}

const INSPECT_TOOL_NAMES = new Set(["read", "ls", "inspect_file"]);
const MUTATION_TOOL_NAMES = new Set(["write", "edit"]);
const SUCCESS_RESOLVES_TOOL_DIAGNOSTICS = new Set(["read_project_memory", "write_project_memory"]);
const OUTPUT_PREVIEW_MAX_CHARS = 2_000;

export class EvidenceLedger {
  private readonly entries: EvidenceEntry[] = [];
  private readonly successfulToolCallIds = new Set<string>();

  recordToolOutcome(outcome: EvidenceToolOutcome): EvidenceEntry {
    const shellMutation = outcome.toolName === "bash" ? this.recordShellMutation(outcome) : null;

    if (outcome.isError) {
      if (outcome.toolName === "bash") {
        const command = readCommand(outcome.arguments);
        const verificationKind = verificationKindForOutcome(outcome, command);
        if (verificationKind && verificationKind !== "diff_inspection" && verificationKind !== "manual_inspection") {
          this.recordFailedVerification(outcome, command, verificationKind);
        }
      }
      return this.recordDiagnostic(outcome, "active");
    }

    this.successfulToolCallIds.add(outcome.toolCallId);
    const resolvedDiagnosticIds = this.resolveActiveDiagnosticsForSuccessfulTool(outcome);

    if (shellMutation) return shellMutation;

    if (MUTATION_TOOL_NAMES.has(outcome.toolName)) {
      const files = readFiles(outcome.arguments);
      return this.addEntry({
        id: evidenceId("mutation", outcome.toolCallId),
        kind: "mutation",
        status: "unverified",
        timestamp: Date.now(),
        toolCallId: outcome.toolCallId,
        toolName: outcome.toolName,
        files,
        iteration: outcome.iteration,
        summary: `${outcome.toolName} changed project files${files.length > 0 ? `: ${files.join(", ")}` : ""}`,
      });
    }

    if (outcome.toolName === "bash") {
      const command = readCommand(outcome.arguments);
      const verificationKind = verificationKindForOutcome(outcome, command);
      if (verificationKind && verificationKind !== "diff_inspection" && verificationKind !== "manual_inspection") {
        return this.recordVerification(outcome, command, verificationKind);
      }
      if (verificationKind === "diff_inspection") {
        const mutationIds = this.resolveDocsMutationsWithDiffInspection(outcome.toolCallId);
        return this.addEntry({
          id: evidenceId("inspection", outcome.toolCallId),
          kind: "verification",
          status: "success",
          timestamp: Date.now(),
          toolCallId: outcome.toolCallId,
          toolName: outcome.toolName,
          command,
          verificationKind: "diff_inspection",
          ...(mutationIds.length > 0 ? { mutationIds } : {}),
          iteration: outcome.iteration,
          ...commandEvidenceFields(outcome),
          summary: `Inspected project diff with: ${command}`,
        });
      }
      if (isSearchCommand(command)) {
        return this.addEntry({
          id: evidenceId("search", outcome.toolCallId),
          kind: "search",
          status: "success",
          timestamp: Date.now(),
          toolCallId: outcome.toolCallId,
          toolName: outcome.toolName,
          command,
          iteration: outcome.iteration,
          ...commandEvidenceFields(outcome),
          summary: `Searched project with: ${command}`,
        });
      }
    }

    if (INSPECT_TOOL_NAMES.has(outcome.toolName)) {
      const files = readFiles(outcome.arguments);
      const mutationIds = this.resolveDocsMutationsWithInspection(files, outcome.toolCallId);
      return this.addEntry({
        id: evidenceId("inspect", outcome.toolCallId),
        kind: "inspect",
        status: "success",
        timestamp: Date.now(),
        toolCallId: outcome.toolCallId,
        toolName: outcome.toolName,
        verificationKind: "manual_inspection",
        files,
        ...(mutationIds.length > 0 ? { mutationIds } : {}),
        iteration: outcome.iteration,
        summary: `${outcome.toolName} inspected project context${files.length > 0 ? `: ${files.join(", ")}` : ""}`,
      });
    }

    return this.addEntry({
      id: evidenceId("inspect", outcome.toolCallId),
      kind: "inspect",
      status: "success",
      timestamp: Date.now(),
      toolCallId: outcome.toolCallId,
      toolName: outcome.toolName,
      iteration: outcome.iteration,
      ...(resolvedDiagnosticIds.length > 0 ? { resolves: resolvedDiagnosticIds } : {}),
      summary: `${outcome.toolName} produced successful runtime evidence`,
    });
  }

  recordFinishAttempt(status: "accepted" | "rejected", summary: string): EvidenceEntry {
    return this.addEntry({
      id: evidenceId("finish", crypto.randomUUID().slice(0, 8)),
      kind: "finish_attempt",
      status: status === "accepted" ? "success" : "rejected",
      timestamp: Date.now(),
      summary,
    });
  }

  recordVerificationCommandSelected(notice: VerificationCommandNotice): EvidenceEntry {
    return this.addEntry({
      id: evidenceId("verification", crypto.randomUUID().slice(0, 8)),
      kind: "verification",
      status: "active",
      timestamp: Date.now(),
      command: notice.command,
      verificationKind: notice.verificationKind,
      summary: `Auto-verifier selected${notice.command ? `: ${notice.command}` : ""}. ${notice.reason}`,
    });
  }

  recordVerificationCommandSkipped(notice: VerificationCommandNotice): EvidenceEntry {
    return this.addEntry({
      id: evidenceId("verification", crypto.randomUUID().slice(0, 8)),
      kind: "verification",
      status: "rejected",
      timestamp: Date.now(),
      command: notice.command,
      verificationKind: notice.verificationKind,
      summary: `Auto-verifier skipped${notice.command ? `: ${notice.command}` : ""}. ${notice.reason}`,
    });
  }

  recordCheckpoint(notice: string | CheckpointEvidenceNotice): EvidenceEntry {
    if (typeof notice === "string") {
      return this.addEntry({
        id: evidenceId("checkpoint", crypto.randomUUID().slice(0, 8)),
        kind: "checkpoint",
        status: "success",
        timestamp: Date.now(),
        summary: notice,
      });
    }

    const parts = [`Checkpoint ${notice.kind}: ${notice.reason}`];
    if (notice.nextDirection) parts.push(`next: ${notice.nextDirection}`);
    if (notice.completed.length > 0) parts.push(`completed: ${notice.completed.join(", ")}`);
    if (notice.pending.length > 0) parts.push(`pending: ${notice.pending.join(", ")}`);

    return this.addEntry({
      id: evidenceId("checkpoint", crypto.randomUUID().slice(0, 8)),
      kind: "checkpoint",
      status: "success",
      timestamp: Date.now(),
      toolCallId: notice.toolCallId,
      toolName: "checkpoint",
      checkpointKind: notice.kind,
      nextDirection: notice.nextDirection,
      completed: notice.completed.slice(),
      pending: notice.pending.slice(),
      iteration: notice.iteration,
      summary: parts.join("; "),
    });
  }

  recordReflection(summary: string): EvidenceEntry {
    return this.addEntry({
      id: evidenceId("reflection", crypto.randomUUID().slice(0, 8)),
      kind: "reflection",
      status: "success",
      timestamp: Date.now(),
      summary,
    });
  }

  recordRecoveryIteration(decision: FixUntilGreenDecision): EvidenceEntry {
    const command = decision.action === "passed" ? undefined : decision.diagnostic.command;
    const diagnosticSummary = decision.action === "passed" ? decision.message : decision.diagnostic.summary;
    return this.addEntry({
      id: evidenceId("recovery_attempt", crypto.randomUUID().slice(0, 8)),
      kind: "recovery_attempt",
      status: decision.status === "recovering" || decision.status === "passed" ? "success" : "active",
      timestamp: Date.now(),
      command,
      iteration: decision.iteration,
      summary: `Fix-Until-Green ${decision.status}: ${diagnosticSummary}`,
    });
  }

  getEntries(): EvidenceEntry[] {
    return this.entries.map((entry) => ({
      ...entry,
      completed: entry.completed?.slice(),
      pending: entry.pending?.slice(),
      files: entry.files?.slice(),
      mutationIds: entry.mutationIds?.slice(),
      resolves: entry.resolves?.slice(),
    }));
  }

  getSummary(): EvidenceLedgerSummary {
    const verificationEvidenceCallIds = new Set(
      this.entries.flatMap((entry) => {
        if (
          entry.kind === "verification" &&
          entry.status === "success" &&
          entry.toolCallId &&
          entry.verificationKind !== "diff_inspection" &&
          entry.verificationKind !== "manual_inspection"
        ) {
          return [entry.toolCallId];
        }
        return [];
      }),
    );
    const inspectionEvidenceCallIds = new Set(
      this.entries.flatMap((entry) => {
        if (
          entry.status === "success" &&
          entry.toolCallId &&
          (entry.verificationKind === "diff_inspection" || entry.verificationKind === "manual_inspection")
        ) {
          return [entry.toolCallId];
        }
        return [];
      }),
    );
    const verificationKinds = new Set(
      this.entries.flatMap((entry) => {
        if (entry.status === "success" && entry.verificationKind) return [entry.verificationKind];
        return [];
      }),
    );
    const unverifiedMutationIds = this.entries.flatMap((entry) => {
      if (entry.kind === "mutation" && entry.status === "unverified") return [entry.id];
      return [];
    });
    const unverifiedCodeMutationIds = this.entries.flatMap((entry) => {
      if (entry.kind === "mutation" && entry.status === "unverified" && entryFilesAreCode(entry)) return [entry.id];
      return [];
    });
    const unverifiedDocsMutationIds = this.entries.flatMap((entry) => {
      if (entry.kind === "mutation" && entry.status === "unverified" && entryFilesAreDocs(entry)) return [entry.id];
      return [];
    });
    const activeDiagnosticIds = this.entries.flatMap((entry) => {
      if (entry.kind === "diagnostic" && entry.status === "active") return [entry.id];
      return [];
    });
    const unresolvedVerificationFailureIds = unresolvedVerificationFailures(this.entries).map((entry) => entry.id);

    return {
      successfulToolCallIds: new Set(this.successfulToolCallIds),
      verificationEvidenceCallIds,
      inspectionEvidenceCallIds,
      verificationKinds,
      needsVerification: unverifiedMutationIds.length > 0,
      hasUsedTools: this.entries.some((entry) => entry.toolCallId !== undefined),
      hasMutatedFiles: this.entries.some((entry) => entry.kind === "mutation"),
      hasCodeMutations: this.entries.some((entry) => entry.kind === "mutation" && entryFilesAreCode(entry)),
      hasDocsMutations: this.entries.some((entry) => entry.kind === "mutation" && entryFilesAreDocs(entry)),
      unverifiedMutationIds,
      unverifiedCodeMutationIds,
      unverifiedDocsMutationIds,
      activeDiagnosticIds,
      unresolvedVerificationFailureIds,
      entries: this.getEntries(),
    };
  }

  toCompletionState(errors: AgentTurnError[]) {
    const summary = this.getSummary();
    return {
      errors,
      successfulToolCallIds: summary.successfulToolCallIds,
      verificationEvidenceCallIds: summary.verificationEvidenceCallIds,
      inspectionEvidenceCallIds: summary.inspectionEvidenceCallIds,
      verificationKinds: summary.verificationKinds,
      needsVerification: summary.needsVerification,
      hasUsedTools: summary.hasUsedTools,
      hasMutatedFiles: summary.hasMutatedFiles,
      hasCodeMutations: summary.hasCodeMutations,
      hasDocsMutations: summary.hasDocsMutations,
      unverifiedMutationIds: summary.unverifiedMutationIds,
      unverifiedCodeMutationIds: summary.unverifiedCodeMutationIds,
      unverifiedDocsMutationIds: summary.unverifiedDocsMutationIds,
      unresolvedVerificationFailureIds: summary.unresolvedVerificationFailureIds,
      evidenceIds: new Set(summary.entries.map((entry) => entry.id)),
    };
  }

  private recordDiagnostic(outcome: EvidenceToolOutcome, status: "active" | "resolved"): EvidenceEntry {
    return this.addEntry({
      id: evidenceId("diagnostic", outcome.toolCallId),
      kind: "diagnostic",
      status,
      timestamp: Date.now(),
      toolCallId: outcome.toolCallId,
      toolName: outcome.toolName,
      command: outcome.toolName === "bash" ? readCommand(outcome.arguments) : undefined,
      iteration: outcome.iteration,
      ...(outcome.toolName === "bash" ? commandEvidenceFields(outcome) : {}),
      summary: `${outcome.toolName} failed: ${outcome.output.slice(0, 160)}`,
    });
  }

  private recordVerification(
    outcome: EvidenceToolOutcome,
    command: string,
    verificationKind: VerificationKind,
  ): EvidenceEntry {
    const unverifiedMutations = this.entries.filter((entry) => entry.kind === "mutation" && entry.status === "unverified");
    const activeDiagnostics = this.entries.filter((entry) => entry.kind === "diagnostic" && entry.status === "active");
    const mutationIds = unverifiedMutations.map((entry) => entry.id);
    const diagnosticIds = activeDiagnostics.map((entry) => entry.id);

    for (const entry of unverifiedMutations) {
      entry.status = "success";
      entry.resolves = [...(entry.resolves ?? []), outcome.toolCallId];
    }
    for (const entry of activeDiagnostics) {
      entry.status = "resolved";
      entry.resolves = [...(entry.resolves ?? []), outcome.toolCallId];
    }

    return this.addEntry({
      id: evidenceId("verification", outcome.toolCallId),
      kind: "verification",
      status: "success",
      timestamp: Date.now(),
      toolCallId: outcome.toolCallId,
      toolName: outcome.toolName,
      command,
      verificationKind,
      mutationIds,
      resolves: diagnosticIds,
      iteration: outcome.iteration,
      ...commandEvidenceFields(outcome),
      summary: `Verification command passed: ${command}`,
    });
  }

  private recordFailedVerification(
    outcome: EvidenceToolOutcome,
    command: string,
    verificationKind: VerificationKind,
  ): EvidenceEntry {
    return this.addEntry({
      id: evidenceId("verification", outcome.toolCallId),
      kind: "verification",
      status: "failure",
      timestamp: Date.now(),
      toolCallId: outcome.toolCallId,
      toolName: outcome.toolName,
      command,
      verificationKind,
      iteration: outcome.iteration,
      ...commandEvidenceFields(outcome),
      summary: `Verification command failed: ${command}`,
    });
  }

  private recordShellMutation(outcome: EvidenceToolOutcome): EvidenceEntry | null {
    const files = readChangedFiles(outcome.details);
    if (files.length === 0) return null;

    return this.addEntry({
      id: evidenceId("mutation", outcome.toolCallId),
      kind: "mutation",
      status: "unverified",
      timestamp: Date.now(),
      toolCallId: outcome.toolCallId,
      toolName: outcome.toolName,
      command: readCommand(outcome.arguments),
      files,
      iteration: outcome.iteration,
      ...commandEvidenceFields(outcome),
      summary: `bash changed project files: ${files.join(", ")}`,
    });
  }

  private resolveActiveDiagnosticsForSuccessfulTool(outcome: EvidenceToolOutcome): string[] {
    if (!SUCCESS_RESOLVES_TOOL_DIAGNOSTICS.has(outcome.toolName)) {
      return [];
    }

    const resolvedIds: string[] = [];
    for (const entry of this.entries) {
      if (entry.kind !== "diagnostic" || entry.status !== "active" || entry.toolName !== outcome.toolName) {
        continue;
      }

      entry.status = "resolved";
      entry.resolves = [...(entry.resolves ?? []), outcome.toolCallId];
      resolvedIds.push(entry.id);
    }

    return resolvedIds;
  }

  private resolveDocsMutationsWithInspection(files: string[], toolCallId: string): string[] {
    if (files.length === 0) {
      return [];
    }

    const inspectedFiles = new Set(files);
    return this.resolveDocsMutations(
      (entry) => (entry.files ?? []).length > 0 && (entry.files ?? []).every((file) => inspectedFiles.has(file)),
      toolCallId,
    );
  }

  private resolveDocsMutationsWithDiffInspection(toolCallId: string): string[] {
    return this.resolveDocsMutations(() => true, toolCallId);
  }

  private resolveDocsMutations(matches: (entry: EvidenceEntry) => boolean, toolCallId: string): string[] {
    const mutationIds: string[] = [];
    for (const entry of this.entries) {
      if (entry.kind !== "mutation" || entry.status !== "unverified" || !entryFilesAreDocs(entry) || !matches(entry)) {
        continue;
      }

      entry.status = "success";
      entry.resolves = [...(entry.resolves ?? []), toolCallId];
      mutationIds.push(entry.id);
    }

    return mutationIds;
  }

  private addEntry(entry: EvidenceEntry): EvidenceEntry {
    this.entries.push(entry);
    return { ...entry, mutationIds: entry.mutationIds?.slice(), resolves: entry.resolves?.slice() };
  }
}

function unresolvedVerificationFailures(entries: EvidenceEntry[]): EvidenceEntry[] {
  const laterPassingKinds = new Set<VerificationKind>();
  const unresolved: EvidenceEntry[] = [];

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.kind !== "verification" || !entry.verificationKind) continue;

    if (entry.status === "success") {
      laterPassingKinds.add(entry.verificationKind);
      continue;
    }

    if (entry.status === "failure" && !laterPassingKinds.has(entry.verificationKind)) {
      unresolved.push(entry);
    }
  }

  return unresolved.reverse();
}

function readFiles(args: string): string[] {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    return ["path", "file", "filePath", "target", "input"]
      .flatMap((key) => {
        const value = parsed[key];
        return typeof value === "string" ? [value] : [];
      })
      .filter((value) => !value.includes("\n") && value.length < 500);
  } catch {
    return [];
  }
}

function entryFilesAreDocs(entry: EvidenceEntry): boolean {
  const files = entry.files ?? [];
  return files.length > 0 && files.every(isDocumentationPath);
}

function entryFilesAreCode(entry: EvidenceEntry): boolean {
  const files = entry.files ?? [];
  if (files.length === 0) return true;
  return files.some(isCodePath);
}

function evidenceId(kind: EvidenceKind | "finish" | "inspection", suffix: string): string {
  return `ev_${kind}_${suffix}`;
}

function readCommand(args: string): string {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    if (typeof parsed.command === "string") return parsed.command;
    return typeof parsed.input === "string" ? parsed.input : "";
  } catch {
    return "";
  }
}

function isSearchCommand(command: string): boolean {
  return /\b(rg|grep|find)\b/.test(command);
}

function verificationKindForOutcome(outcome: EvidenceToolOutcome, command: string): VerificationKind | null {
  return outcome.verificationKind ?? verificationKindFromCommand(command);
}

function commandEvidenceFields(outcome: EvidenceToolOutcome): Pick<
  EvidenceEntry,
  "durationMs" | "exitCode" | "cwd" | "outputPreview" | "outputDigest"
> {
  const exitCode = readExitCode(outcome.details);
  const outputDigest = readStringDetail(outcome.details, "outputDigest");
  return {
    durationMs: outcome.durationMs,
    exitCode,
    cwd: outcome.cwd,
    outputPreview: previewOutput(outcome.output),
    outputDigest,
  };
}

function readExitCode(details: Record<string, unknown> | undefined): number | null | undefined {
  if (!details || !("exitCode" in details)) return undefined;
  return details.exitCode === null || typeof details.exitCode === "number" ? details.exitCode : undefined;
}

function readChangedFiles(details: Record<string, unknown> | undefined): string[] {
  const value = details?.changedFiles;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readStringDetail(details: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = details?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function previewOutput(output: string): string | undefined {
  const trimmed = output.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= OUTPUT_PREVIEW_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, OUTPUT_PREVIEW_MAX_CHARS)}\n[Evidence output preview truncated]`;
}

export function isVerificationCommand(command: string): boolean {
  const verificationKind = verificationKindFromCommand(command);
  return verificationKind !== null && verificationKind !== "diff_inspection" && verificationKind !== "manual_inspection";
}
