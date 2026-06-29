/**
 * Mapping from internal ContextCapsuleEntry checkpoints to PortableCapsule v1.
 */

import type { ContextCapsuleEntry, PortableContextState } from "../../kernel/transcript/types-v2";
import { sha256Hex } from "./hash";
import { sanitizePortableCapsule } from "./sanitizer";
import {
  PORTABLE_CAPSULE_SCHEMA,
  PORTABLE_CAPSULE_VERSION,
  type PortableCapsule,
  type PortableCapsuleCreationOptions,
  type PortableCapsuleVerbatimPayload,
} from "./types";

export function buildPortableCapsuleFromCheckpoint(
  checkpoint: ContextCapsuleEntry,
  options: PortableCapsuleCreationOptions = {},
): PortableCapsule {
  const objective = options.objective ?? checkpoint.portableState.goal;
  const capsule: PortableCapsule = {
    schema: PORTABLE_CAPSULE_SCHEMA,
    version: PORTABLE_CAPSULE_VERSION,
    id: options.id ?? portableCapsuleIdFromCheckpoint(checkpoint.checkpointId),
    title: options.title ?? titleFromObjective(objective),
    createdAt: options.createdAt ?? new Date().toISOString(),
    sender: options.sender,
    intendedReceiver: options.intendedReceiver ?? "another SOBA-compatible agent",
    objective,
    tier: options.tier ?? "quick",
    category: options.category ?? "conversation_thread",
    archetype: options.archetype ?? "handoff",
    dispatchSummary: buildDispatchSummary(checkpoint.portableState),
    coreContent: buildCoreContent(checkpoint.portableState),
    patterns: checkpoint.portableState.decisions.map((decision, index) => ({
      name: `decision-${index + 1}`,
      description: decision.rationale ? `${decision.decision} — ${decision.rationale}` : decision.decision,
    })),
    assumptions: checkpoint.portableState.constraints,
    signals: checkpoint.portableState.nextSteps,
    artifacts: checkpoint.artifacts,
    integrationPlan: options.integrationPlan ?? [],
    verbatimPayloads: normalizePayloads(options.verbatimPayloads ?? []),
    sanitation: {
      checkedAt: options.createdAt ?? new Date().toISOString(),
      redactions: [],
      secretLeakDetected: false,
    },
    provenance: {
      source: "session_checkpoint",
      checkpointId: checkpoint.checkpointId,
    },
  };

  return sanitizePortableCapsule(capsule, {
    now: new Date(capsule.createdAt),
    homeDirectory: options.homeDirectory,
  });
}

function buildDispatchSummary(state: PortableContextState): string {
  const completed = state.completed.length > 0 ? ` Completed: ${state.completed.join("; ")}.` : "";
  const blockers = state.blockers.length > 0 ? ` Blockers: ${state.blockers.join("; ")}.` : "";
  return `${state.goal}.${completed}${blockers}`.trim();
}

function buildCoreContent(state: PortableContextState): string[] {
  const content = [
    `Goal: ${state.goal}`,
    ...state.completed.map((item) => `Completed: ${item}`),
    ...state.inProgress.map((item) => `In progress: ${item}`),
    ...state.pending.map((item) => `Pending: ${item}`),
    ...state.decisions.map((item) => `Decision: ${item.rationale ? `${item.decision} (${item.rationale})` : item.decision}`),
    ...state.blockers.map((item) => `Blocker: ${item}`),
    ...state.nextSteps.map((item) => `Next: ${item}`),
  ];
  return content.slice(0, 100);
}

function normalizePayloads(
  payloads: Array<Omit<PortableCapsuleVerbatimPayload, "checksum"> | PortableCapsuleVerbatimPayload>,
): PortableCapsuleVerbatimPayload[] {
  return payloads.map((payload) => ({
    ...payload,
    checksum: "checksum" in payload ? payload.checksum : sha256Hex(payload.content),
  }));
}

function portableCapsuleIdFromCheckpoint(checkpointId: string): string {
  return `pc_${sha256Hex(checkpointId).slice(0, 12)}`;
}

function titleFromObjective(objective: string): string {
  const trimmed = objective.trim();
  if (trimmed.length === 0) return "Portable capsule";
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}
