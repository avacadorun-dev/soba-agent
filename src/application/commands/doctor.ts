/**
 * `soba doctor` — environment capability preflight.
 */

import {
  CAPABILITY_NAMES,
  type CapabilityReport,
} from "../environment/capabilities";

export function renderDoctorReport(report: CapabilityReport): string {
  const lines = [
    `soba doctor — environment capability report`,
    `model: ${report.model}`,
    `generated: ${report.generatedAt}`,
    "",
  ];
  for (const capability of report.capabilities) {
    lines.push(`${capability.available ? "✓" : "✗"} ${capability.name}: ${capability.reason}`);
  }
  lines.push("");
  lines.push("Re-run `soba doctor` after changing OS permissions to refresh this report.");
  return lines.join("\n");
}

export function doctorExitCode(report: CapabilityReport): number {
  // Doctor always exits 0: unavailable capabilities are information, not errors.
  void report;
  void CAPABILITY_NAMES;
  return 0;
}
