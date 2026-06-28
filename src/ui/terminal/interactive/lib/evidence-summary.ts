import {
  formatParsedEvidenceHandoff,
  type ParsedEvidenceHandoff,
  type SplitEvidenceHandoffResult,
  splitEvidenceHandoff,
} from "../../../../application/public";

export type TuiEvidenceSummary = ParsedEvidenceHandoff;
export type SplitAssistantEvidenceResult = SplitEvidenceHandoffResult;

export function splitAssistantEvidence(content: string): SplitAssistantEvidenceResult {
  return splitEvidenceHandoff(content);
}

export function formatTuiEvidenceSummary(summary: TuiEvidenceSummary): string {
  return formatParsedEvidenceHandoff(summary);
}
