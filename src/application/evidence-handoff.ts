export interface ParsedEvidenceHandoff {
  kind?: "evidence" | "verified_handoff";
  status?: string;
  changedFiles: string[];
  checks: string[];
  risks: string[];
  reviewActions: string[];
  privilegedActions?: string[];
  declaredClaims?: string[];
  unknown?: string[];
  integrity?: string;
  diff?: string;
  rawLines: string[];
}

export interface SplitEvidenceHandoffResult {
  body: string;
  evidence?: ParsedEvidenceHandoff;
}

const EVIDENCE_HEADING = "**Evidence**";
const VERIFIED_HANDOFF_HEADING = "**Verified handoff**";

export function splitEvidenceHandoff(content: string): SplitEvidenceHandoffResult {
  const lines = content.split("\n");
  const headingIndex = lines.findIndex((line) => isHandoffHeading(line));
  if (headingIndex < 0) return { body: content };

  const body = lines.slice(0, headingIndex).join("\n").trimEnd();
  const evidenceLines = lines.slice(headingIndex + 1).filter((line) => line.trim().length > 0);
  const kind = lines[headingIndex]?.trim().toLowerCase() === VERIFIED_HANDOFF_HEADING.toLowerCase()
    ? "verified_handoff"
    : "evidence";
  return { body, evidence: parseEvidenceLines(evidenceLines, kind) };
}

export function formatParsedEvidenceHandoff(summary: ParsedEvidenceHandoff): string {
  const lines = [summary.kind === "verified_handoff" ? "Verified handoff" : "Evidence"];
  if (summary.status) lines.push(`${summary.kind === "verified_handoff" ? "Producer status" : "Status"}: ${summary.status}`);
  if (summary.diff) lines.push(`Diff: ${summary.diff}`);
  if (summary.changedFiles.length > 0) lines.push(`Changed files: ${summary.changedFiles.join(", ")}`);
  if (summary.checks.length > 0) lines.push(`Checks: ${summary.checks.join(", ")}`);
  if ((summary.privilegedActions?.length ?? 0) > 0) lines.push(`Privileged actions: ${summary.privilegedActions?.join("; ")}`);
  if ((summary.declaredClaims?.length ?? 0) > 0) lines.push(`Declared claims: ${summary.declaredClaims?.join("; ")}`);
  if ((summary.unknown?.length ?? 0) > 0) lines.push(`Unknown: ${summary.unknown?.join("; ")}`);
  if (summary.risks.length > 0) lines.push(`Risks: ${summary.risks.join("; ")}`);
  if (summary.reviewActions.length > 0) lines.push(`Review: ${summary.reviewActions.join("; ")}`);
  if (summary.integrity) lines.push(`Integrity: ${summary.integrity}`);
  return lines.join("\n");
}

function parseEvidenceLines(lines: string[], kind: NonNullable<ParsedEvidenceHandoff["kind"]>): ParsedEvidenceHandoff {
  const summary: ParsedEvidenceHandoff = {
    kind,
    changedFiles: [],
    checks: [],
    risks: [],
    reviewActions: [],
    privilegedActions: [],
    declaredClaims: [],
    unknown: [],
    rawLines: lines.slice(),
  };

  for (const line of lines) {
    const parsed = parseEvidenceLine(line);
    if (!parsed) continue;

    switch (parsed.key) {
      case "status":
        summary.status = parsed.value;
        break;
      case "changed files":
      case "observed changes":
        summary.changedFiles = splitCommaList(parsed.value);
        break;
      case "checks":
      case "observed checks":
        summary.checks = splitCommaList(parsed.value);
        break;
      case "risks":
        summary.risks = splitSemicolonList(parsed.value);
        break;
      case "review":
      case "observed review":
        summary.reviewActions = splitSemicolonList(parsed.value);
        break;
      case "diff":
      case "observed diff":
        summary.diff = parsed.value;
        break;
      case "observed privileged actions":
        summary.privilegedActions = splitSemicolonList(parsed.value);
        break;
      case "declared claims":
        summary.declaredClaims = splitSemicolonList(parsed.value);
        break;
      case "declared result": {
        const status = /\(producer status:\s*([^)]+)\)\s*$/i.exec(parsed.value)?.[1]?.trim();
        if (status) summary.status = status;
        break;
      }
      case "unknown":
        summary.unknown = splitSemicolonList(parsed.value);
        break;
      case "integrity":
        summary.integrity = parsed.value;
        break;
    }
  }

  return summary;
}

function isHandoffHeading(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  return normalized === EVIDENCE_HEADING.toLowerCase() || normalized === VERIFIED_HANDOFF_HEADING.toLowerCase();
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
