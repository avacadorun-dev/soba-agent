export interface ParsedEvidenceHandoff {
  verdict?: string;
  outcome?: string;
  reason?: string;
  receipt?: string;
  status?: string;
  activity?: string;
  changedFiles: string[];
  claims: string[];
  checks: string[];
  risks: string[];
  permissions: string[];
  reviewActions: string[];
  diff?: string;
  nextCommand?: string;
  rawLines: string[];
}

export interface SplitEvidenceHandoffResult {
  body: string;
  evidence?: ParsedEvidenceHandoff;
}

const EVIDENCE_HEADING = "**Evidence**";

export function splitEvidenceHandoff(content: string): SplitEvidenceHandoffResult {
  const lines = content.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim().toLowerCase() === EVIDENCE_HEADING.toLowerCase());
  if (headingIndex < 0) return { body: content };

  const body = lines.slice(0, headingIndex).join("\n").trimEnd();
  const evidenceLines = lines.slice(headingIndex + 1).filter((line) => line.trim().length > 0);
  return { body, evidence: parseEvidenceLines(evidenceLines) };
}

export function formatParsedEvidenceHandoff(summary: ParsedEvidenceHandoff): string {
  const lines = ["Evidence"];
  if (summary.verdict) lines.push(`Verdict: ${summary.verdict}`);
  if (summary.outcome) lines.push(`Outcome: ${summary.outcome}`);
  if (summary.reason) lines.push(`Reason: ${summary.reason}`);
  if (summary.receipt) lines.push(`Receipt: ${summary.receipt}`);
  if (summary.status) lines.push(`Status: ${summary.status}`);
  if (summary.activity) lines.push(`Activity: ${summary.activity}`);
  if (summary.diff) lines.push(`Diff: ${summary.diff}`);
  if (summary.changedFiles.length > 0) lines.push(`Changed files: ${summary.changedFiles.join(", ")}`);
  if (summary.claims.length > 0) lines.push(`Claims: ${summary.claims.join("; ")}`);
  if (summary.checks.length > 0) lines.push(`Checks: ${summary.checks.join(", ")}`);
  if (summary.risks.length > 0) lines.push(`Risks: ${summary.risks.join("; ")}`);
  if (summary.permissions.length > 0) lines.push(`Permissions: ${summary.permissions.join("; ")}`);
  if (summary.reviewActions.length > 0) lines.push(`Review: ${summary.reviewActions.join("; ")}`);
  if (summary.nextCommand) lines.push(`Details: ${summary.nextCommand}`);
  return lines.join("\n");
}

function parseEvidenceLines(lines: string[]): ParsedEvidenceHandoff {
  const summary: ParsedEvidenceHandoff = {
    changedFiles: [],
    claims: [],
    checks: [],
    risks: [],
    permissions: [],
    reviewActions: [],
    rawLines: lines.slice(),
  };

  for (const line of lines) {
    const parsed = parseEvidenceLine(line);
    if (!parsed) continue;

    switch (parsed.key) {
      case "verdict":
        summary.verdict = parsed.value;
        break;
      case "outcome":
        summary.outcome = parsed.value;
        break;
      case "reason":
        summary.reason = parsed.value;
        break;
      case "receipt":
        summary.receipt = parsed.value;
        break;
      case "status":
        summary.status = parsed.value;
        break;
      case "activity":
        summary.activity = parsed.value;
        break;
      case "changed files":
        summary.changedFiles = splitCommaList(parsed.value);
        break;
      case "checks":
        summary.checks = splitCommaList(parsed.value);
        break;
      case "claims":
        summary.claims = splitSemicolonList(parsed.value);
        break;
      case "risks":
        summary.risks = splitSemicolonList(parsed.value);
        break;
      case "permissions":
        summary.permissions = splitSemicolonList(parsed.value);
        break;
      case "review":
        summary.reviewActions = splitSemicolonList(parsed.value);
        break;
      case "diff":
        summary.diff = parsed.value;
        break;
      case "details":
        summary.nextCommand = parsed.value;
        break;
    }
  }

  return summary;
}

function parseEvidenceLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  const match = /^-\s*([^:]+):\s*(.*)$/.exec(trimmed);
  if (!match) return null;
  return {
    key: match[1].trim().toLowerCase(),
    value: match[2].trim(),
  };
}

function splitCommaList(value: string): string[] {
  if (isEmptyList(value)) return [];
  return value.split(/,\s+/).map((item) => item.trim()).filter(Boolean);
}

function splitSemicolonList(value: string): string[] {
  if (isEmptyList(value)) return [];
  return value.split(/;\s+/).map((item) => item.trim()).filter(Boolean);
}

function isEmptyList(value: string): boolean {
  return value.length === 0 || value.toLowerCase() === "none" || value.toLowerCase() === "none recorded";
}
