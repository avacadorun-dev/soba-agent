/**
 * PortableCapsule v1 domain model.
 *
 * Portable capsules are self-contained Markdown-dispatch packages intended
 * for safe knowledge transfer between SOBA-compatible or external agents.
 *
 * Spec: internal-design-notes
 */

import type { ArtifactLedger } from "../session/types-v2";

export const PORTABLE_CAPSULE_SCHEMA = "soba.portable-capsule";
export const PORTABLE_CAPSULE_VERSION = 1;

export const PORTABLE_CAPSULE_TIERS = ["quick", "standard", "deep"] as const;
export const PORTABLE_CAPSULE_CATEGORIES = [
  "full_system",
  "knowledge_pillar",
  "conversation_thread",
  "living_reference",
] as const;
export const PORTABLE_CAPSULE_ARCHETYPES = [
  "perishable",
  "handoff",
  "seed",
  "steroid",
  "delta",
  "trainer",
  "dormant",
] as const;
export const PORTABLE_CAPSULE_PROVENANCE_SOURCES = ["session_checkpoint", "session_branch", "external"] as const;
export const PORTABLE_CAPSULE_INTEGRATION_MODES = ["auto", "manual"] as const;

export type PortableCapsuleTier = (typeof PORTABLE_CAPSULE_TIERS)[number];
export type PortableCapsuleCategory = (typeof PORTABLE_CAPSULE_CATEGORIES)[number];
export type PortableCapsuleArchetype = (typeof PORTABLE_CAPSULE_ARCHETYPES)[number];
export type PortableCapsuleProvenanceSource = (typeof PORTABLE_CAPSULE_PROVENANCE_SOURCES)[number];
export type PortableCapsuleIntegrationMode = (typeof PORTABLE_CAPSULE_INTEGRATION_MODES)[number];

export interface PortableCapsulePattern {
  name: string;
  description: string;
}

export interface PortableCapsuleIntegrationStep {
  order: number;
  mode: PortableCapsuleIntegrationMode;
  title: string;
  prerequisites: string[];
  actions: string[];
  verification: string[];
  rollback: string[];
}

export interface PortableCapsuleVerbatimPayload {
  name: string;
  mediaType: string;
  content: string;
  checksum: string;
}

export interface PortableCapsuleRedactionSummary {
  category:
    | "api_key"
    | "bearer_token"
    | "private_key"
    | "credential_url"
    | "absolute_home_path"
    | "session_identifier"
    | "provider_identifier";
  count: number;
}

export interface PortableCapsuleSanitationReport {
  checkedAt: string;
  redactions: PortableCapsuleRedactionSummary[];
  secretLeakDetected: boolean;
}

export interface PortableCapsuleProvenance {
  source: PortableCapsuleProvenanceSource;
  checkpointId?: string;
}

export interface PortableCapsule {
  schema: typeof PORTABLE_CAPSULE_SCHEMA;
  version: typeof PORTABLE_CAPSULE_VERSION;
  id: string;
  title: string;
  createdAt: string;
  sender?: string;
  intendedReceiver: string;
  objective: string;
  tier: PortableCapsuleTier;
  category: PortableCapsuleCategory;
  archetype: PortableCapsuleArchetype;
  dispatchSummary: string;
  coreContent: string[];
  patterns: PortableCapsulePattern[];
  assumptions: string[];
  signals: string[];
  artifacts: ArtifactLedger;
  integrationPlan: PortableCapsuleIntegrationStep[];
  verbatimPayloads: PortableCapsuleVerbatimPayload[];
  sanitation: PortableCapsuleSanitationReport;
  provenance: PortableCapsuleProvenance;
}

export interface PortableCapsuleValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface PortableCapsuleValidationResult {
  valid: boolean;
  errors: PortableCapsuleValidationIssue[];
  warnings: PortableCapsuleValidationIssue[];
}

export interface PortableCapsuleCreationOptions {
  id?: string;
  title?: string;
  createdAt?: string;
  sender?: string;
  intendedReceiver?: string;
  objective?: string;
  tier?: PortableCapsuleTier;
  category?: PortableCapsuleCategory;
  archetype?: PortableCapsuleArchetype;
  integrationPlan?: PortableCapsuleIntegrationStep[];
  verbatimPayloads?: Array<Omit<PortableCapsuleVerbatimPayload, "checksum"> | PortableCapsuleVerbatimPayload>;
}

export interface PortableCapsuleDecodeResult {
  capsule: PortableCapsule;
  briefing: string;
  frontmatter: Record<string, string>;
}
