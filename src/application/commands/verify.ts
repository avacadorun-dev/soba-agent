import {
  containsPotentialProofSecret,
  PROOF_DIGEST_ALGORITHM,
  PROOF_ID_PREFIX,
  proofDigest,
  RUN_ID_PREFIX,
  stableRunId,
} from "../evidence/public";

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
  accepted: boolean;
  result: "valid" | "valid_with_warnings" | "invalid";
  outcome: "verified" | "partially_verified" | "unverified" | "blocked" | "invalid";
  reason: string;
  exitCode: 0 | 1 | 2 | 3 | 4;
  summary: {
    errors: number;
    warnings: number;
    evidence: number;
    claims: number;
    changedFiles: number;
    commands: number;
    checks: number;
    approvals: number;
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
const APPROVAL_DECISIONS = new Set(["auto", "deny", "once", "session", "repo", "full"]);
const APPROVAL_TRUST_LEVELS = new Set(["safe", "normal", "dangerous"]);
const APPROVAL_KINDS = new Set(["command", "tool"]);
const RISK_SEVERITIES = new Set(["info", "warning", "error"]);
const EVIDENCE_KINDS = new Set([
  "inspect",
  "search",
  "mutation",
  "diagnostic",
  "verification",
  "checkpoint",
  "reflection",
  "recovery_attempt",
  "finish_attempt",
]);
const EVIDENCE_STATUSES = new Set(["success", "failure", "active", "resolved", "unverified", "rejected"]);
const CLAIM_STATUSES = new Set(["supported", "unsupported", "unverified"]);
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
  return view.verification.exitCode;
}

export function verifyEvidenceProof(proof: EvidenceProofDocument): ProofVerificationResult {
  const issues: ProofVerificationIssue[] = [];
  const bundle = proof.bundle;

  validateContractMetadata(bundle, issues);
  validateTopLevel(bundle, issues);
  const evidenceIds = validateEvidenceIndex(bundle.evidence, issues);
  validateChangedFiles(bundle.changedFiles, issues);
  const commandIds = validateCommands(bundle.commands, issues);
  const checkIds = validateChecks(bundle.checks, commandIds, issues);
  validateApprovals(bundle.approvals, issues);
  validateMetrics(bundle.metrics, issues);
  const riskIds = validateRisks(bundle.risks, issues);
  validateClaims(bundle.claims, knownEvidenceIds(bundle, evidenceIds, commandIds, checkIds, riskIds), issues);
  validateEvidenceConsistency(bundle, issues);
  validateStatusConsistency(bundle, issues);

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const outcome = proofOutcome(bundle, issues);
  const exitCode = proofOutcomeExitCode(outcome);
  const legacyDowngrade = outcome === "partially_verified" &&
    stringField(bundle.status) === "verified" &&
    issues.some((issue) => issue.code === "legacy_unsealed_proof");

  return {
    proofPath: proof.path,
    valid: errors === 0,
    accepted: outcome === "verified",
    result: errors > 0 ? "invalid" : warnings > 0 ? "valid_with_warnings" : "valid",
    outcome,
    reason: errors > 0
      ? (issues.find((issue) => issue.severity === "error")?.code ?? "invalid_proof")
      : legacyDowngrade ? "legacy_unsealed_proof" : `proof_${outcome}`,
    exitCode,
    summary: {
      errors,
      warnings,
      evidence: arrayLength(bundle.evidence),
      claims: arrayLength(bundle.claims),
      changedFiles: arrayLength(bundle.changedFiles),
      commands: arrayLength(bundle.commands),
      checks: arrayLength(bundle.checks),
      approvals: arrayLength(bundle.approvals),
      risks: arrayLength(bundle.risks),
    },
    issues,
  };
}

function proofOutcome(
  bundle: Record<string, unknown>,
  issues: ProofVerificationIssue[],
): ProofVerificationResult["outcome"] {
  if (issues.some((issue) => issue.severity === "error")) return "invalid";
  const status = stringField(bundle.status);
  if (status === "verified" && issues.some((issue) => issue.code === "legacy_unsealed_proof")) {
    return "partially_verified";
  }
  return BUNDLE_STATUSES.has(status) ? status as Exclude<ProofVerificationResult["outcome"], "invalid"> : "invalid";
}

function proofOutcomeExitCode(outcome: ProofVerificationResult["outcome"]): ProofVerificationResult["exitCode"] {
  switch (outcome) {
    case "verified":
      return 0;
    case "invalid":
      return 1;
    case "partially_verified":
      return 2;
    case "unverified":
      return 3;
    case "blocked":
      return 4;
  }
}

function validateContractMetadata(bundle: Record<string, unknown>, issues: ProofVerificationIssue[]): void {
  const proofId = stringField(bundle.proofId);
  const runId = stringField(bundle.runId);
  const integrity = isRecord(bundle.integrity) ? bundle.integrity : undefined;
  const hasAnyMetadata = Boolean(proofId || runId || integrity);

  if (!hasAnyMetadata) {
    addWarning(
      issues,
      "legacy_unsealed_proof",
      "$.integrity",
      "Legacy proof has no content-integrity metadata; it remains readable but is not tamper-evident.",
    );
  } else if (!proofId || !runId || !integrity) {
    addError(issues, "incomplete_contract_metadata", "$", "proofId, runId, and integrity must be present together.");
  }

  if (proofId && !new RegExp(`^${PROOF_ID_PREFIX}[a-f0-9]{24}$`).test(proofId)) {
    addError(issues, "invalid_proof_id", "$.proofId", "Expected proof_<24 lowercase hex chars>.");
  }
  if (runId && !new RegExp(`^${RUN_ID_PREFIX}[a-f0-9]{24}$`).test(runId)) {
    addError(issues, "invalid_run_id", "$.runId", "Expected run_<24 lowercase hex chars>.");
  } else if (runId) {
    const expectedRunId = stableRunId(stringField(bundle.sessionId), stringField(bundle.turnId));
    if (runId !== expectedRunId) {
      addError(
        issues,
        "run_id_identity_mismatch",
        "$.runId",
        "Run ID is not derived from the proof sessionId and turnId.",
      );
    }
  }

  if (integrity) {
    if (integrity.algorithm !== PROOF_DIGEST_ALGORITHM) {
      addError(issues, "unsupported_digest_algorithm", "$.integrity.algorithm", "Expected sha256.");
    }
    const recordedDigest = stringField(integrity.digest);
    if (!SHA256_DIGEST_PATTERN.test(recordedDigest)) {
      addError(issues, "invalid_proof_digest", "$.integrity.digest", "Expected sha256:<64 lowercase hex chars>.");
    } else {
      const computedDigest = proofDigest(bundle);
      if (recordedDigest !== computedDigest) {
        addError(issues, "proof_digest_mismatch", "$.integrity.digest", "Proof content does not match its digest.");
      }
      const expectedProofId = `${PROOF_ID_PREFIX}${recordedDigest.slice("sha256:".length, "sha256:".length + 24)}`;
      if (proofId && proofId !== expectedProofId) {
        addError(issues, "proof_id_digest_mismatch", "$.proofId", "Proof ID is not derived from the recorded digest.");
      }
    }
  }

  if (containsPotentialProofSecret(bundle)) {
    addError(issues, "unredacted_secret", "$", "Proof contains a value that matches the secret-redaction contract.");
  }
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
    `Outcome: ${verification.outcome}`,
    `Reason: ${verification.reason}`,
    `Exit code: ${verification.exitCode}`,
    `Errors: ${verification.summary.errors}`,
    `Warnings: ${verification.summary.warnings}`,
    `Evidence: ${verification.summary.evidence}`,
    `Claims: ${verification.summary.claims}`,
    `Changed files: ${verification.summary.changedFiles}`,
    `Commands: ${verification.summary.commands}`,
    `Checks: ${verification.summary.checks}`,
    `Permissions: ${verification.summary.approvals}`,
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
    `- Outcome: \`${verification.outcome}\``,
    `- Reason: \`${verification.reason}\``,
    `- Exit code: ${verification.exitCode}`,
    `- Errors: ${verification.summary.errors}`,
    `- Warnings: ${verification.summary.warnings}`,
    `- Evidence: ${verification.summary.evidence}`,
    `- Claims: ${verification.summary.claims}`,
    `- Changed files: ${verification.summary.changedFiles}`,
    `- Commands: ${verification.summary.commands}`,
    `- Checks: ${verification.summary.checks}`,
    `- Permissions: ${verification.summary.approvals}`,
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
  requireOptionalArray(bundle.evidence, "$.evidence", "missing_evidence_index", "Proof has no evidence index; generated proofs should include one.", issues);
  requireOptionalArray(bundle.claims, "$.claims", "missing_claims", "Proof has no claim mapping; generated proofs should include claims.", issues);
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

function validateEvidenceIndex(value: unknown, issues: ProofVerificationIssue[]): Set<string> {
  const ids = new Set<string>();
  forEachRecord(value, "$.evidence", issues, (entry, path) => {
    const id = stringField(entry.id);
    if (!id) {
      addError(issues, "missing_evidence_id", `${path}.id`, "Expected a non-empty evidence id.");
    } else if (ids.has(id)) {
      addError(issues, "duplicate_evidence_id", `${path}.id`, `Duplicate evidence id "${id}".`);
    } else {
      ids.add(id);
    }
    const kind = entry.kind;
    if (typeof kind !== "string" || !EVIDENCE_KINDS.has(kind)) {
      addError(issues, "invalid_evidence_kind", `${path}.kind`, "Expected a known evidence kind.");
    }
    const status = entry.status;
    if (typeof status !== "string" || !EVIDENCE_STATUSES.has(status)) {
      addError(issues, "invalid_evidence_status", `${path}.status`, "Expected a known evidence status.");
    }
    requireNonEmptyString(entry, "summary", `${path}.summary`, issues);
    if (!isNonNegativeNumber(entry.timestamp)) {
      addError(issues, "invalid_evidence_timestamp", `${path}.timestamp`, "Expected a non-negative timestamp number.");
    }
    if (entry.toolCallId !== undefined && typeof entry.toolCallId !== "string") {
      addError(issues, "invalid_evidence_tool_call_id", `${path}.toolCallId`, "Expected toolCallId to be a string.");
    }
    if (entry.toolName !== undefined && typeof entry.toolName !== "string") {
      addError(issues, "invalid_evidence_tool_name", `${path}.toolName`, "Expected toolName to be a string.");
    }
    if (entry.command !== undefined && typeof entry.command !== "string") {
      addError(issues, "invalid_evidence_command", `${path}.command`, "Expected command to be a string.");
    }
    if (entry.files !== undefined && !isStringArray(entry.files)) {
      addError(issues, "invalid_evidence_files", `${path}.files`, "Expected an array of strings.");
    }
    if (entry.mutationIds !== undefined && !isStringArray(entry.mutationIds)) {
      addError(issues, "invalid_evidence_mutation_ids", `${path}.mutationIds`, "Expected an array of strings.");
    }
    if (entry.resolves !== undefined && !isStringArray(entry.resolves)) {
      addError(issues, "invalid_evidence_resolves", `${path}.resolves`, "Expected an array of strings.");
    }
  });
  return ids;
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

function validateEvidenceConsistency(bundle: Record<string, unknown>, issues: ProofVerificationIssue[]): void {
  // Pre-contract receipts did not persist the evidence index. They remain
  // readable with migration warnings, but cannot satisfy new linkage checks.
  if (!Array.isArray(bundle.evidence)) return;
  const evidence = recordArray(bundle.evidence);
  const evidenceById = new Map(evidence.map((entry) => [stringField(entry.id), entry]));
  const changedFiles = recordArray(bundle.changedFiles);

  changedFiles.forEach((file, fileIndex) => {
    const mutationIds = isStringArray(file.mutationIds) ? file.mutationIds : [];
    if (mutationIds.length === 0) {
      addError(
        issues,
        "changed_file_without_mutation",
        `$.changedFiles[${fileIndex}].mutationIds`,
        "Changed files must reference at least one mutation evidence ID.",
      );
    }
    for (const mutationId of mutationIds) {
      const mutation = evidenceById.get(mutationId);
      if (!mutation) {
        addError(
          issues,
          "unknown_changed_file_mutation",
          `$.changedFiles[${fileIndex}].mutationIds`,
          `No evidence with id "${mutationId}" exists.`,
        );
      } else if (stringField(mutation.kind) !== "mutation") {
        addError(
          issues,
          "changed_file_reference_not_mutation",
          `$.changedFiles[${fileIndex}].mutationIds`,
          `Evidence "${mutationId}" is not mutation evidence.`,
        );
      } else if (stringField(bundle.status) === "verified" && stringField(mutation.status) !== "success") {
        addError(
          issues,
          "verified_with_unverified_mutation",
          `$.changedFiles[${fileIndex}].mutationIds`,
          `Verified proof references mutation "${mutationId}" with status "${stringField(mutation.status) || "unknown"}".`,
        );
      }
    }
  });

  if (stringField(bundle.status) === "verified") {
    const codeMutationIds = new Set(
      changedFiles
        .filter((file) => !isDocumentationPath(stringField(file.path)))
        .flatMap((file) => (isStringArray(file.mutationIds) ? file.mutationIds : [])),
    );
    for (const mutationId of codeMutationIds) {
      const mutation = evidenceById.get(mutationId);
      if (!mutation) continue;
      const mutationTimestamp = numberField(mutation.timestamp);
      const mutationIndex = evidence.findIndex((entry) => stringField(entry.id) === mutationId);
      const hasFreshVerification = evidence.some(
        (entry, entryIndex) =>
          entryIndex > mutationIndex &&
          stringField(entry.kind) === "verification" &&
          stringField(entry.status) === "success" &&
          isStringArray(entry.mutationIds) &&
          entry.mutationIds.includes(mutationId) &&
          numberField(entry.timestamp) >= mutationTimestamp,
      );
      if (!hasFreshVerification) {
        addError(
          issues,
          "stale_or_missing_verification",
          "$.evidence",
          `Code mutation "${mutationId}" has no successful verification recorded after it.`,
        );
      }
    }

    const deniedToolCalls = new Set(
      recordArray(bundle.approvals)
        .filter((approval) => stringField(approval.decision) === "deny" || approval.approved === false)
        .map((approval) => stringField(approval.toolCallId))
        .filter(Boolean),
    );
    const bypassedCall = evidence.find(
      (entry) => deniedToolCalls.has(stringField(entry.toolCallId)) && stringField(entry.status) === "success",
    );
    if (bypassedCall) {
      addError(
        issues,
        "permission_denial_bypassed",
        "$.approvals",
        `Denied tool call "${stringField(bypassedCall.toolCallId)}" produced successful evidence.`,
      );
    }
  }

  if (changedFiles.length > 0 && !isRecord(bundle.diff) && isRecord(bundle.integrity)) {
    addError(issues, "missing_diff", "$.diff", "Sealed proofs with changed files must include a complete diff summary.");
  }

  if (isRecord(bundle.diff)) {
    const diffFiles = recordArray(bundle.diff.files);
    const changedPaths = new Set(changedFiles.map((file) => stringField(file.path)).filter(Boolean));
    const diffPaths = new Set(diffFiles.map((file) => stringField(file.path)).filter(Boolean));
    if (bundle.diff.fileCount !== diffFiles.length) {
      addError(issues, "diff_file_count_mismatch", "$.diff.fileCount", "Diff fileCount must equal diff.files length.");
    }
    const missingFromDiff = [...changedPaths].filter((path) => !diffPaths.has(path));
    const missingFromChangedFiles = [...diffPaths].filter((path) => !changedPaths.has(path));
    if (missingFromDiff.length > 0 || missingFromChangedFiles.length > 0) {
      addError(
        issues,
        "incomplete_diff",
        "$.diff.files",
        `Diff and changedFiles disagree${missingFromDiff.length ? `; absent from diff: ${missingFromDiff.join(", ")}` : ""}${missingFromChangedFiles.length ? `; absent from changedFiles: ${missingFromChangedFiles.join(", ")}` : ""}.`,
      );
    }
  }
}

function isDocumentationPath(path: string): boolean {
  return /(?:^|\/)(?:docs?|documentation)(?:\/|$)/i.test(path) || /\.(?:md|mdx|txt|rst|adoc)$/i.test(path);
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
    const terminal = status === "passed" || status === "failed";
    if (terminal && !isInteger(command.exitCode)) {
      addError(issues, "missing_exit_code", `${path}.exitCode`, "Terminal commands must include an integer exit code.");
    }
    if (status === "passed" && isInteger(command.exitCode) && command.exitCode !== 0) {
      addError(issues, "passed_command_nonzero_exit", `${path}.exitCode`, "A passed command must have exitCode 0 when exitCode is recorded.");
    }
    if (status === "failed" && command.exitCode === 0) {
      addError(issues, "failed_command_zero_exit", `${path}.exitCode`, "A failed command cannot record exitCode 0.");
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
    if (command.outputTruncated !== undefined && typeof command.outputTruncated !== "boolean") {
      addError(issues, "invalid_output_truncated", `${path}.outputTruncated`, "Expected outputTruncated to be a boolean.");
    }
    if (command.outputDigest !== undefined) {
      if (typeof command.outputDigest !== "string" || !SHA256_DIGEST_PATTERN.test(command.outputDigest)) {
        addError(issues, "invalid_output_digest", `${path}.outputDigest`, "Expected sha256:<64 lowercase hex chars>.");
      }
    } else if (terminal) {
      addError(issues, "missing_output_digest", `${path}.outputDigest`, "Terminal commands must include an output digest.");
    }
  });
  return ids;
}

function validateChecks(value: unknown, commandIds: Set<string>, issues: ProofVerificationIssue[]): Set<string> {
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
  return ids;
}

function validateApprovals(value: unknown, issues: ProofVerificationIssue[]): void {
  forEachRecord(value, "$.approvals", issues, (approval, path) => {
    requireNonEmptyString(approval, "toolCallId", `${path}.toolCallId`, issues);
    if (approval.toolName !== undefined && typeof approval.toolName !== "string") {
      addError(issues, "invalid_approval_tool_name", `${path}.toolName`, "Expected toolName to be a string.");
    }
    const decision = approval.decision;
    if (typeof decision !== "string" || !APPROVAL_DECISIONS.has(decision)) {
      addError(issues, "invalid_approval_decision", `${path}.decision`, "Expected auto, deny, once, session, repo, or full.");
    }
    if (approval.approved !== undefined && typeof approval.approved !== "boolean") {
      addError(issues, "invalid_approval_approved", `${path}.approved`, "Expected approved to be a boolean.");
    }
    if (decision === "deny" && approval.approved === true) {
      addError(issues, "approved_denial", path, "A denied permission cannot be marked approved.");
    }
    if (approval.trustLevel !== undefined) {
      if (typeof approval.trustLevel !== "string" || !APPROVAL_TRUST_LEVELS.has(approval.trustLevel)) {
        addError(issues, "invalid_approval_trust_level", `${path}.trustLevel`, "Expected safe, normal, or dangerous.");
      }
    }
    if (approval.approvalKind !== undefined) {
      if (typeof approval.approvalKind !== "string" || !APPROVAL_KINDS.has(approval.approvalKind)) {
        addError(issues, "invalid_approval_kind", `${path}.approvalKind`, "Expected command or tool.");
      }
    }
    if (approval.approvalValue !== undefined && typeof approval.approvalValue !== "string") {
      addError(issues, "invalid_approval_value", `${path}.approvalValue`, "Expected approvalValue to be a string.");
    }
    if (approval.description !== undefined && typeof approval.description !== "string") {
      addError(issues, "invalid_approval_description", `${path}.description`, "Expected description to be a string.");
    }
    if (approval.reason !== undefined && typeof approval.reason !== "string") {
      addError(issues, "invalid_approval_reason", `${path}.reason`, "Expected reason to be a string.");
    }
    validateApprovalAlternatives(approval.alternatives, `${path}.alternatives`, issues);
  });
}

function validateMetrics(value: unknown, issues: ProofVerificationIssue[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    addError(issues, "invalid_metrics", "$.metrics", "Expected metrics to be an object.");
    return;
  }
  if (!isNonNegativeInteger(value.modelCalls)) {
    addError(issues, "invalid_model_calls", "$.metrics.modelCalls", "Expected a non-negative integer.");
  }
  if (!isRecord(value.tokens)) {
    addError(issues, "invalid_token_metrics", "$.metrics.tokens", "Expected token metrics to be an object.");
    return;
  }
  for (const field of ["input", "output", "total"] as const) {
    if (!isNonNegativeInteger(value.tokens[field])) {
      addError(issues, "invalid_token_metric", `$.metrics.tokens.${field}`, "Expected a non-negative integer.");
    }
  }
}

function validateApprovalAlternatives(value: unknown, path: string, issues: ProofVerificationIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    addError(issues, "invalid_approval_alternatives", path, "Expected alternatives to be an array.");
    return;
  }
  forEachRecord(value, path, issues, (alternative, alternativePath) => {
    requireNonEmptyString(alternative, "id", `${alternativePath}.id`, issues);
    requireNonEmptyString(alternative, "title", `${alternativePath}.title`, issues);
    requireNonEmptyString(alternative, "reason", `${alternativePath}.reason`, issues);
    if (alternative.command !== undefined && typeof alternative.command !== "string") {
      addError(issues, "invalid_approval_alternative_command", `${alternativePath}.command`, "Expected command to be a string.");
    }
  });
}

function validateRisks(value: unknown, issues: ProofVerificationIssue[]): Set<string> {
  const ids = new Set<string>();
  forEachRecord(value, "$.risks", issues, (risk, path) => {
    const id = stringField(risk.id);
    if (!id) {
      addError(issues, "missing_risk_id", `${path}.id`, "Expected a non-empty risk id.");
    } else if (ids.has(id)) {
      addError(issues, "duplicate_risk_id", `${path}.id`, `Duplicate risk id "${id}".`);
    } else {
      ids.add(id);
    }
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
  return ids;
}

function validateClaims(value: unknown, knownIds: Set<string>, issues: ProofVerificationIssue[]): void {
  const ids = new Set<string>();
  forEachRecord(value, "$.claims", issues, (claim, path) => {
    const id = stringField(claim.id);
    if (!id) {
      addError(issues, "missing_claim_id", `${path}.id`, "Expected a non-empty claim id.");
    } else if (ids.has(id)) {
      addError(issues, "duplicate_claim_id", `${path}.id`, `Duplicate claim id "${id}".`);
    } else {
      ids.add(id);
    }
    requireNonEmptyString(claim, "claim", `${path}.claim`, issues);
    const status = claim.status;
    if (typeof status !== "string" || !CLAIM_STATUSES.has(status)) {
      addError(issues, "invalid_claim_status", `${path}.status`, "Expected supported, unsupported, or unverified.");
    }
    if (!isStringArray(claim.evidenceIds)) {
      addError(issues, "invalid_claim_evidence_ids", `${path}.evidenceIds`, "Expected an array of strings.");
      return;
    }
    const unknownIds = claim.evidenceIds.filter((evidenceId) => !knownIds.has(evidenceId));
    if (unknownIds.length > 0) {
      addError(
        issues,
        "unknown_claim_evidence",
        `${path}.evidenceIds`,
        `Claim references unknown evidence id(s): ${unknownIds.join(", ")}.`,
      );
    }
    if (status === "supported" && claim.evidenceIds.length === 0) {
      addError(issues, "supported_claim_without_evidence", `${path}.evidenceIds`, "Supported claims must reference evidence.");
    }
    if (status !== "supported") {
      addWarning(issues, "claim_not_supported", `${path}.status`, `Claim "${id || "unknown"}" is ${status || "unknown"}.`);
    }
  });
}

function validateStatusConsistency(bundle: Record<string, unknown>, issues: ProofVerificationIssue[]): void {
  const status = stringField(bundle.status);
  const checks = recordArray(bundle.checks);
  const commands = recordArray(bundle.commands);
  const risks = recordArray(bundle.risks);
  const changedFiles = recordArray(bundle.changedFiles);
  const claims = recordArray(bundle.claims);

  if (status === "verified") {
    if (risks.length > 0) {
      addError(issues, "verified_with_risks", "$.status", "Proof is marked verified but still records risks.");
    }
    if (checks.some((check) => ["failed", "skipped", "not_run"].includes(stringField(check.status)))) {
      addError(issues, "verified_with_unpassed_checks", "$.checks", "Proof is marked verified but includes checks that did not pass.");
    }
    if (changedFiles.length > 0 && checks.length === 0) {
      addError(issues, "verified_without_checks", "$.checks", "Proof changed files but records no checks.");
    }
    if (claims.some((claim) => stringField(claim.status) !== "supported")) {
      addError(issues, "verified_with_unsupported_claims", "$.claims", "Verified proofs may contain only supported claims.");
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

function knownEvidenceIds(
  bundle: Record<string, unknown>,
  evidenceIds: Set<string>,
  commandIds: Set<string>,
  checkIds: Set<string>,
  riskIds: Set<string>,
): Set<string> {
  return new Set([
    ...evidenceIds,
    ...commandIds,
    ...checkIds,
    ...riskIds,
    ...recordArray(bundle.changedFiles).flatMap((file) => isStringArray(file.mutationIds) ? file.mutationIds : []),
  ]);
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

function requireOptionalArray(
  value: unknown,
  path: string,
  missingCode: string,
  missingMessage: string,
  issues: ProofVerificationIssue[],
): void {
  if (value === undefined) {
    addWarning(issues, missingCode, path, missingMessage);
    return;
  }
  requireArray(value, path, issues);
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

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
