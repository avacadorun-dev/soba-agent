export type ProveFormat = "text" | "markdown" | "json";

export interface EvidenceProofDocument {
  path: string;
  bundle: Record<string, unknown>;
}

export interface EvidenceProofReader {
  readEvidenceBundle(path: string): EvidenceProofDocument;
  readLatestEvidenceBundle(): EvidenceProofDocument | null;
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
  if (format === "markdown") {
    return renderProofMarkdown(proof);
  }
  return renderProofText(proof);
}

function renderProofText(proof: EvidenceProofDocument): string {
  const bundle = proof.bundle;
  return [
    "SOBA Proof",
    `Path: ${proof.path}`,
    `Status: ${stringField(bundle, "status", "unknown")}`,
    `Summary: ${stringField(bundle, "summary", "none")}`,
    `Session: ${stringField(bundle, "sessionId", "unknown")}`,
    `Turn: ${stringField(bundle, "turnId", "unknown")}`,
    `Created: ${stringField(bundle, "createdAt", "unknown")}`,
    `Changed files: ${formatChangedFiles(bundle.changedFiles)}`,
    `Claims: ${formatClaims(bundle.claims)}`,
    `Checks: ${formatChecks(bundle.checks, bundle.commands)}`,
    `Commands: ${formatCommands(bundle.commands)}`,
    `Permissions: ${formatApprovals(bundle.approvals)}`,
    `Risks: ${formatRisks(bundle.risks)}`,
  ].join("\n");
}

function renderProofMarkdown(proof: EvidenceProofDocument): string {
  const bundle = proof.bundle;
  return [
    "# SOBA Proof",
    "",
    `- Path: \`${proof.path}\``,
    `- Status: \`${stringField(bundle, "status", "unknown")}\``,
    `- Summary: ${stringField(bundle, "summary", "none")}`,
    `- Session: \`${stringField(bundle, "sessionId", "unknown")}\``,
    `- Turn: \`${stringField(bundle, "turnId", "unknown")}\``,
    `- Created: ${stringField(bundle, "createdAt", "unknown")}`,
    "",
    "## Changed Files",
    markdownList(bundle.changedFiles, formatChangedFile),
    "",
    "## Claims",
    markdownList(bundle.claims, formatClaim),
    "",
    "## Checks",
    markdownList(bundle.checks, (check) => formatCheck(check, bundle.commands)),
    "",
    "## Commands",
    markdownList(bundle.commands, formatCommand),
    "",
    "## Permissions",
    markdownList(bundle.approvals, formatApproval),
    "",
    "## Risks",
    markdownList(bundle.risks, formatRisk),
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

function formatChangedFiles(value: unknown): string {
  const files = arrayField(value);
  if (files.length === 0) return "none recorded";
  return files.map(formatChangedFile).join(", ");
}

function formatChangedFile(file: Record<string, unknown>): string {
  const path = stringField(file, "path", "unknown");
  const operation = stringField(file, "operation", "unknown");
  const added = numberField(file, "added");
  const removed = numberField(file, "removed");
  const stats = added !== undefined || removed !== undefined ? ` (+${added ?? 0}/-${removed ?? 0})` : "";
  return operation === "unknown" ? `${path}${stats}` : `${operation} ${path}${stats}`;
}

function formatClaims(value: unknown): string {
  const claims = arrayField(value);
  if (claims.length === 0) return "none recorded";
  return claims.map(formatClaim).join(", ");
}

function formatClaim(claim: Record<string, unknown>): string {
  const text = stringField(claim, "claim", "unnamed claim");
  const status = stringField(claim, "status", "unknown");
  const evidenceIds = stringArrayField(claim.evidenceIds);
  const refs = evidenceIds.length > 0 ? ` (${evidenceIds.join(", ")})` : "";
  return `${text} ${status}${refs}`;
}

function formatChecks(value: unknown, commandsValue: unknown): string {
  const checks = arrayField(value);
  if (checks.length === 0) return "none recorded";
  return checks.map((check) => formatCheck(check, commandsValue)).join(", ");
}

function formatCheck(check: Record<string, unknown>, commandsValue: unknown): string {
  const label = stringField(check, "label", "Check");
  const status = stringField(check, "status", "unknown");
  const command = commandForCheck(check, commandsValue);
  return command ? `${label} ${status} (${command})` : `${label} ${status}`;
}

function commandForCheck(check: Record<string, unknown>, commandsValue: unknown): string | undefined {
  const commandId = stringField(check, "commandId", "");
  if (!commandId) return undefined;
  return arrayField(commandsValue)
    .find((command) => stringField(command, "id", "") === commandId)
    ?.command as string | undefined;
}

function formatCommands(value: unknown): string {
  const commands = arrayField(value);
  if (commands.length === 0) return "none recorded";
  return commands.map(formatCommand).join(", ");
}

function formatCommand(command: Record<string, unknown>): string {
  const status = stringField(command, "status", "unknown");
  const text = stringField(command, "command", "unknown command");
  const exitCode = command.exitCode === null ? "null" : numberField(command, "exitCode")?.toString();
  const durationMs = numberField(command, "durationMs");
  const digest = stringField(command, "outputDigest", "");
  const parts = [`${text} ${status}`];
  if (exitCode !== undefined) parts.push(`exit=${exitCode}`);
  if (durationMs !== undefined) parts.push(`duration=${durationMs}ms`);
  if (digest) parts.push(`digest=${digest}`);
  return parts.join(" ");
}

function formatApprovals(value: unknown): string {
  const approvals = arrayField(value);
  if (approvals.length === 0) return "none recorded";
  return approvals.map(formatApproval).join(", ");
}

function formatApproval(approval: Record<string, unknown>): string {
  const decision = stringField(approval, "decision", "unknown");
  const trustLevel = stringField(approval, "trustLevel", "");
  const target = stringField(approval, "description", stringField(approval, "approvalValue", stringField(approval, "toolName", "unknown")));
  const reason = stringField(approval, "reason", "");
  const alternatives = arrayField(approval.alternatives);
  const parts = [target, decision];
  if (trustLevel) parts.push(`trust=${trustLevel}`);
  if (reason) parts.push(`reason=${reason}`);
  if (alternatives.length > 0) parts.push(`alternatives=${alternatives.length}`);
  return parts.join(" ");
}

function formatRisks(value: unknown): string {
  const risks = arrayField(value);
  if (risks.length === 0) return "none";
  return risks.map(formatRisk).join(", ");
}

function formatRisk(risk: Record<string, unknown>): string {
  const severity = stringField(risk, "severity", "unknown");
  const kind = stringField(risk, "kind", "risk");
  const message = stringField(risk, "message", "");
  return message ? `${severity} ${kind}: ${message}` : `${severity} ${kind}`;
}

function markdownList(value: unknown, formatter: (record: Record<string, unknown>) => string): string {
  const records = arrayField(value);
  if (records.length === 0) return "- none";
  return records.map((record) => `- ${formatter(record)}`).join("\n");
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
