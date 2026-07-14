import {
  containsPotentialProofSecret,
  PROOF_DIGEST_ALGORITHM,
  PROOF_ID_PREFIX,
  proofDigest,
  stableRunId,
} from "../evidence/public";

export type ProveFormat = "text" | "markdown" | "json";

export interface EvidenceProofDocument {
  path: string;
  bundle: Record<string, unknown>;
}

export interface EvidenceProofReader {
  readEvidenceBundle(path: string): EvidenceProofDocument;
  readLatestEvidenceBundle(): EvidenceProofDocument | null;
}

type HandoffFreshness = "fresh" | "partial" | "stale" | "unknown" | "not_applicable";

interface VerifiedHandoffReport {
  proofPath: string;
  summary: string;
  observed: {
    changedPaths: Array<{
      path: string;
      operation: string;
      added?: number;
      removed?: number;
      mutationIds: string[];
    }>;
    checks: Array<{
      id: string;
      label: string;
      status: string;
      command?: string;
      exitCode?: number | null;
      outputDigest?: string;
      outputTruncated: boolean;
      freshness: HandoffFreshness;
    }>;
    privilegedActions: Array<{
      toolCallId: string;
      target: string;
      decision: string;
      trustLevel?: string;
      approved?: boolean;
    }>;
  };
  declared: {
    producerStatus: string;
    claims: Array<{
      id: string;
      text: string;
      linkStatus: "linked" | "unlinked" | "invalid_reference";
      evidenceIds: string[];
      verification: "requires_human_review";
    }>;
  };
  unknown: Array<{
    code: string;
    message: string;
    subjectId?: string;
  }>;
  integrity: {
    status: "verified" | "invalid" | "legacy_unsealed";
    proofId: string;
    runId: string;
    digest: string;
  };
}

export type ProveCommandView =
  | { kind: "usage"; message: string }
  | { kind: "empty"; evidenceDir?: string }
  | { kind: "error"; message: string }
  | { kind: "proof"; format: ProveFormat; proof: EvidenceProofDocument };

type ParsedProveArgs =
  | {
      kind: "parsed";
      target: "last";
      format: ProveFormat;
    }
  | {
      kind: "parsed";
      target: "path";
      path: string;
      format: ProveFormat;
    };

export function executeProveCommand(input: {
  args: string[];
  reader: EvidenceProofReader;
  evidenceDir?: string;
}): ProveCommandView {
  const parsed = parseProveArgs(input.args);
  if (parsed.kind === "usage") return parsed;

  try {
    const proof = parsed.target === "last"
      ? input.reader.readLatestEvidenceBundle()
      : input.reader.readEvidenceBundle(parsed.path);
    if (!proof) return { kind: "empty", evidenceDir: input.evidenceDir };
    return { kind: "proof", format: parsed.format, proof };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function renderProveCommandView(view: ProveCommandView): string {
  switch (view.kind) {
    case "usage":
      return view.message;
    case "empty":
      return `No SOBA proof files found${view.evidenceDir ? ` in ${view.evidenceDir}` : ""}.`;
    case "error":
      return `Proof error: ${view.message}`;
    case "proof":
      return renderProof(view.proof, view.format);
  }
}

export function proveCommandExitCode(view: ProveCommandView): number {
  return view.kind === "proof" ? 0 : 1;
}

function parseProveArgs(args: string[]): ParsedProveArgs | Extract<ProveCommandView, { kind: "usage" }> {
  let target: "last" | "path" = "last";
  let path: string | undefined;
  let format: ProveFormat = "text";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--last") {
      target = "last";
      path = undefined;
      continue;
    }
    if (arg === "--format") {
      const value = args[index + 1];
      if (!isProveFormat(value)) {
        return usage(`Invalid --format value "${value ?? ""}".`);
      }
      format = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (!isProveFormat(value)) {
        return usage(`Invalid --format value "${value}".`);
      }
      format = value;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return usage();
    }
    if (arg.startsWith("-")) {
      return usage(`Unknown prove flag "${arg}".`);
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

function usage(prefix?: string): Extract<ProveCommandView, { kind: "usage" }> {
  const message = [
    prefix,
    "Usage: soba prove [--last|<path>] [--format text|markdown|json]",
    "Examples:",
    "  soba prove",
    "  soba prove --last --format markdown",
    "  soba prove .soba/evidence/2026-06-30T10-20-30Z-session-turn.soba-proof.json",
  ].filter(Boolean).join("\n");
  return { kind: "usage", message };
}

function isProveFormat(value: unknown): value is ProveFormat {
  return value === "text" || value === "markdown" || value === "json";
}

function renderProof(proof: EvidenceProofDocument, format: ProveFormat): string {
  if (format === "json") {
    return `${JSON.stringify({ proofPath: proof.path, ...proof.bundle }, null, 2)}\n`;
  }
  const handoff = buildVerifiedHandoffReport(proof);
  if (format === "markdown") {
    return renderProofMarkdown(handoff);
  }
  return renderProofText(handoff);
}

function buildVerifiedHandoffReport(proof: EvidenceProofDocument): VerifiedHandoffReport {
  const bundle = proof.bundle;
  const evidence = arrayField(bundle.evidence);
  const commands = arrayField(bundle.commands);
  const checks = arrayField(bundle.checks).map((check) => handoffCheck(check, commands, evidence, bundle.changedFiles));
  const claims = handoffClaims(bundle);
  const integrity = assessIntegrity(bundle);
  const unknown = collectUnknown(bundle, claims, checks, integrity);

  return {
    proofPath: proof.path,
    summary: stringField(bundle, "summary", "none"),
    observed: {
      changedPaths: arrayField(bundle.changedFiles).map((file) => ({
        path: stringField(file, "path", "unknown"),
        operation: stringField(file, "operation", "unknown"),
        ...(numberField(file, "added") !== undefined ? { added: numberField(file, "added") } : {}),
        ...(numberField(file, "removed") !== undefined ? { removed: numberField(file, "removed") } : {}),
        mutationIds: stringArrayField(file.mutationIds),
      })),
      checks,
      privilegedActions: arrayField(bundle.approvals)
        .filter(isPrivilegedApproval)
        .map((approval) => ({
          toolCallId: stringField(approval, "toolCallId", "unknown"),
          target: approvalTarget(approval),
          decision: stringField(approval, "decision", "unknown"),
          ...(stringField(approval, "trustLevel", "") ? { trustLevel: stringField(approval, "trustLevel", "") } : {}),
          ...(typeof approval.approved === "boolean" ? { approved: approval.approved } : {}),
        })),
    },
    declared: {
      producerStatus: stringField(bundle, "status", "unknown"),
      claims,
    },
    unknown,
    integrity,
  };
}

function renderProofText(report: VerifiedHandoffReport): string {
  return [
    "SOBA Verified Handoff",
    `Summary: ${report.summary}`,
    `Path: ${report.proofPath}`,
    "",
    "Observed",
    `Changed paths: ${report.observed.changedPaths.length > 0 ? report.observed.changedPaths.map(formatHandoffChangedPath).join(", ") : "none recorded"}`,
    `Checks: ${report.observed.checks.length > 0 ? report.observed.checks.map(formatHandoffCheck).join("; ") : "none recorded"}`,
    `Privileged actions: ${report.observed.privilegedActions.length > 0 ? report.observed.privilegedActions.map(formatHandoffAction).join("; ") : "none recorded"}`,
    "",
    "Declared",
    `Producer status: ${report.declared.producerStatus} (declaration, not an independent verdict)`,
    `Claims: ${report.declared.claims.length > 0 ? report.declared.claims.map(formatHandoffClaim).join("; ") : "none recorded"}`,
    "",
    "Unknown",
    ...(report.unknown.length > 0 ? report.unknown.map((item) => `- ${item.message}`) : ["- none recorded"]),
    "",
    "Integrity",
    `Status: ${report.integrity.status}`,
    `Proof ID: ${report.integrity.proofId}`,
    `Run ID: ${report.integrity.runId}`,
    `Receipt digest: ${report.integrity.digest}`,
    "",
    "CI remains the source of truth for merge; this report describes what SOBA observed before handoff.",
  ].join("\n");
}

function renderProofMarkdown(report: VerifiedHandoffReport): string {
  return [
    "# SOBA Verified Handoff",
    "",
    `**Summary:** ${report.summary}`,
    "",
    "## Observed",
    "",
    "### Changed paths",
    report.observed.changedPaths.length > 0
      ? report.observed.changedPaths.map((file) => `- ${formatHandoffChangedPath(file)}`).join("\n")
      : "- none recorded",
    "",
    "### Checks and exit codes",
    report.observed.checks.length > 0
      ? report.observed.checks.map((check) => `- ${formatHandoffCheck(check)}`).join("\n")
      : "- none recorded",
    "",
    "### Privileged actions",
    report.observed.privilegedActions.length > 0
      ? report.observed.privilegedActions.map((action) => `- ${formatHandoffAction(action)}`).join("\n")
      : "- none recorded",
    "",
    "## Declared",
    "",
    `- Producer status: \`${report.declared.producerStatus}\` — declaration, not an independent verdict`,
    ...(report.declared.claims.length > 0
      ? report.declared.claims.map((claim) => `- ${formatHandoffClaim(claim)}`)
      : ["- Claims: none recorded"]),
    "",
    "## Unknown / unresolved claims",
    "",
    ...(report.unknown.length > 0 ? report.unknown.map((item) => `- ${item.message}`) : ["- none recorded"]),
    "",
    "## Integrity",
    "",
    `- Status: \`${report.integrity.status}\``,
    `- Proof ID: \`${report.integrity.proofId}\``,
    `- Run ID: \`${report.integrity.runId}\``,
    `- Receipt digest: \`${report.integrity.digest}\``,
    `- Receipt path: \`${report.proofPath}\``,
    "",
    "> CI remains the source of truth for merge. This report describes what SOBA observed before handoff; linked narrative claims still require human review.",
    "",
  ].join("\n");
}

function stringField(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function arrayField(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function handoffClaims(bundle: Record<string, unknown>): VerifiedHandoffReport["declared"]["claims"] {
  const knownIds = new Set([
    ...arrayField(bundle.evidence).map((entry) => stringField(entry, "id", "")),
    ...arrayField(bundle.commands).map((command) => stringField(command, "id", "")),
    ...arrayField(bundle.checks).map((check) => stringField(check, "id", "")),
    ...arrayField(bundle.changedFiles).flatMap((file) => stringArrayField(file.mutationIds)),
    ...arrayField(bundle.risks).map((risk) => stringField(risk, "id", "")),
  ].filter(Boolean));

  return arrayField(bundle.claims).map((claim, index) => {
    const evidenceIds = stringArrayField(claim.evidenceIds);
    const hasInvalidReference = evidenceIds.some((id) => !knownIds.has(id));
    return {
      id: stringField(claim, "id", `claim_${index + 1}`),
      text: stringField(claim, "claim", "unnamed claim"),
      linkStatus: hasInvalidReference ? "invalid_reference" : evidenceIds.length > 0 ? "linked" : "unlinked",
      evidenceIds,
      verification: "requires_human_review",
    };
  });
}

function handoffCheck(
  check: Record<string, unknown>,
  commands: Record<string, unknown>[],
  evidence: Record<string, unknown>[],
  changedFilesValue: unknown,
): VerifiedHandoffReport["observed"]["checks"][number] {
  const commandId = stringField(check, "commandId", "");
  const command = commands.find((candidate) => stringField(candidate, "id", "") === commandId);
  const exitCode = command?.exitCode === null ? null : command ? numberField(command, "exitCode") : undefined;
  return {
    id: stringField(check, "id", "unknown"),
    label: stringField(check, "label", "Check"),
    status: stringField(check, "status", "unknown"),
    ...(command ? { command: stringField(command, "command", "unknown command") } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(command && stringField(command, "outputDigest", "") ? { outputDigest: stringField(command, "outputDigest", "") } : {}),
    outputTruncated: command?.outputTruncated === true || stringField(command ?? {}, "outputPreview", "").includes("[Evidence output preview truncated]"),
    freshness: checkFreshness(check, command, evidence, changedFilesValue),
  };
}

function checkFreshness(
  check: Record<string, unknown>,
  command: Record<string, unknown> | undefined,
  evidence: Record<string, unknown>[],
  changedFilesValue: unknown,
): HandoffFreshness {
  if (stringField(check, "status", "unknown") !== "passed") return "not_applicable";
  const mutationIds = uniqueStrings(arrayField(changedFilesValue).flatMap((file) => stringArrayField(file.mutationIds)));
  if (mutationIds.length === 0) return "not_applicable";

  const checkId = stringField(check, "id", "");
  const expectedEvidenceId = checkId.startsWith("check_") ? checkId.slice("check_".length) : "";
  const toolCallId = command ? stringField(command, "toolCallId", "") : "";
  const commandText = command ? stringField(command, "command", "") : "";
  const verificationIndex = evidence.findIndex((entry) =>
    stringField(entry, "id", "") === expectedEvidenceId ||
    (toolCallId.length > 0 && stringField(entry, "toolCallId", "") === toolCallId) ||
    (commandText.length > 0 && stringField(entry, "kind", "") === "verification" && stringField(entry, "command", "") === commandText)
  );
  if (verificationIndex < 0) return "unknown";

  const verification = evidence[verificationIndex];
  const covered = new Set(stringArrayField(verification.mutationIds));
  if (covered.size === 0) return "unknown";
  const verificationTimestamp = numberField(verification, "timestamp") ?? 0;
  const relatedMutationIds = uniqueStrings(arrayField(changedFilesValue)
    .filter((file) => stringArrayField(file.mutationIds).some((id) => covered.has(id)))
    .flatMap((file) => stringArrayField(file.mutationIds)));
  const freshnessScope = relatedMutationIds.length > 0
    ? relatedMutationIds
    : mutationIds.filter((id) => covered.has(id));
  if (freshnessScope.length === 0) return "unknown";
  const mutationEntries = freshnessScope.map((id) => ({
    id,
    index: evidence.findIndex((entry) => stringField(entry, "id", "") === id),
  }));
  if (mutationEntries.some(({ index }) => index > verificationIndex)) return "stale";
  if (mutationEntries.some(({ index }) => index >= 0 && (numberField(evidence[index], "timestamp") ?? 0) > verificationTimestamp)) {
    return "stale";
  }
  const coveredCount = mutationEntries.filter(({ id }) => covered.has(id)).length;
  if (coveredCount === freshnessScope.length) return "fresh";
  if (coveredCount > 0) return "partial";
  return "unknown";
}

function collectUnknown(
  bundle: Record<string, unknown>,
  claims: VerifiedHandoffReport["declared"]["claims"],
  checks: VerifiedHandoffReport["observed"]["checks"],
  integrity: VerifiedHandoffReport["integrity"],
): VerifiedHandoffReport["unknown"] {
  const items: VerifiedHandoffReport["unknown"] = [];
  for (const claim of claims) {
    const message = claim.linkStatus === "linked"
      ? `Claim "${claim.text}" is linked to evidence but still requires human review.`
      : claim.linkStatus === "unlinked"
        ? `Claim "${claim.text}" has no evidence link.`
        : `Claim "${claim.text}" references unknown evidence.`;
    items.push({ code: `claim_${claim.linkStatus}`, message, subjectId: claim.id });
  }
  for (const check of checks) {
    if (["failed", "skipped", "not_run"].includes(check.status)) {
      items.push({ code: `check_${check.status}`, message: `${check.label} is ${check.status.replace("_", " ")}.`, subjectId: check.id });
    }
    if (["stale", "partial", "unknown"].includes(check.freshness)) {
      items.push({
        code: `check_freshness_${check.freshness}`,
        message: `${check.label} has ${check.freshness} freshness relative to recorded mutations.`,
        subjectId: check.id,
      });
    }
    if (check.outputTruncated) {
      items.push({ code: "check_output_truncated", message: `${check.label} has truncated command output.`, subjectId: check.id });
    }
  }
  for (const risk of arrayField(bundle.risks)) {
    items.push({
      code: stringField(risk, "kind", "reported_risk"),
      message: stringField(risk, "message", "A producer-reported risk remains."),
      subjectId: stringField(risk, "id", "") || undefined,
    });
  }
  if (integrity.status !== "verified") {
    items.push({
      code: integrity.status === "invalid" ? "receipt_integrity_invalid" : "legacy_unsealed_receipt",
      message: integrity.status === "invalid" ? "Receipt integrity could not be verified." : "Receipt predates sealing metadata; integrity is unknown.",
    });
  }
  return deduplicateUnknown(items);
}

function assessIntegrity(bundle: Record<string, unknown>): VerifiedHandoffReport["integrity"] {
  const proofId = stringField(bundle, "proofId", "legacy-unsealed");
  const runId = stringField(bundle, "runId", "legacy-unsealed");
  const integrity = isRecord(bundle.integrity) ? bundle.integrity : undefined;
  const digest = integrity ? stringField(integrity, "digest", "legacy-unsealed") : "legacy-unsealed";
  if (!integrity || proofId === "legacy-unsealed" || runId === "legacy-unsealed") {
    return { status: "legacy_unsealed", proofId, runId, digest };
  }

  try {
    const expectedDigest = proofDigest(bundle);
    const expectedProofId = `${PROOF_ID_PREFIX}${expectedDigest.slice("sha256:".length, "sha256:".length + 24)}`;
    const expectedRunId = stableRunId(stringField(bundle, "sessionId", ""), stringField(bundle, "turnId", ""));
    const valid = stringField(integrity, "algorithm", "") === PROOF_DIGEST_ALGORITHM &&
      /^sha256:[a-f0-9]{64}$/.test(digest) &&
      digest === expectedDigest &&
      proofId === expectedProofId &&
      runId === expectedRunId &&
      !containsPotentialProofSecret(bundle);
    return { status: valid ? "verified" : "invalid", proofId, runId, digest };
  } catch {
    return { status: "invalid", proofId, runId, digest };
  }
}

function isPrivilegedApproval(approval: Record<string, unknown>): boolean {
  return stringField(approval, "decision", "auto") !== "auto" || stringField(approval, "trustLevel", "") === "dangerous";
}

function approvalTarget(approval: Record<string, unknown>): string {
  return stringField(
    approval,
    "description",
    stringField(approval, "approvalValue", stringField(approval, "toolName", stringField(approval, "toolCallId", "unknown"))),
  );
}

function formatHandoffChangedPath(file: VerifiedHandoffReport["observed"]["changedPaths"][number]): string {
  const stats = file.added !== undefined || file.removed !== undefined ? ` (+${file.added ?? 0}/-${file.removed ?? 0})` : "";
  return file.operation === "unknown" ? `${file.path}${stats}` : `${file.operation} ${file.path}${stats}`;
}

function formatHandoffCheck(check: VerifiedHandoffReport["observed"]["checks"][number]): string {
  const parts = [`${check.label}: ${check.status}`];
  if (check.command) parts.push(`command=\`${check.command}\``);
  if (check.exitCode !== undefined) parts.push(`exit=${check.exitCode ?? "null"}`);
  parts.push(`freshness=${check.freshness}`);
  if (check.outputDigest) parts.push(`output=${check.outputDigest}`);
  if (check.outputTruncated) parts.push("output-truncated");
  return parts.join("; ");
}

function formatHandoffAction(action: VerifiedHandoffReport["observed"]["privilegedActions"][number]): string {
  return `${action.target}: ${action.decision}${action.trustLevel ? `; trust=${action.trustLevel}` : ""}`;
}

function formatHandoffClaim(claim: VerifiedHandoffReport["declared"]["claims"][number]): string {
  const refs = claim.evidenceIds.length > 0 ? `; evidence=${claim.evidenceIds.join(", ")}` : "";
  return `${claim.text}: ${claim.linkStatus}; human review required${refs}`;
}

function deduplicateUnknown(items: VerifiedHandoffReport["unknown"]): VerifiedHandoffReport["unknown"] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.code}:${item.subjectId ?? ""}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
