/**
 * Ephemeral developer messages injected into every model request within a
 * turn: persisted plan state and the cached environment capability report.
 * Kept out of the turn runner so the runner stays a thin orchestration shell.
 */

import type { EvidenceLedger } from "../evidence/evidence-ledger";

export function buildPlanEphemeralMessage(
  evidenceLedger: EvidenceLedger,
): Array<{ role: "developer"; content: string }> {
  const items = evidenceLedger.getActivePlanItems();
  if (items.length === 0) return [];

  const listing = items
    .map((item, index) => {
      const evidence = item.evidenceIds && item.evidenceIds.length > 0 ? ` (evidence: ${item.evidenceIds.join(", ")})` : "";
      return `${index + 1}. [${item.status}] ${item.title}${evidence}`;
    })
    .join("\n");

  return [{
    role: "developer",
    content: [
      "SOBA Plan (persisted across turns; update it with the checkpoint tool's items field):",
      listing,
      "finish with status completed requires every active plan item to be done or explicitly disclosed.",
    ].join("\n"),
  }];
}

export function buildCapabilityEphemeralMessage(
  capabilityReport: string | undefined,
): Array<{ role: "developer"; content: string }> {
  if (!capabilityReport) return [];
  return [{ role: "developer", content: capabilityReport }];
}
