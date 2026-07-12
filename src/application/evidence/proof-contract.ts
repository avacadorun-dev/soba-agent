import { createHash } from "node:crypto";
import { redactSecrets } from "../../kernel/tools/errors";

export const PROOF_BUNDLE_VERSION = 1 as const;
export const PROOF_DIGEST_ALGORITHM = "sha256" as const;
export const PROOF_ID_PREFIX = "proof_";
export const RUN_ID_PREFIX = "run_";

export interface ProofIntegrity {
  algorithm: typeof PROOF_DIGEST_ALGORITHM;
  digest: string;
}

export interface SealedProofMetadata {
  proofId: string;
  runId: string;
  integrity: ProofIntegrity;
}

const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|apiKey|authorization|cookie|credential|password|secret|access[_-]?token|accessToken|auth[_-]?token|authToken|refresh[_-]?token|refreshToken)/i;
const REDACTED = "[REDACTED]";

/**
 * Produces the persisted Proof Bundle v1 representation.
 *
 * Integrity covers the recursively redacted, canonical document while omitting
 * `proofId` and `integrity`. `runId` remains covered. This makes proof IDs
 * content-addressed without introducing a circular digest dependency.
 */
export function sealProofBundle(bundle: Record<string, unknown>): Record<string, unknown> & SealedProofMetadata {
  const sanitized = sanitizeProofValue(bundle);
  if (!isRecord(sanitized)) throw new Error("Proof bundle must be an object.");

  const sessionId = stringField(sanitized.sessionId);
  const turnId = stringField(sanitized.turnId);
  const runId = stableRunId(sessionId, turnId);
  const unsigned: Record<string, unknown> = { ...sanitized, version: PROOF_BUNDLE_VERSION, runId };
  delete unsigned.proofId;
  delete unsigned.integrity;
  const digest = proofDigest(unsigned);

  return {
    ...unsigned,
    runId,
    proofId: `${PROOF_ID_PREFIX}${digest.slice("sha256:".length, "sha256:".length + 24)}`,
    integrity: { algorithm: PROOF_DIGEST_ALGORITHM, digest },
  };
}

export function proofDigest(bundle: Record<string, unknown>): string {
  const unsigned = sanitizeProofValue(bundle);
  if (!isRecord(unsigned)) throw new Error("Proof bundle must be an object.");
  delete unsigned.proofId;
  delete unsigned.integrity;
  return `sha256:${createHash("sha256").update(canonicalJson(unsigned), "utf8").digest("hex")}`;
}

export function stableRunId(sessionId: string, turnId = ""): string {
  const identity = canonicalJson({
    sessionId: sessionId || "unknown-session",
    turnId: turnId || "unknown-turn",
  });
  const digest = createHash("sha256").update(identity, "utf8").digest("hex");
  return `${RUN_ID_PREFIX}${digest.slice(0, 24)}`;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sanitizeProofValue(value: unknown, key?: string): unknown {
  if (key && SECRET_KEY_PATTERN.test(key)) return REDACTED;
  if (typeof value === "string") return redactSecrets(value);
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeProofValue(item));
  if (!isRecord(value)) return value === undefined ? undefined : String(value);

  const sanitized: Record<string, unknown> = {};
  for (const [field, child] of Object.entries(value)) {
    const result = sanitizeProofValue(child, field);
    if (result !== undefined) sanitized[field] = result;
  }
  return sanitized;
}

export function containsPotentialProofSecret(value: unknown, key?: string): boolean {
  if (key && SECRET_KEY_PATTERN.test(key) && value !== REDACTED) return true;
  if (typeof value === "string") return redactSecrets(value) !== value;
  if (Array.isArray(value)) return value.some((item) => containsPotentialProofSecret(item));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([field, child]) => containsPotentialProofSecret(child, field));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
