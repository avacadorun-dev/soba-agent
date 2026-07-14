export type ExplainClaimFormat = "text" | "markdown" | "json";

export interface EvidenceProofDocument {
  path: string;
  bundle: Record<string, unknown>;
}

export interface EvidenceProofReader {
  readEvidenceBundle(path: string): EvidenceProofDocument;
  readLatestEvidenceBundle(): EvidenceProofDocument | null;
}

export interface ExplainedClaimEvidence {
  id: string;
  kind: string;
  status?: string;
  summary: string;
}

export interface ExplainedClaim {
  proofPath: string;
  proofId: string;
  runId: string;
  sessionId: string;
  turnId: string;
  proofStatus: string;
  id: string;
  claim: string;
  status: string;
  linkStatus: "linked" | "unlinked" | "invalid_reference";
  verification: "requires_human_review";
  evidence: ExplainedClaimEvidence[];
}

export type ExplainClaimCommandView =
  | { kind: "usage"; message: string }
  | { kind: "empty"; evidenceDir?: string }
  | { kind: "error"; message: string }
  | { kind: "not_found"; query: string; proofPath: string }
  | { kind: "ambiguous"; query: string; proofPath: string; matches: Array<{ id: string; claim: string }> }
  | { kind: "claim"; format: ExplainClaimFormat; explanation: ExplainedClaim };

type ParsedExplainClaimArgs =
  | {
      kind: "parsed";
      target: "last";
      query: string;
      format: ExplainClaimFormat;
    }
  | {
      kind: "parsed";
      target: "path";
      path: string;
      query: string;
      format: ExplainClaimFormat;
    };

export function executeExplainClaimCommand(input: {
  args: string[];
  reader: EvidenceProofReader;
  evidenceDir?: string;
}): ExplainClaimCommandView {
  const parsed = parseExplainClaimArgs(input.args);
  if (parsed.kind === "usage") return parsed;

  try {
    const proof = parsed.target === "last"
      ? input.reader.readLatestEvidenceBundle()
      : input.reader.readEvidenceBundle(parsed.path);
    if (!proof) return { kind: "empty", evidenceDir: input.evidenceDir };
    const claims = recordArray(proof.bundle.claims);
    const match = findClaim(claims, parsed.query);
    if (match.kind === "not_found") return { kind: "not_found", query: parsed.query, proofPath: proof.path };
    if (match.kind === "ambiguous") {
      return {
        kind: "ambiguous",
        query: parsed.query,
        proofPath: proof.path,
        matches: match.matches.map((claim) => ({
          id: stringField(claim.id, "unknown"),
          claim: stringField(claim.claim, "unnamed claim"),
        })),
      };
    }
    return {
      kind: "claim",
      format: parsed.format,
      explanation: explainClaim(proof, match.claim),
    };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function renderExplainClaimCommandView(view: ExplainClaimCommandView): string {
  switch (view.kind) {
    case "usage":
      return view.message;
    case "empty":
      return `No SOBA proof files found${view.evidenceDir ? ` in ${view.evidenceDir}` : ""}.`;
    case "error":
      return `Claim explanation error: ${view.message}`;
    case "not_found":
      return `Claim not found in ${view.proofPath}: ${view.query}`;
    case "ambiguous":
      return renderAmbiguous(view);
    case "claim":
      return renderExplanation(view.explanation, view.format);
  }
}

export function explainClaimCommandExitCode(view: ExplainClaimCommandView): number {
  return view.kind === "claim" ? 0 : 1;
}

function parseExplainClaimArgs(
  args: string[],
): ParsedExplainClaimArgs | Extract<ExplainClaimCommandView, { kind: "usage" }> {
  let target: "last" | "path" = "last";
  let path: string | undefined;
  let format: ExplainClaimFormat = "text";
  const queryParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--last") {
      target = "last";
      path = undefined;
      continue;
    }
    if (arg === "--proof" || arg === "--path") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) return usage(`Missing ${arg} value.`);
      target = "path";
      path = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--proof=")) {
      const value = arg.slice("--proof=".length);
      if (!value) return usage("Missing --proof value.");
      target = "path";
      path = value;
      continue;
    }
    if (arg.startsWith("--path=")) {
      const value = arg.slice("--path=".length);
      if (!value) return usage("Missing --path value.");
      target = "path";
      path = value;
      continue;
    }
    if (arg === "--format") {
      const value = args[index + 1];
      if (!isExplainClaimFormat(value)) {
        return usage(`Invalid --format value "${value ?? ""}".`);
      }
      format = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (!isExplainClaimFormat(value)) {
        return usage(`Invalid --format value "${value}".`);
      }
      format = value;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return usage();
    }
    if (arg.startsWith("-")) {
      return usage(`Unknown explain-claim flag "${arg}".`);
    }
    queryParts.push(arg);
  }

  const query = queryParts.join(" ").trim();
  if (!query) return usage("Missing claim id or text.");
  if (target === "path") {
    if (!path) return usage("Missing proof path.");
    return { kind: "parsed", target, path, query, format };
  }
  return { kind: "parsed", target, query, format };
}

function usage(prefix?: string): Extract<ExplainClaimCommandView, { kind: "usage" }> {
  const message = [
    prefix,
    "Usage: soba explain-claim <claim-id-or-text> [--proof <path>|--last] [--format text|markdown|json]",
    "Examples:",
    "  soba explain-claim claim_1",
    "  soba explain-claim \"All TypeScript errors are fixed\" --last --format markdown",
    "  soba explain-claim claim_1 --proof .soba/evidence/2026-06-30T10-20-30Z-session-turn.soba-proof.json",
  ].filter(Boolean).join("\n");
  return { kind: "usage", message };
}

function isExplainClaimFormat(value: unknown): value is ExplainClaimFormat {
  return value === "text" || value === "markdown" || value === "json";
}

function findClaim(claims: Record<string, unknown>[], query: string):
  | { kind: "found"; claim: Record<string, unknown> }
  | { kind: "ambiguous"; matches: Record<string, unknown>[] }
  | { kind: "not_found" } {
  const normalizedQuery = normalize(query);
  const byId = claims.find((claim) => normalize(stringField(claim.id, "")) === normalizedQuery);
  if (byId) return { kind: "found", claim: byId };

  const byExactText = claims.find((claim) => normalize(stringField(claim.claim, "")) === normalizedQuery);
  if (byExactText) return { kind: "found", claim: byExactText };

  const substringMatches = claims.filter((claim) => normalize(stringField(claim.claim, "")).includes(normalizedQuery));
  if (substringMatches.length === 1) return { kind: "found", claim: substringMatches[0] };
  if (substringMatches.length > 1) return { kind: "ambiguous", matches: substringMatches };
  return { kind: "not_found" };
}

function explainClaim(proof: EvidenceProofDocument, claim: Record<string, unknown>): ExplainedClaim {
  const bundle = proof.bundle;
  const evidenceIds = stringArray(claim.evidenceIds);
  const index = buildEvidenceIndex(bundle);
  const evidence = evidenceIds.map((id) => index.get(id) ?? {
    id,
    kind: "unknown",
    summary: "No matching evidence record found.",
  });
  return {
    proofPath: proof.path,
    proofId: stringField(bundle.proofId, "legacy-unsealed"),
    runId: stringField(bundle.runId, "legacy-unsealed"),
    sessionId: stringField(bundle.sessionId, "unknown"),
    turnId: stringField(bundle.turnId, "unknown"),
    proofStatus: stringField(bundle.status, "unknown"),
    id: stringField(claim.id, "unknown"),
    claim: stringField(claim.claim, "unnamed claim"),
    status: stringField(claim.status, "unknown"),
    linkStatus: evidence.some((item) => item.kind === "unknown")
      ? "invalid_reference"
      : evidence.length > 0 ? "linked" : "unlinked",
    verification: "requires_human_review",
    evidence,
  };
}

function buildEvidenceIndex(bundle: Record<string, unknown>): Map<string, ExplainedClaimEvidence> {
  const index = new Map<string, ExplainedClaimEvidence>();
  for (const entry of recordArray(bundle.evidence)) {
    const id = stringField(entry.id, "");
    if (!id) continue;
    index.set(id, {
      id,
      kind: stringField(entry.kind, "evidence"),
      status: stringField(entry.status, undefined),
      summary: evidenceSummary(entry),
    });
  }
  for (const command of recordArray(bundle.commands)) {
    const id = stringField(command.id, "");
    if (!id || index.has(id)) continue;
    index.set(id, {
      id,
      kind: "command",
      status: stringField(command.status, undefined),
      summary: commandSummary(command),
    });
  }
  for (const check of recordArray(bundle.checks)) {
    const id = stringField(check.id, "");
    if (!id || index.has(id)) continue;
    index.set(id, {
      id,
      kind: "check",
      status: stringField(check.status, undefined),
      summary: checkSummary(check),
    });
  }
  for (const risk of recordArray(bundle.risks)) {
    const id = stringField(risk.id, "");
    if (!id || index.has(id)) continue;
    index.set(id, {
      id,
      kind: "risk",
      status: stringField(risk.severity, undefined),
      summary: riskSummary(risk),
    });
  }
  for (const file of recordArray(bundle.changedFiles)) {
    for (const mutationId of stringArray(file.mutationIds)) {
      if (index.has(mutationId)) continue;
      index.set(mutationId, {
        id: mutationId,
        kind: "file_mutation",
        summary: changedFileSummary(file),
      });
    }
  }
  return index;
}

function renderExplanation(explanation: ExplainedClaim, format: ExplainClaimFormat): string {
  if (format === "json") return `${JSON.stringify(explanation, null, 2)}\n`;
  if (format === "markdown") return renderExplanationMarkdown(explanation);
  return renderExplanationText(explanation);
}

function renderExplanationText(explanation: ExplainedClaim): string {
  return [
    "SOBA Claim Explanation",
    `Proof: ${explanation.proofPath}`,
    `Proof id: ${explanation.proofId}`,
    `Run id: ${explanation.runId}`,
    `Session: ${explanation.sessionId}`,
    `Turn: ${explanation.turnId}`,
    `Proof status: ${explanation.proofStatus}`,
    `Claim: ${explanation.claim}`,
    `Claim id: ${explanation.id}`,
    `Recorded claim status: ${explanation.status} (producer-authored)`,
    `Evidence link: ${explanation.linkStatus}`,
    "Verification: requires human review; an evidence link does not prove narrative sufficiency.",
    "Evidence:",
    ...evidenceTextLines(explanation.evidence),
  ].join("\n");
}

function renderExplanationMarkdown(explanation: ExplainedClaim): string {
  return [
    "# SOBA Claim Explanation",
    "",
    `- Proof: \`${explanation.proofPath}\``,
    `- Proof id: \`${explanation.proofId}\``,
    `- Run id: \`${explanation.runId}\``,
    `- Session: \`${explanation.sessionId}\``,
    `- Turn: \`${explanation.turnId}\``,
    `- Proof status: \`${explanation.proofStatus}\``,
    `- Claim: ${explanation.claim}`,
    `- Claim id: \`${explanation.id}\``,
    `- Recorded claim status: \`${explanation.status}\` (producer-authored)`,
    `- Evidence link: \`${explanation.linkStatus}\``,
    "- Verification: requires human review; an evidence link does not prove narrative sufficiency.",
    "",
    "## Evidence",
    explanation.evidence.length === 0
      ? "- none"
      : explanation.evidence.map((evidence) => `- \`${evidence.id}\` ${formatEvidenceSummary(evidence)}`).join("\n"),
    "",
  ].join("\n");
}

function evidenceTextLines(evidence: ExplainedClaimEvidence[]): string[] {
  if (evidence.length === 0) return ["  none"];
  return evidence.map((item) => `  - ${item.id}: ${formatEvidenceSummary(item)}`);
}

function renderAmbiguous(view: Extract<ExplainClaimCommandView, { kind: "ambiguous" }>): string {
  return [
    `Claim query is ambiguous in ${view.proofPath}: ${view.query}`,
    "Matches:",
    ...view.matches.map((match) => `  - ${match.id}: ${match.claim}`),
  ].join("\n");
}

function formatEvidenceSummary(evidence: ExplainedClaimEvidence): string {
  const status = evidence.status ? ` ${evidence.status}` : "";
  return `${evidence.kind}${status}: ${evidence.summary}`;
}

function evidenceSummary(entry: Record<string, unknown>): string {
  const summary = stringField(entry.summary, "");
  if (summary) return summary;
  const command = stringField(entry.command, "");
  if (command) return command;
  const files = stringArray(entry.files);
  if (files.length > 0) return files.join(", ");
  return "Evidence record.";
}

function commandSummary(command: Record<string, unknown>): string {
  const text = stringField(command.command, "unknown command");
  const exitCode = command.exitCode === null ? "null" : numberField(command.exitCode)?.toString();
  const digest = stringField(command.outputDigest, "");
  return [text, exitCode !== undefined ? `exit=${exitCode}` : "", digest ? `digest=${digest}` : ""]
    .filter(Boolean)
    .join(" ");
}

function checkSummary(check: Record<string, unknown>): string {
  const label = stringField(check.label, "Check");
  const reason = stringField(check.reason, "");
  return reason ? `${label}. ${reason}` : label;
}

function riskSummary(risk: Record<string, unknown>): string {
  return stringField(risk.message, stringField(risk.kind, "Risk"));
}

function changedFileSummary(file: Record<string, unknown>): string {
  const operation = stringField(file.operation, "unknown");
  const path = stringField(file.path, "unknown path");
  return operation === "unknown" ? path : `${operation} ${path}`;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringField(value: unknown, fallback: string): string;
function stringField(value: unknown, fallback: undefined): string | undefined;
function stringField(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
