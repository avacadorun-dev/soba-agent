/**
 * Capability report cache and refresh wiring (composition layer).
 *
 * `soba doctor` re-probes the OS and writes `.soba/capabilities.json`; the
 * runtime reads the cached report and injects it into the session context so
 * the agent sees current capabilities every turn without probing per turn.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCapabilityReport,
  type CapabilityReport,
  formatCapabilityReportForPrompt,
  parseCapabilityReport,
} from "../../application/environment/capabilities";
import { ensureCapabilityCacheDir, probeEnvironmentCapabilities } from "../../infrastructure/environment/capability-probes";

export function capabilityReportPath(projectRoot: string): string {
  return join(ensureCapabilityCacheDir(projectRoot), "capabilities.json");
}

export function loadCachedCapabilityReport(projectRoot: string): CapabilityReport | null {
  const path = capabilityReportPath(projectRoot);
  if (!existsSync(path)) return null;
  try {
    return parseCapabilityReport(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return null;
  }
}

export async function refreshCapabilityReport(input: {
  projectRoot: string;
  model: string;
  visionSupported: boolean;
}): Promise<CapabilityReport> {
  const probes = await probeEnvironmentCapabilities();
  const report = buildCapabilityReport({
    model: input.model,
    visionSupported: input.visionSupported,
    probes,
  });
  writeFileSync(capabilityReportPath(input.projectRoot), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return report;
}

/** Cached report rendered for the session context, or null when never probed. */
export function cachedCapabilityReportForPrompt(projectRoot: string): string | null {
  const report = loadCachedCapabilityReport(projectRoot);
  return report ? formatCapabilityReportForPrompt(report) : null;
}
