import type { EvidenceEntry, EvidenceLedgerSummary } from "../loop/evidence-ledger";
import type { VerificationKind } from "../loop/verification-policy";
import type { DiffReviewActionRecord } from "./diff-review";
import type { EvidenceDiffSummary } from "./diff-summary";

export type EvidenceBundleStatus = "verified" | "partially_verified" | "unverified" | "blocked";

export type EvidenceChangedFileOperation = "created" | "modified" | "deleted" | "renamed" | "unknown";

export type EvidenceChangedFileSource =
  | "tool_write"
  | "tool_edit"
  | "shell"
  | "delegated_editor"
  | "mcp"
  | "git"
  | "unknown";

export interface EvidenceChangedFile {
  path: string;
  operation: EvidenceChangedFileOperation;
  source: EvidenceChangedFileSource;
  added?: number;
  removed?: number;
  mutationIds: string[];
  remainsChanged?: boolean;
}

export type EvidenceCommandStatus = "passed" | "failed" | "skipped" | "running" | "unknown";

export interface EvidenceCommandRun {
  id: string;
  command: string;
  status: EvidenceCommandStatus;
  verificationKind?: VerificationKind;
  toolCallId?: string;
  durationMs?: number;
  exitCode?: number | null;
  cwd?: string;
  outputPreview?: string;
}

export type EvidenceCheckStatus = "passed" | "failed" | "skipped" | "not_run" | "not_required";

export interface EvidenceCheck {
  id: string;
  label: string;
  status: EvidenceCheckStatus;
  verificationKind?: VerificationKind;
  commandId?: string;
  reason?: string;
}

export interface EvidenceApproval {
  toolCallId: string;
  decision: "deny" | "once" | "session" | "repo" | "full";
  reason?: string;
}

export type EvidenceRiskKind =
  | "active_diagnostic"
  | "failed_check"
  | "skipped_check"
  | "unverified_changes"
  | "unknown_changed_files";

export interface EvidenceRisk {
  id: string;
  kind: EvidenceRiskKind;
  severity: "info" | "warning" | "error";
  message: string;
  evidenceIds: string[];
}

export interface EvidenceBundle {
  version: 1;
  sessionId: string;
  turnId: string;
  status: EvidenceBundleStatus;
  summary: string;
  changedFiles: EvidenceChangedFile[];
  commands: EvidenceCommandRun[];
  checks: EvidenceCheck[];
  approvals: EvidenceApproval[];
  risks: EvidenceRisk[];
  diff?: EvidenceDiffSummary;
  reviewActions: DiffReviewActionRecord[];
  createdAt: string;
}

export interface BuildEvidenceBundleInput {
  sessionId: string;
  turnId: string;
  completionStatus: "completed" | "completed_with_unverified_changes" | "blocked";
  summary: string;
  ledger: EvidenceLedgerSummary;
  changedFiles?: EvidenceChangedFile[];
  commands?: EvidenceCommandRun[];
  approvals?: EvidenceApproval[];
  diff?: EvidenceDiffSummary;
  reviewActions?: DiffReviewActionRecord[];
  now?: () => Date;
}

export function buildEvidenceBundle(input: BuildEvidenceBundleInput): EvidenceBundle {
  const commands = mergeCommands(commandsFromLedger(input.ledger.entries), input.commands ?? []);
  const checks = buildChecks(input.ledger, commands);
  const changedFiles = mergeChangedFiles(changedFilesFromLedger(input.ledger.entries), input.changedFiles ?? []);
  const risks = buildRisks(input.ledger, checks, changedFiles);
  const status = decideBundleStatus(input.completionStatus, input.ledger, checks, risks);

  return {
    version: 1,
    sessionId: input.sessionId,
    turnId: input.turnId,
    status,
    summary: input.summary,
    changedFiles,
    commands,
    checks,
    approvals: input.approvals ?? [],
    risks,
    diff: input.diff,
    reviewActions: input.reviewActions ?? [],
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
  };
}

export function formatEvidenceBundleForHandoff(bundle: EvidenceBundle): string {
  const lines = ["", "**Evidence**", `- Status: ${formatBundleStatus(bundle.status)}`];

  lines.push(`- Changed files: ${formatChangedFiles(bundle.changedFiles)}`);
  if (bundle.diff) {
    lines.push(`- Diff: ${formatDiffSummary(bundle.diff)}`);
  }
  lines.push(`- Checks: ${formatChecks(bundle.checks, bundle.commands)}`);
  lines.push(`- Risks: ${formatRisks(bundle.risks)}`);
  if (bundle.reviewActions.length > 0) {
    lines.push(`- Review: ${formatReviewActions(bundle.reviewActions)}`);
  }

  return lines.join("\n");
}

function commandsFromLedger(entries: EvidenceEntry[]): EvidenceCommandRun[] {
  return entries.flatMap((entry) => {
    if (!entry.command) return [];
    return [
      {
        id: commandId(entry),
        command: entry.command,
        status: commandStatusFromEntry(entry),
        verificationKind: entry.verificationKind,
        toolCallId: entry.toolCallId,
      },
    ];
  });
}

function mergeCommands(base: EvidenceCommandRun[], overrides: EvidenceCommandRun[]): EvidenceCommandRun[] {
  const byKey = new Map<string, EvidenceCommandRun>();
  for (const command of [...base, ...overrides]) {
    const key = command.toolCallId ?? command.id;
    byKey.set(key, { ...byKey.get(key), ...command });
  }
  return [...byKey.values()];
}

function buildChecks(ledger: EvidenceLedgerSummary, commands: EvidenceCommandRun[]): EvidenceCheck[] {
  const checks = ledger.entries.flatMap((entry) => checkFromEntry(entry, commands));
  checks.push(...checksFromCommands(commands, checks));
  const hasVerificationCheck = checks.some((check) => check.verificationKind && check.status !== "not_required");

  if (ledger.hasCodeMutations && ledger.unverifiedCodeMutationIds.length > 0 && !hasVerificationCheck) {
    checks.push({
      id: "check_command_verification_not_run",
      label: "Command verification",
      status: "not_run",
      reason: "Code changes have no passing command verification evidence.",
    });
  }

  if (ledger.hasDocsMutations && !ledger.hasCodeMutations && ledger.unverifiedDocsMutationIds.length > 0 && !hasVerificationCheck) {
    checks.push({
      id: "check_docs_inspection_not_run",
      label: "Docs inspection",
      status: "not_run",
      reason: "Docs-only changes need inspection evidence before completion.",
    });
  }

  if (
    ledger.hasMutatedFiles &&
    ledger.unverifiedMutationIds.length > 0 &&
    ledger.unverifiedCodeMutationIds.length === 0 &&
    ledger.unverifiedDocsMutationIds.length === 0 &&
    !hasVerificationCheck
  ) {
    checks.push({
      id: "check_mutation_verification_not_run",
      label: "Mutation verification",
      status: "not_run",
      reason: "File changes have no passing verification evidence.",
    });
  }

  if (!ledger.hasMutatedFiles && checks.length === 0) {
    checks.push({
      id: "check_mutation_verification_not_required",
      label: "Mutation verification",
      status: "not_required",
      reason: "No file mutations were recorded.",
    });
  }

  return checks;
}

function checkFromEntry(entry: EvidenceEntry, commands: EvidenceCommandRun[]): EvidenceCheck[] {
  if (entry.kind !== "verification" && !entry.verificationKind) return [];

  const command = commands.find((candidate) =>
    entry.toolCallId ? candidate.toolCallId === entry.toolCallId : candidate.command === entry.command
  );
  return [
    {
      id: `check_${entry.id}`,
      label: checkLabel(entry),
      status: checkStatusFromEntry(entry),
      verificationKind: entry.verificationKind,
      commandId: command?.id,
      reason: entry.summary,
    },
  ];
}

function checksFromCommands(commands: EvidenceCommandRun[], existing: EvidenceCheck[]): EvidenceCheck[] {
  const existingCommandIds = new Set(existing.flatMap((check) => (check.commandId ? [check.commandId] : [])));
  return commands.flatMap((command) => {
    if (!command.verificationKind || existingCommandIds.has(command.id)) return [];
    return [
      {
        id: `check_${command.id}`,
        label: verificationKindLabel(command.verificationKind),
        status: checkStatusFromCommand(command),
        verificationKind: command.verificationKind,
        commandId: command.id,
        reason: commandCheckReason(command),
      },
    ];
  });
}

function changedFilesFromLedger(entries: EvidenceEntry[]): EvidenceChangedFile[] {
  return entries.flatMap((entry) => {
    if (entry.kind !== "mutation") return [];
    const files = entry.files ?? [];
    if (files.length === 0) return [];
    return files.map((path) => ({
      path,
      operation: "unknown" as const,
      source: sourceFromToolName(entry.toolName),
      mutationIds: [entry.id],
    }));
  });
}

function mergeChangedFiles(base: EvidenceChangedFile[], overrides: EvidenceChangedFile[]): EvidenceChangedFile[] {
  const byPath = new Map<string, EvidenceChangedFile>();
  for (const file of [...base, ...overrides]) {
    const existing = byPath.get(file.path);
    if (!existing) {
      byPath.set(file.path, { ...file, mutationIds: [...file.mutationIds] });
      continue;
    }
    byPath.set(file.path, {
      ...existing,
      ...file,
      mutationIds: unique([...existing.mutationIds, ...file.mutationIds]),
    });
  }
  return [...byPath.values()];
}

function buildRisks(
  ledger: EvidenceLedgerSummary,
  checks: EvidenceCheck[],
  changedFiles: EvidenceChangedFile[],
): EvidenceRisk[] {
  const risks: EvidenceRisk[] = [];

  if (ledger.activeDiagnosticIds.length > 0) {
    risks.push({
      id: "risk_active_diagnostics",
      kind: "active_diagnostic",
      severity: "error",
      message: "Active tool diagnostics remain unresolved.",
      evidenceIds: ledger.activeDiagnosticIds,
    });
  }

  const failedChecks = checks.filter((check) => check.status === "failed");
  if (failedChecks.length > 0) {
    risks.push({
      id: "risk_failed_checks",
      kind: "failed_check",
      severity: "error",
      message: "One or more verification checks failed.",
      evidenceIds: failedChecks.map((check) => check.id),
    });
  }

  const skippedChecks = checks.filter((check) => check.status === "skipped" || check.status === "not_run");
  if (skippedChecks.length > 0) {
    risks.push({
      id: "risk_skipped_checks",
      kind: "skipped_check",
      severity: "warning",
      message: "One or more verification checks were skipped or not run.",
      evidenceIds: skippedChecks.map((check) => check.id),
    });
  }

  if (ledger.unverifiedMutationIds.length > 0) {
    risks.push({
      id: "risk_unverified_changes",
      kind: "unverified_changes",
      severity: "warning",
      message: "Some file mutations are not covered by passing verification evidence.",
      evidenceIds: ledger.unverifiedMutationIds,
    });
  }

  if (ledger.hasMutatedFiles && changedFiles.length === 0) {
    risks.push({
      id: "risk_unknown_changed_files",
      kind: "unknown_changed_files",
      severity: "warning",
      message: "File mutations were recorded, but changed file paths are unknown.",
      evidenceIds: ledger.entries.filter((entry) => entry.kind === "mutation").map((entry) => entry.id),
    });
  }

  return risks;
}

function decideBundleStatus(
  completionStatus: BuildEvidenceBundleInput["completionStatus"],
  ledger: EvidenceLedgerSummary,
  checks: EvidenceCheck[],
  risks: EvidenceRisk[],
): EvidenceBundleStatus {
  if (completionStatus === "blocked") return "blocked";
  if (!ledger.hasMutatedFiles) return risks.some((risk) => risk.severity === "error") ? "partially_verified" : "verified";
  if (ledger.unverifiedMutationIds.length === 0 && checks.every((check) => check.status !== "failed" && check.status !== "not_run")) {
    return "verified";
  }
  if (checks.some((check) => check.status !== "not_run" && check.status !== "not_required")) {
    return "partially_verified";
  }
  return "unverified";
}

function commandStatusFromEntry(entry: EvidenceEntry): EvidenceCommandStatus {
  switch (entry.status) {
    case "success":
    case "resolved":
      return "passed";
    case "failure":
      return "failed";
    case "rejected":
      return "skipped";
    case "active":
      return "running";
    case "unverified":
      return "unknown";
  }
}

function checkStatusFromEntry(entry: EvidenceEntry): EvidenceCheckStatus {
  switch (entry.status) {
    case "success":
    case "resolved":
      return "passed";
    case "failure":
      return "failed";
    case "rejected":
      return "skipped";
    case "active":
      return "not_run";
    case "unverified":
      return "not_run";
  }
}

function checkStatusFromCommand(command: EvidenceCommandRun): EvidenceCheckStatus {
  switch (command.status) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "running":
    case "unknown":
      return "not_run";
  }
}

function checkLabel(entry: EvidenceEntry): string {
  if (entry.verificationKind) return verificationKindLabel(entry.verificationKind);
  return entry.command ? "Command verification" : "Verification";
}

function commandCheckReason(command: EvidenceCommandRun): string {
  switch (command.status) {
    case "passed":
      return `Command passed: ${command.command}`;
    case "failed":
      return `Command failed: ${command.command}`;
    case "skipped":
      return `Command skipped: ${command.command}`;
    case "running":
      return `Command selected but has not completed: ${command.command}`;
    case "unknown":
      return `Command outcome is unknown: ${command.command}`;
  }
}

function verificationKindLabel(kind: VerificationKind): string {
  switch (kind) {
    case "test":
      return "Tests";
    case "lint":
      return "Lint";
    case "typecheck":
      return "Typecheck";
    case "build":
      return "Build";
    case "run":
      return "Runtime check";
    case "diff_inspection":
      return "Diff inspection";
    case "manual_inspection":
      return "Manual inspection";
  }
}

function sourceFromToolName(toolName: string | undefined): EvidenceChangedFileSource {
  if (toolName === "write") return "tool_write";
  if (toolName === "edit") return "tool_edit";
  if (toolName === "bash") return "shell";
  if (toolName?.startsWith("mcp_")) return "mcp";
  return "unknown";
}

function commandId(entry: EvidenceEntry): string {
  return entry.toolCallId ? `cmd_${entry.toolCallId}` : `cmd_${entry.id}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function formatBundleStatus(status: EvidenceBundleStatus): string {
  switch (status) {
    case "verified":
      return "verified";
    case "partially_verified":
      return "partially verified";
    case "unverified":
      return "unverified";
    case "blocked":
      return "blocked";
  }
}

function formatChangedFiles(files: EvidenceChangedFile[]): string {
  if (files.length === 0) return "none recorded";
  return files
    .slice(0, 8)
    .map((file) => {
      const operation = file.operation === "unknown" ? "" : `${file.operation} `;
      const stat = file.added !== undefined || file.removed !== undefined
        ? ` (+${file.added ?? 0}/-${file.removed ?? 0})`
        : "";
      return `${operation}${file.path}${stat}`;
    })
    .join(", ") + (files.length > 8 ? `, ...${files.length - 8} more` : "");
}

function formatChecks(checks: EvidenceCheck[], commands: EvidenceCommandRun[]): string {
  if (checks.length === 0) return "none recorded";
  return checks
    .slice(0, 6)
    .map((check) => {
      const command = check.commandId ? commands.find((candidate) => candidate.id === check.commandId) : undefined;
      const commandText = command ? ` (${command.command})` : "";
      return `${check.label} ${formatCheckStatus(check.status)}${commandText}`;
    })
    .join(", ") + (checks.length > 6 ? `, ...${checks.length - 6} more` : "");
}

function formatCheckStatus(status: EvidenceCheckStatus): string {
  switch (status) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "not_run":
      return "not run";
    case "not_required":
      return "not required";
  }
}

function formatRisks(risks: EvidenceRisk[]): string {
  if (risks.length === 0) return "none";
  return risks
    .slice(0, 6)
    .map((risk) => risk.message)
    .join("; ") + (risks.length > 6 ? `; ...${risks.length - 6} more` : "");
}

function formatDiffSummary(diff: EvidenceDiffSummary): string {
  return `${diff.fileCount} ${diff.fileCount === 1 ? "file" : "files"}, +${diff.added}/-${diff.removed}${diff.truncated ? ", truncated" : ""}`;
}

function formatReviewActions(actions: DiffReviewActionRecord[]): string {
  return actions
    .slice(0, 6)
    .map((action) => `${action.summary}${action.status === "recorded" ? "" : ` (${action.status})`}`)
    .join("; ") + (actions.length > 6 ? `; ...${actions.length - 6} more` : "");
}
