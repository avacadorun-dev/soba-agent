export type VerifyFormat = "text" | "markdown" | "json";

export type ProofVerificationSeverity = "error" | "warning";

export interface EvidenceProofDocument {
  path: string;
  bundle: Record<string, unknown>;
}

export interface EvidenceProofReader {
  readEvidenceBundle(path: string): EvidenceProofDocument;
  readLatestEvidenceBundle(): EvidenceProofDocument | null;
}

export interface ProofVerificationIssue {
  severity: ProofVerificationSeverity;
  code: string;
  path: string;
  message: string;
}

export interface ProofVerificationResult {
  proofPath: string;
  valid: boolean;
  result: "valid" | "valid_with_warnings" | "invalid";
  summary: {
    errors: number;
    warnings: number;
    changedFiles: number;
    commands: number;
    checks: number;
    risks: number;
  };
  issues: ProofVerificationIssue[];
}

export type VerifyCommandView =
  | { kind: "usage"; message: string }
  | { kind: "empty"; evidenceDir?: string }
  | { kind: "error"; message: string }
  | { kind: "verification"; format: VerifyFormat; verification: ProofVerificationResult };

type ParsedVerifyArgs =
  | {
      kind: "parsed";
      target: "last";
      format: VerifyFormat;
    }
  | {
      kind: "parsed";
      target: "path";
      path: string;
      format: VerifyFormat;
    };

const BUNDLE_STATUSES = new Set(["verified", "partially_verified", "unverified", "blocked"]);
const CHANGED_FILE_OPERATIONS = new Set(["created", "modified", "deleted", "renamed", "unknown"]);
const COMMAND_STATUSES = new Set(["passed", "failed", "skipped", "running", "unknown"]);
const CHECK_STATUSES = new Set(["passed", "failed", "skipped", "not_run", "not_required"]);
const APPROVAL_DECISIONS = new Set(["deny", "once", "session", "repo", "full"]);
const RISK_SEVERITIES = new Set(["info", "warning", "error"]);
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function executeVerifyCommand(input: {
  args: string[];
  reader: EvidenceProofReader;
  evidenceDir?: string;
}): VerifyCommandView {
  const parsed = parseVerifyArgs(input.args);
  if (parsed.kind === "usage") return parsed;

  try {
    const proof = parsed.target === "last"
      ? input.reader.readLatestEvidenceBundle()
      : input.reader.readEvidenceBundle(parsed.path);
    if (!proof) return { kind: "empty", evidenceDir: input.evidenceDir };
    return {
      kind: "verification",
      format: parsed.format,
      verification: verifyEvidenceProof(proof),
    };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function renderVerifyCommandView(view: VerifyCommandView): string {
  switch (view.kind) {
    case "usage":
      return view.message;
    case "empty":
      return `No SOBA proof files found${view.evidenceDir ? ` in ${view.evidenceDir}` : ""}.`;
    case "error":
      return `Proof verification error: ${view.message}`;
    case "verification":
      return renderVerification(view.verification, view.format);
  }
}

export function verifyCommandExitCode(view: VerifyCommandView): number {
  if (view.kind !== "verification") return 1;
  return view.verification.valid ? 0 : 1;
}

export function verifyEvidenceProof(proof: EvidenceProofDocument): ProofVerificationResult {
  const issues: ProofVerificationIssue[] = [];
  const bundle = proof.bundle;

  validateTopLevel(bundle, issues);
  validateChangedFiles(bundle.changedFiles, issues);
  const commandIds = validateCommands(bundle.commands, issues);
  validateChecks(bundle.checks, commandIds, issues);
  validateApprovals(bundle.approvals, issues);
  validateRisks(bundle.risks, issues);
  validateStatusConsistency(bundle, issues);

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;

  return {
    proofPath: proof.path,
    valid: errors === 0,
    result: errors > 0 ? "invalid" : warnings > 0 ? "valid_with_warnings" : "valid",
    summary: {
      errors,
      warnings,
      changedFiles: arrayLength(bundle.changedFiles),
      commands: arrayLength(bundle.commands),
      checks: arrayLength(bundle.checks),
      risks: arrayLength(bundle.risks),
    },
    issues,
  };
}

function parseVerifyArgs(args: string[]): ParsedVerifyArgs | Extract<VerifyCommandView, { kind: "usage" }> {
  let target: "last" | "path" = "last";
  let path: string | undefined;
  let format: VerifyFormat = "text";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--last") {
      target = "last";
      path = undefined;
      continue;
    }
    if (arg === "--format") {
      const value = args[index + 1];
      if (!isVerifyFormat(value)) {
        return usage(`Invalid --format value "${value ?? ""}".`);
      }
      format = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (!isVerifyFormat(value)) {
        return usage(`Invalid --format value "${value}".`);
      }
      format = value;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return usage();
    }
    if (arg.startsWith("-")) {
      return usage(`Unknown verify flag "${arg}".`);
    }
    if (path) {
      return usage("Only one proof path can be provided.");
    }
    target = "path";
    path = arg;
  }

  if (target === "last") {
    return { kind: "parsed", target, format };
  }
  if (!path) {
    return usage("Missing proof path.");
  }
  return { kind: "parsed", target, path, format };
}

function usage(prefix?: string): Extract<VerifyCommandView, { kind: "usage" }> {
  const message = [
    prefix,
    "Usage: soba verify [--last|<path>] [--format text|markdown|json]",
    "Examples:",
    "  soba verify",
    "  soba verify --last --format json",
    "  soba verify .soba/evidence/2026-06-30T10-20-30Z-session-turn.soba-proof.json",
  ].filter(Boolean).join("\n");
  return { kind: "usage", message };
}

function isVerifyFormat(value: unknown): value is VerifyFormat {
  return value === "text" || value === "markdown" || value === "json";
}

function renderVerification(verification: ProofVerificationResult, format: VerifyFormat): string {
  if (format === "json") {
    return `${JSON.stringify(verification, null, 2)}\n`;
  }
  if (format === "markdown") {
    return renderVerificationMarkdown(verification);
  }
  return renderVerificationText(verification);
}

function renderVerificationText(verification: ProofVerificationResult): string {
  const lines = [
    "SOBA Proof Verification",
    `Path: ${verification.proofPath}`,
    `Result: ${verification.result}`,
    `Errors: ${verification.summary.errors}`,
    `Warnings: ${verification.summary.warnings}`,
    `Changed files: ${verification.summary.changedFiles}`,
    `Commands: ${verification.summary.commands}`,
    `Checks: ${verification.summary.checks}`,
    `Risks: ${verification.summary.risks}`,
  ];

  const errors = verification.issues.filter((issue) => issue.severity === "error");
  const warnings = verification.issues.filter((issue) => issue.severity === "warning");
  appendIssueLines(lines, "Error details", errors);
  appendIssueLines(lines, "Warning details", warnings);
  return lines.join("\n");
}

function renderVerificationMarkdown(verification: ProofVerificationResult): string {
  const errors = verification.issues.filter((issue) => issue.severity === "error");
  const warnings = verification.issues.filter((issue) => issue.severity === "warning");
  return [
    "# SOBA Proof Verification",
    "",
    `- Path: \`${verification.proofPath}\``,
    `- Result: \`${verification.result}\``,
    `- Errors: ${verification.summary.errors}`,
    `- Warnings: ${verification.summary.warnings}`,
    `- Changed files: ${verification.summary.changedFiles}`,
    `- Commands: ${verification.summary.commands}`,
    `- Checks: ${verification.summary.checks}`,
    `- Risks: ${verification.summary.risks}`,
    "",
    "## Errors",
    markdownIssues(errors),
    "",
    "## Warnings",
    markdownIssues(warnings),
    "",
  ].join("\n");
}

function appendIssueLines(lines: string[], title: string, issues: ProofVerificationIssue[]): void {
  lines.push(`${title}:`);
  if (issues.length === 0) {
    lines.push("  none");
    return;
  }
  for (const issue of issues) {
    lines.push(`  - [${issue.code}] ${issue.path}: ${issue.message}`);
  }
}

function markdownIssues(issues: ProofVerificationIssue[]): string {
  if (issues.length === 0) return "- none";
  return issues.map((issue) => `- \`${issue.code}\` at \`${issue.path}\`: ${issue.message}`).join("\n");
}

function validateTopLevel(bundle: Record<string, unknown>, issues: ProofVerificationIssue[]): void {
  if (bundle.version !== 1) {
    addError(issues, "invalid_version", "$.version", "Expected proof version 1.");
  }
  requireNonEmptyString(bundle, "sessionId", "$.sessionId", issues);
  requireNonEmptyString(bundle, "turnId", "$.turnId", issues);
  requireNonEmptyString(bundle, "summary", "$.summary", issues);
  const status = bundle.status;
  if (typeof status !== "string" || !BUNDLE_STATUSES.has(status)) {
    addError(issues, "invalid_status", "$.status", "Expected verified, partially_verified, unverified, or blocked.");
  }
  const createdAt = bundle.createdAt;
  if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) {
    addError(issues, "invalid_created_at", "$.createdAt", "Expected a parseable timestamp string.");
  }
  requireArray(bundle.changedFiles, "$.changedFiles", issues);
  requireArray(bundle.commands, "$.commands", issues);
  requireArray(bundle.checks, "$.checks", issues);
  requireArray(bundle.approvals, "$.approvals", issues);
  requireArray(bundle.risks, "$.risks", issues);
  requireArray(bundle.reviewActions, "$.reviewActions", issues);
  if (bundle.diff !== undefined && !isRecord(bundle.diff)) {
    addError(issues, "invalid_diff", "$.diff", "Expected diff to be an object when present.");
  }
}

function validateChangedFiles(value: unknown, issues: ProofVerificationIssue[]): void {
  forEachRecord(value, "$.changedFiles", issues, (file, path) => {
    requireNonEmptyString(file, "path", `${path}.path`, issues);
    const operation = file.operation;
    if (typeof operation !== "string" || !CHANGED_FILE_OPERATIONS.has(operation)) {
      addError(issues, "invalid_changed_file_operation", `${path}.operation`, "Expected a known changed-file operation.");
    }
    if (file.source !== undefined && typeof file.source !== "string") {
      addError(issues, "invalid_changed_file_source", `${path}.source`, "Expected source to be a string.");
    }
    if (file.added !== undefined && !isNonNegativeNumber(file.added)) {
      addError(issues, "invalid_added_count", `${path}.added`, "Expected a non-negative number.");
    }
    if (file.removed !== undefined && !isNonNegativeNumber(file.removed)) {
      addError(issues, "invalid_removed_count", `${path}.removed`, "Expected a non-negative number.");
    }
    if (file.mutationIds !== undefined && !isStringArray(file.mutationIds)) {
      addError(issues, "invalid_mutation_ids", `${path}.mutationIds`, "Expected an array of strings.");
    }
  });
}

function validateCommands(value: unknown, issues: ProofVerificationIssue[]): Set<string> {
  const ids = new Set<string>();
  forEachRecord(value, "$.commands", issues, (command, path) => {
    const id = stringField(command.id);
    if (!id) {
      addError(issues, "missing_command_id", `${path}.id`, "Expected a non-empty command id.");
    } else if (ids.has(id)) {
      addError(issues, "duplicate_command_id", `${path}.id`, `Duplicate command id "${id}".`);
    } else {
      ids.add(id);
    }
    requireNonEmptyString(command, "command", `${path}.command`, issues);
    const status = command.status;
    if (typeof status !== "string" || !COMMAND_STATUSES.has(status)) {
      addError(issues, "invalid_command_status", `${path}.status`, "Expected passed, failed, skipped, running, or unknown.");
    }
    if (command.exitCode !== undefined && command.exitCode !== null && !isInteger(command.exitCode)) {
      addError(issues, "invalid_exit_code", `${path}.exitCode`, "Expected an integer or null.");
    }
    if (status === "passed" && command.exitCode !== undefined && command.exitCode !== 0) {
      addError(issues, "passed_command_nonzero_exit", `${path}.exitCode`, "A passed command must have exitCode 0 when exitCode is recorded.");
    }
    if (status === "failed" && command.exitCode === 0) {
      addWarning(issues, "failed_command_zero_exit", `${path}.exitCode`, "A failed command recorded exitCode 0.");
    }
    if (command.durationMs !== undefined && !isNonNegativeNumber(command.durationMs)) {
      addError(issues, "invalid_duration", `${path}.durationMs`, "Expected a non-negative number.");
    }
    if (command.cwd !== undefined && typeof command.cwd !== "string") {
      addError(issues, "invalid_cwd", `${path}.cwd`, "Expected cwd to be a string.");
    }
    if (command.outputPreview !== undefined && typeof command.outputPreview !== "string") {
      addError(issues, "invalid_output_preview", `${path}.outputPreview`, "Expected outputPreview to be a string.");
    }
    if (command.outputDigest !== undefined) {
      if (typeof command.outputDigest !== "string" || !SHA256_DIGEST_PATTERN.test(command.outputDigest)) {
        addError(issues, "invalid_output_digest", `${path}.outputDigest`, "Expected sha256:<64 lowercase hex chars>.");
      }
    } else if (status === "passed" || status === "failed") {
      addWarning(issues, "missing_output_digest", `${path}.outputDigest`, "Command has a terminal status but no output digest.");
    }
  });
  return ids;
}

function validateChecks(value: unknown, commandIds: Set<string>, issues: ProofVerificationIssue[]): void {
  const ids = new Set<string>();
  forEachRecord(value, "$.checks", issues, (check, path) => {
    const id = stringField(check.id);
    if (!id) {
      addError(issues, "missing_check_id", `${path}.id`, "Expected a non-empty check id.");
    } else if (ids.has(id)) {
      addError(issues, "duplicate_check_id", `${path}.id`, `Duplicate check id "${id}".`);
    } else {
      ids.add(id);
    }
    requireNonEmptyString(check, "label", `${path}.label`, issues);
    const status = check.status;
    if (typeof status !== "string" || !CHECK_STATUSES.has(status)) {
      addError(issues, "invalid_check_status", `${path}.status`, "Expected passed, failed, skipped, not_run, or not_required.");
    }
    const commandId = stringField(check.commandId);
    if (commandId && !commandIds.has(commandId)) {
      addError(issues, "unknown_check_command", `${path}.commandId`, `No command with id "${commandId}" exists.`);
    }
  });
}

function validateApprovals(value: unknown, issues: ProofVerificationIssue[]): void {
  forEachRecord(value, "$.approvals", issues, (approval, path) => {
    requireNonEmptyString(approval, "toolCallId", `${path}.toolCallId`, issues);
    const decision = approval.decision;
    if (typeof decision !== "string" || !APPROVAL_DECISIONS.has(decision)) {
      addError(issues, "invalid_approval_decision", `${path}.decision`, "Expected deny, once, session, repo, or full.");
    }
    if (approval.reason !== undefined && typeof approval.reason !== "string") {
      addError(issues, "invalid_approval_reason", `${path}.reason`, "Expected reason to be a string.");
    }
  });
}

function validateRisks(value: unknown, issues: ProofVerificationIssue[]): void {
  forEachRecord(value, "$.risks", issues, (risk, path) => {
    requireNonEmptyString(risk, "id", `${path}.id`, issues);
    requireNonEmptyString(risk, "kind", `${path}.kind`, issues);
    requireNonEmptyString(risk, "message", `${path}.message`, issues);
    const severity = risk.severity;
    if (typeof severity !== "string" || !RISK_SEVERITIES.has(severity)) {
      addError(issues, "invalid_risk_severity", `${path}.severity`, "Expected info, warning, or error.");
    }
    if (!isStringArray(risk.evidenceIds)) {
      addError(issues, "invalid_risk_evidence_ids", `${path}.evidenceIds`, "Expected an array of strings.");
    }
  });
}

function validateStatusConsistency(bundle: Record<string, unknown>, issues: ProofVerificationIssue[]): void {
  const status = stringField(bundle.status);
  const checks = recordArray(bundle.checks);
  const commands = recordArray(bundle.commands);
  const risks = recordArray(bundle.risks);
  const changedFiles = recordArray(bundle.changedFiles);

  if (status === "verified") {
    if (risks.length > 0) {
      addWarning(issues, "verified_with_risks", "$.status", "Proof is marked verified but still records risks.");
    }
    if (checks.some((check) => ["failed", "skipped", "not_run"].includes(stringField(check.status)))) {
      addWarning(issues, "verified_with_unpassed_checks", "$.checks", "Proof is marked verified but includes checks that did not pass.");
    }
    if (changedFiles.length > 0 && checks.length === 0) {
      addWarning(issues, "verified_without_checks", "$.checks", "Proof changed files but records no checks.");
    }
  }

  const commandById = new Map<string, Record<string, unknown>>();
  for (const command of commands) {
    const id = stringField(command.id);
    if (id) commandById.set(id, command);
  }
  checks.forEach((check, index) => {
    const commandId = stringField(check.commandId);
    if (!commandId) return;
    const command = commandById.get(commandId);
    if (!command) return;
    const checkStatus = stringField(check.status);
    const commandStatus = stringField(command.status);
    if (checkStatus === "passed" && commandStatus !== "passed") {
      addError(
        issues,
        "passed_check_without_passed_command",
        `$.checks[${index}].commandId`,
        `Passed check references command "${commandId}" with status "${commandStatus || "unknown"}".`,
      );
    }
  });
}

function requireNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ProofVerificationIssue[],
): void {
  if (!stringField(record[key])) {
    addError(issues, `missing_${key}`, path, "Expected a non-empty string.");
  }
}

function requireArray(value: unknown, path: string, issues: ProofVerificationIssue[]): void {
  if (!Array.isArray(value)) {
    addError(issues, "invalid_array", path, "Expected an array.");
  }
}

function forEachRecord(
  value: unknown,
  path: string,
  issues: ProofVerificationIssue[],
  callback: (record: Record<string, unknown>, path: string) => void,
): void {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      addError(issues, "invalid_array_item", itemPath, "Expected an object.");
      return;
    }
    callback(item, itemPath);
  });
}

function addError(issues: ProofVerificationIssue[], code: string, path: string, message: string): void {
  issues.push({ severity: "error", code, path, message });
}

function addWarning(issues: ProofVerificationIssue[], code: string, path: string, message: string): void {
  issues.push({ severity: "warning", code, path, message });
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringField(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
