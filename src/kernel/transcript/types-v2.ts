/**
 * Session Format v2 — Phase 2 additions.
 *
 * Extends Phase 1 session types with:
 * - SessionMigrationEntry: append-only migration marker
 * - SessionCursorEntry: persistent leaf cursor for reliable restart
 * - ContextCapsuleEntry: proactive compaction checkpoint with portable state
 * - SkillActivationEntry: skill activation/deactivation tracking
 *
 * Spec: internal-design-notes § Session Format v2
 */

import type { SessionEntryBase } from "./types";

// ─── Provider Identity & Capabilities ───

export interface ProviderIdentity {
  adapterId: string;
  endpointOrigin: string;
  model: string;
}

export interface ProviderCapabilities {
  nativeCompaction: boolean;
  structuredOutput: boolean;
  developerMessages: boolean;
  continuationCompatibilityKey?: string;
}

// ─── Native Continuation ───

export interface NativeContinuation {
  provider: ProviderIdentity;
  compatibilityKey: string;
  responseId?: string;
  /** Opaque provider-native compaction items (not inspectable) */
  items: unknown[];
}

// ─── Skill Activation ───

export interface ActivatedSkillRef {
  name: string;
  scope: "project" | "user" | "bundled";
  revision: string;
  contentHash: string;
}

export interface SkillActivationEntry extends SessionEntryBase {
  type: "skill_activation";
  action: "activate" | "deactivate";
  skill: ActivatedSkillRef;
}

// ─── Context Capsule ───

export type CapsuleTrigger =
  | "hard_limit"
  | "context_overflow"
  | "user_request"
  | "turn_complete"
  | "milestone"
  | "plan_pivot";

export interface PortableContextState {
  goal: string;
  constraints: string[];
  completed: string[];
  inProgress: string[];
  pending: string[];
  decisions: Array<{ decision: string; rationale?: string }>;
  blockers: string[];
  nextSteps: string[];
}

export interface ArtifactLedger {
  readFiles: string[];
  modifiedFiles: string[];
  verificationCommands: string[];
  verificationStatus: "passed" | "failed" | "unknown";
  checkpointSummaries?: string[];
}

export interface ContextCapsuleEntry extends SessionEntryBase {
  type: "context_capsule";
  checkpointId: string;
  trigger: CapsuleTrigger;
  strategy: "native_portable" | "portable_only" | "deterministic";
  quality: "native" | "portable" | "degraded";
  portableState: PortableContextState;
  artifacts: ArtifactLedger;
  activatedSkills: ActivatedSkillRef[];
  nativeContinuation?: NativeContinuation;
  provenance: {
    firstCompactedEntryId: string;
    firstKeptEntryId: string;
    sourceEntryIds: string[];
  };
  metrics: {
    effectiveTokensBefore: number;
    estimatedTokensAfter: number;
    reclaimedTokens: number;
    savingsRatio: number;
    generationDurationMs: number;
  };
}

// ─── Migration & Cursor ───

export interface SessionMigrationEntry {
  type: "session_migration";
  timestamp: string;
  fromVersion: 1;
  toVersion: 2;
}

export interface SessionCursorEntry {
  type: "session_cursor";
  timestamp: string;
  leafId: string | null;
  reason: "append" | "rewind" | "reset";
}

// ─── Union of all v2 sidecar/tree entries ───

/**
 * Phase 2 entries that participate in the session tree.
 */
export type SessionEntryV2 = ContextCapsuleEntry | SkillActivationEntry;

/**
 * Phase 2 sidecar entries (not part of conversation tree, not sent to LLM).
 */
export type SidecarEntryV2 = SessionMigrationEntry | SessionCursorEntry;

// ─── Type guards ───

export function isContextCapsuleEntry(entry: { type: string }): entry is ContextCapsuleEntry {
  return entry.type === "context_capsule";
}

export function isSkillActivationEntry(entry: { type: string }): entry is SkillActivationEntry {
  return entry.type === "skill_activation";
}

export function isSessionMigrationEntry(entry: { type: string }): entry is SessionMigrationEntry {
  return entry.type === "session_migration";
}

export function isSessionCursorEntry(entry: { type: string }): entry is SessionCursorEntry {
  return entry.type === "session_cursor";
}

// ─── Checkpoint ID generation ───

/**
 * Generate a unique checkpoint ID in the format ck_<12 lowercase hex chars>.
 */
export function generateCheckpointId(existing: Set<string>): string {
  for (let i = 0; i < 100; i++) {
    const hex = Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    const id = `ck_${hex}`;
    if (!existing.has(id)) return id;
  }
  const fallbackHex = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 12).padEnd(12, "0");
  return `ck_${fallbackHex}`;
}

/**
 * Validate a checkpoint ID format.
 */
export function isValidCheckpointId(id: string): boolean {
  return /^ck_[0-9a-f]{12}$/.test(id);
}
