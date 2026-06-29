/**
 * PortableCapsule validator.
 */

import { sha256Hex } from "./hash";
import { detectPotentialSecret } from "./sanitizer";
import {
  PORTABLE_CAPSULE_ARCHETYPES,
  PORTABLE_CAPSULE_CATEGORIES,
  PORTABLE_CAPSULE_INTEGRATION_MODES,
  PORTABLE_CAPSULE_PROVENANCE_SOURCES,
  PORTABLE_CAPSULE_SCHEMA,
  PORTABLE_CAPSULE_TIERS,
  PORTABLE_CAPSULE_VERSION,
  type PortableCapsule,
  type PortableCapsuleValidationIssue,
  type PortableCapsuleValidationResult,
} from "./types";

const MAX_CAPSULE_BYTES = 1024 * 1024;
const MAX_VERBATIM_PAYLOAD_BYTES = 256 * 1024;
const MAX_TOTAL_VERBATIM_BYTES = 512 * 1024;
const MAX_CORE_CONTENT_ENTRIES = 100;
const MAX_INTEGRATION_STEPS = 50;

export interface PortableCapsuleValidationOptions {
  homeDirectory?: string | null;
}

export function validatePortableCapsule(
  capsule: PortableCapsule,
  options: PortableCapsuleValidationOptions = {},
): PortableCapsuleValidationResult {
  const errors: PortableCapsuleValidationIssue[] = [];
  const warnings: PortableCapsuleValidationIssue[] = [];

  requireEqual(capsule.schema, PORTABLE_CAPSULE_SCHEMA, "unknown_schema", "Unsupported capsule schema", errors, "schema");
  requireEqual(capsule.version, PORTABLE_CAPSULE_VERSION, "unknown_version", "Unsupported capsule version", errors, "version");

  if (!/^pc_[a-z0-9]{12}$/.test(capsule.id)) {
    errors.push({ code: "invalid_id", message: "Capsule id must match pc_<12 lowercase alphanumeric chars>", path: "id" });
  }
  if (Number.isNaN(Date.parse(capsule.createdAt))) {
    errors.push({ code: "invalid_date", message: "createdAt must be a valid ISO date", path: "createdAt" });
  }

  requireNonEmpty(capsule.title, "missing_title", "Capsule title is required", errors, "title");
  requireNonEmpty(capsule.intendedReceiver, "missing_receiver", "Capsule receiver is required", errors, "intendedReceiver");
  requireNonEmpty(capsule.objective, "missing_objective", "Capsule objective is required", errors, "objective");
  requireNonEmpty(
    capsule.dispatchSummary,
    "missing_dispatch_summary",
    "Capsule dispatch summary is required",
    errors,
    "dispatchSummary",
  );

  requireOneOf(capsule.tier, PORTABLE_CAPSULE_TIERS, "invalid_tier", "Invalid capsule tier", errors, "tier");
  requireOneOf(
    capsule.category,
    PORTABLE_CAPSULE_CATEGORIES,
    "invalid_category",
    "Invalid capsule category",
    errors,
    "category",
  );
  requireOneOf(
    capsule.archetype,
    PORTABLE_CAPSULE_ARCHETYPES,
    "invalid_archetype",
    "Invalid capsule archetype",
    errors,
    "archetype",
  );
  requireOneOf(
    capsule.provenance.source,
    PORTABLE_CAPSULE_PROVENANCE_SOURCES,
    "invalid_provenance",
    "Invalid provenance source",
    errors,
    "provenance.source",
  );

  if (capsule.coreContent.length === 0 || capsule.coreContent.every((entry) => entry.trim().length === 0)) {
    errors.push({ code: "empty_core_content", message: "Capsule must include core content", path: "coreContent" });
  }
  if (capsule.coreContent.length > MAX_CORE_CONTENT_ENTRIES) {
    errors.push({
      code: "too_many_core_entries",
      message: `Capsule core content exceeds ${MAX_CORE_CONTENT_ENTRIES} entries`,
      path: "coreContent",
    });
  }

  validateIntegrationPlan(capsule, errors, warnings);
  validateVerbatimPayloads(capsule, errors);
  validateLimits(capsule, errors);
  validateSanitation(capsule, errors, warnings);

  if (capsule.patterns.length === 0) {
    warnings.push({ code: "empty_patterns", message: "Capsule has no extracted patterns", path: "patterns" });
  }
  if (capsule.signals.length === 0) {
    warnings.push({ code: "empty_signals", message: "Capsule has no receiver signals", path: "signals" });
  }
  if (capsule.provenance.source === "external" && !capsule.provenance.checkpointId) {
    warnings.push({
      code: "external_without_checkpoint",
      message: "External capsule has no provenance checkpoint",
      path: "provenance.checkpointId",
    });
  }
  if (containsAbsoluteHomePath(JSON.stringify(capsule), options.homeDirectory)) {
    warnings.push({
      code: "absolute_project_path",
      message: "Capsule still appears to contain an absolute home path",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateIntegrationPlan(
  capsule: PortableCapsule,
  errors: PortableCapsuleValidationIssue[],
  warnings: PortableCapsuleValidationIssue[],
): void {
  if ((capsule.tier === "standard" || capsule.tier === "deep") && capsule.integrationPlan.length === 0) {
    errors.push({
      code: "missing_integration_plan",
      message: "Standard and Deep capsules require an integration plan",
      path: "integrationPlan",
    });
  }
  if (capsule.tier === "quick" && capsule.integrationPlan.length > 0) {
    warnings.push({
      code: "quick_with_integration_steps",
      message: "Quick capsule contains integration steps",
      path: "integrationPlan",
    });
  }
  if (capsule.integrationPlan.length > MAX_INTEGRATION_STEPS) {
    errors.push({
      code: "too_many_integration_steps",
      message: `Capsule integration plan exceeds ${MAX_INTEGRATION_STEPS} steps`,
      path: "integrationPlan",
    });
  }

  const orders = capsule.integrationPlan.map((step) => step.order);
  const uniqueOrders = new Set(orders);
  if (uniqueOrders.size !== orders.length) {
    errors.push({ code: "duplicate_step_order", message: "Integration step orders must be unique", path: "integrationPlan" });
  }
  const sortedOrders = [...orders].sort((a, b) => a - b);
  for (let index = 0; index < sortedOrders.length; index++) {
    if (sortedOrders[index] !== index + 1) {
      errors.push({
        code: "non_contiguous_step_order",
        message: "Integration step orders must start at 1 and be contiguous",
        path: "integrationPlan",
      });
      break;
    }
  }

  for (const [index, step] of capsule.integrationPlan.entries()) {
    requireOneOf(
      step.mode,
      PORTABLE_CAPSULE_INTEGRATION_MODES,
      "invalid_integration_mode",
      "Invalid integration step mode",
      errors,
      `integrationPlan.${index}.mode`,
    );
    requireNonEmpty(step.title, "missing_step_title", "Integration step title is required", errors, `integrationPlan.${index}.title`);
    if (step.actions.length === 0) {
      errors.push({
        code: "missing_step_actions",
        message: "Integration step must include actions",
        path: `integrationPlan.${index}.actions`,
      });
    }
    if (step.mode === "auto" && step.verification.length === 0) {
      errors.push({
        code: "auto_step_without_verification",
        message: "Auto integration steps require verification",
        path: `integrationPlan.${index}.verification`,
      });
    }
    if (step.mode === "auto" && step.rollback.length === 0) {
      errors.push({
        code: "auto_step_without_rollback",
        message: "Auto integration steps require rollback",
        path: `integrationPlan.${index}.rollback`,
      });
    }
  }
}

function validateVerbatimPayloads(capsule: PortableCapsule, errors: PortableCapsuleValidationIssue[]): void {
  let totalBytes = 0;
  for (const [index, payload] of capsule.verbatimPayloads.entries()) {
    const payloadBytes = byteLength(payload.content);
    totalBytes += payloadBytes;
    if (payloadBytes > MAX_VERBATIM_PAYLOAD_BYTES) {
      errors.push({
        code: "payload_too_large",
        message: `Verbatim payload exceeds ${MAX_VERBATIM_PAYLOAD_BYTES} bytes`,
        path: `verbatimPayloads.${index}.content`,
      });
    }
    if (payload.checksum !== sha256Hex(payload.content)) {
      errors.push({
        code: "payload_checksum_mismatch",
        message: `Checksum mismatch for verbatim payload "${payload.name}"`,
        path: `verbatimPayloads.${index}.checksum`,
      });
    }
  }
  if (totalBytes > MAX_TOTAL_VERBATIM_BYTES) {
    errors.push({
      code: "verbatim_payloads_too_large",
      message: `Total verbatim payload content exceeds ${MAX_TOTAL_VERBATIM_BYTES} bytes`,
      path: "verbatimPayloads",
    });
  }
}

function validateLimits(capsule: PortableCapsule, errors: PortableCapsuleValidationIssue[]): void {
  const capsuleBytes = byteLength(JSON.stringify(capsule));
  if (capsuleBytes > MAX_CAPSULE_BYTES) {
    errors.push({
      code: "capsule_too_large",
      message: `Capsule exceeds ${MAX_CAPSULE_BYTES} bytes`,
    });
  }
}

function validateSanitation(
  capsule: PortableCapsule,
  errors: PortableCapsuleValidationIssue[],
  warnings: PortableCapsuleValidationIssue[],
): void {
  if (capsule.sanitation.secretLeakDetected || detectPotentialSecret(JSON.stringify(capsule))) {
    errors.push({
      code: "unsanitized_secret",
      message: "Capsule appears to contain an unsanitized secret",
      path: "sanitation",
    });
  }
  if (capsule.sanitation.redactions.length === 0) {
    warnings.push({
      code: "no_sanitation_redactions",
      message: "Sanitizer did not redact any values",
      path: "sanitation.redactions",
    });
  }
}

function requireNonEmpty(
  value: string,
  code: string,
  message: string,
  errors: PortableCapsuleValidationIssue[],
  path: string,
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ code, message, path });
  }
}

function requireEqual(
  value: unknown,
  expected: unknown,
  code: string,
  message: string,
  errors: PortableCapsuleValidationIssue[],
  path: string,
): void {
  if (value !== expected) {
    errors.push({ code, message, path });
  }
}

function requireOneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  code: string,
  message: string,
  errors: PortableCapsuleValidationIssue[],
  path: string,
): void {
  if (!allowed.includes(value as T)) {
    errors.push({ code, message, path });
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function containsAbsoluteHomePath(value: string, home: string | null | undefined): boolean {
  return Boolean(home && home !== "/" && value.includes(home));
}
