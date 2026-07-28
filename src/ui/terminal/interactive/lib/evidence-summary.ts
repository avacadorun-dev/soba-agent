import {
  formatParsedEvidenceHandoff,
  type ParsedEvidenceHandoff,
  type RuntimeProofHandoff,
  type SplitEvidenceHandoffResult,
  splitEvidenceHandoff,
} from "../../../../application/ui/public";

export type TuiEvidenceSummary = ParsedEvidenceHandoff | RuntimeProofHandoff;
export type SplitAssistantEvidenceResult = SplitEvidenceHandoffResult;

export interface TuiEvidenceItem {
  text: string;
  status?: string;
}

export interface TuiEvidenceView {
  headline: "verified" | "needs_attention";
  outcome?: string;
  reason?: string;
  receipt?: string;
  activity?: string;
  changedFiles: TuiEvidenceItem[];
  claims: TuiEvidenceItem[];
  checks: TuiEvidenceItem[];
  risks: TuiEvidenceItem[];
  permissions: TuiEvidenceItem[];
  reviewActions: TuiEvidenceItem[];
  diff?: string;
  nextCommand?: string;
}

export function splitAssistantEvidence(content: string): SplitAssistantEvidenceResult {
  return splitEvidenceHandoff(content);
}

export function formatTuiEvidenceSummary(summary: TuiEvidenceSummary): string {
  if (!isRuntimeProofHandoff(summary)) {
    return formatParsedEvidenceHandoff(summary);
  }
  const view = toTuiEvidenceView(summary);
  return [
    "Evidence",
    `Verdict: ${view.headline}`,
    view.outcome ? `Outcome: ${view.outcome}` : undefined,
    view.reason ? `Reason: ${view.reason}` : undefined,
    view.receipt ? `Receipt: ${view.receipt}` : undefined,
    view.diff ? `Diff: ${view.diff}` : undefined,
    view.changedFiles.length > 0 ? `Changed files: ${view.changedFiles.map((item) => item.text).join(", ")}` : undefined,
    view.claims.length > 0 ? `Claims: ${view.claims.map((item) => item.text).join("; ")}` : undefined,
    view.checks.length > 0 ? `Checks: ${view.checks.map((item) => item.text).join(", ")}` : undefined,
    view.risks.length > 0 ? `Risks: ${view.risks.map((item) => item.text).join("; ")}` : undefined,
    view.permissions.length > 0 ? `Permissions: ${view.permissions.map((item) => item.text).join("; ")}` : undefined,
    view.reviewActions.length > 0 ? `Review: ${view.reviewActions.map((item) => item.text).join("; ")}` : undefined,
    view.nextCommand ? `Details: ${view.nextCommand}` : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function toTuiEvidenceView(summary: TuiEvidenceSummary): TuiEvidenceView {
  if (!isRuntimeProofHandoff(summary)) {
    const outcome = summary.outcome ?? summary.status;
    const headline = summary.verdict
      ? (summary.verdict.toLowerCase() === "verified" ? "verified" : "needs_attention")
      : (outcome === "verified" ? "verified" : "needs_attention");
    return {
      headline,
      outcome,
      reason: summary.reason,
      receipt: summary.receipt,
      activity: summary.activity,
      changedFiles: summary.changedFiles.map((text) => ({ text })),
      claims: summary.claims.map((text) => ({ text, status: claimStatusFromText(text) })),
      checks: summary.checks.map((text) => ({ text, status: checkStatusFromText(text) })),
      risks: summary.risks.map((text) => ({ text, status: "warning" })),
      permissions: summary.permissions.map((text) => ({ text })),
      reviewActions: summary.reviewActions.map((text) => ({ text })),
      diff: summary.diff,
      nextCommand: summary.nextCommand,
    };
  }

  return {
    headline: summary.headline,
    outcome: summary.outcome,
    reason: summary.reason,
    receipt: summary.receipt.saved ? summary.receipt.path ?? "saved" : "not saved",
    activity: summary.activity,
    changedFiles: summary.changedFiles.map((file) => ({
      text: formatChangedFile(file),
      status: file.operation,
    })),
    claims: summary.claims.map((claim) => ({
      text: claim.claim,
      status: claim.status,
    })),
    checks: summary.checks.map((check) => ({
      text: `${check.label}${check.command ? ` (${check.command})` : ""}`,
      status: check.status,
    })),
    risks: summary.risks.map((risk) => ({
      text: risk.message,
      status: risk.severity,
    })),
    permissions: summary.approvals.map((approval) => ({
      text: `${approval.description ?? approval.approvalValue ?? approval.toolName ?? approval.toolCallId} ${approval.decision}`,
      status: approval.trustLevel,
    })),
    reviewActions: summary.reviewActions.map((action) => ({
      text: typeof action.summary === "string" ? action.summary : JSON.stringify(action),
      status: typeof action.status === "string" ? action.status : undefined,
    })),
    diff: summary.diff
      ? `${summary.diff.fileCount} ${summary.diff.fileCount === 1 ? "file" : "files"}, +${summary.diff.added}/-${summary.diff.removed}${summary.diff.truncated ? ", truncated" : ""}`
      : undefined,
    nextCommand: summary.nextCommand,
  };
}

export function evidenceNeedsAttention(summary: TuiEvidenceSummary): boolean {
  return toTuiEvidenceView(summary).headline === "needs_attention";
}

function isRuntimeProofHandoff(summary: TuiEvidenceSummary): summary is RuntimeProofHandoff {
  return "headline" in summary && "receipt" in summary && typeof summary.receipt === "object";
}

function formatChangedFile(file: RuntimeProofHandoff["changedFiles"][number]): string {
  const operation = file.operation === "unknown" ? "" : `${file.operation} `;
  const stats = file.added !== undefined || file.removed !== undefined
    ? ` (+${file.added ?? 0}/-${file.removed ?? 0})`
    : "";
  return `${operation}${file.path}${stats}`;
}

function checkStatusFromText(text: string): string | undefined {
  return ["failed", "skipped", "not run", "passed"].find((status) => text.toLowerCase().includes(status));
}

function claimStatusFromText(text: string): string | undefined {
  return ["unsupported", "unverified", "supported"].find((status) => text.toLowerCase().includes(status));
}
