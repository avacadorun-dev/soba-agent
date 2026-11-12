/**
 * Environment capability contract and report formatting.
 *
 * The capability report decides which verification claims are even possible
 * (vision, screenshot, accessibility automation, clipboard, display server,
 * browser). It is produced by `soba doctor` (which re-probes the OS), cached
 * under `.soba/capabilities.json`, and injected into the session context so
 * the agent cannot claim a capability that does not exist.
 */

export interface CapabilityStatus {
  name: CapabilityName;
  available: boolean;
  reason: string;
}

export type CapabilityName =
  | "vision"
  | "screenshot"
  | "accessibility"
  | "clipboard"
  | "display_server"
  | "browser";

export const CAPABILITY_NAMES: readonly CapabilityName[] = [
  "vision",
  "screenshot",
  "accessibility",
  "clipboard",
  "display_server",
  "browser",
];

export interface CapabilityReport {
  generatedAt: string;
  model: string;
  capabilities: CapabilityStatus[];
}

export function buildCapabilityReport(input: {
  model: string;
  visionSupported: boolean;
  probes: Record<string, { available: boolean; reason: string }>;
}): CapabilityReport {
  return {
    generatedAt: new Date().toISOString(),
    model: input.model,
    capabilities: CAPABILITY_NAMES.map((name) => {
      if (name === "vision") {
        return {
          name,
          available: input.visionSupported,
          reason: input.visionSupported
            ? "active model declares input_image support"
            : "active model does not declare input_image support; visual claims are not allowed",
        };
      }
      const probe = input.probes[name];
      return {
        name,
        available: probe?.available ?? false,
        reason: probe?.reason ?? "not probed",
      };
    }),
  };
}

export function parseCapabilityReport(raw: unknown): CapabilityReport | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.generatedAt !== "string" || typeof record.model !== "string") return null;
  if (!Array.isArray(record.capabilities)) return null;

  const capabilities = record.capabilities.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const entry = item as Record<string, unknown>;
    if (typeof entry.name !== "string" || typeof entry.available !== "boolean") return [];
    return [{
      name: entry.name as CapabilityStatus["name"],
      available: entry.available,
      reason: typeof entry.reason === "string" ? entry.reason : "",
    }];
  });

  return { generatedAt: record.generatedAt, model: record.model, capabilities };
}

/** Compact one-block rendering for the session context. */
export function formatCapabilityReportForPrompt(report: CapabilityReport): string {
  const lines = report.capabilities.map((capability) =>
    `- ${capability.name}: ${capability.available ? "available" : "unavailable"} (${capability.reason})`,
  );
  return [
    `SOBA Capability Report (model ${report.model}, generated ${report.generatedAt} by soba doctor):`,
    ...lines,
    "Claims that need an unavailable capability must be refused with the specific reason above; do not degrade silently.",
  ].join("\n");
}
