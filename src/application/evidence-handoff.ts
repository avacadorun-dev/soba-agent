export interface ParsedEvidenceHandoff {
  status?: string;
  activity?: string;
  changedFiles: string[];
  checks: string[];
  risks: string[];
  reviewActions: string[];
  diff?: string;
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
  if (summary.status) lines.push(`Status: ${summary.status}`);
  if (summary.activity) lines.push(`Activity: ${summary.activity}`);
  if (summary.diff) lines.push(`Diff: ${summary.diff}`);
  if (summary.changedFiles.length > 0) lines.push(`Changed files: ${summary.changedFiles.join(", ")}`);
  if (summary.checks.length > 0) lines.push(`Checks: ${summary.checks.join(", ")}`);
  if (summary.risks.length > 0) lines.push(`Risks: ${summary.risks.join("; ")}`);
  if (summary.reviewActions.length > 0) lines.push(`Review: ${summary.reviewActions.join("; ")}`);
  return lines.join("\n");
}

function parseEvidenceLines(lines: string[]): ParsedEvidenceHandoff {
  const summary: ParsedEvidenceHandoff = {
    changedFiles: [],
    checks: [],
    risks: [],
    reviewActions: [],
    rawLines: lines.slice(),
  };

  for (const line of lines) {
    const parsed = parseEvidenceLine(line);
    if (!parsed) continue;

    switch (parsed.key) {
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
      case "risks":
        summary.risks = splitSemicolonList(parsed.value);
        break;
      case "review":
        summary.reviewActions = splitSemicolonList(parsed.value);
        break;
      case "diff":
        summary.diff = parsed.value;
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
