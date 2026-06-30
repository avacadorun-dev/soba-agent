import type { ContextCapsuleEntry } from "../transcript/types-v2";
import type { MemoryCapsuleInput } from "./types";

const MAX_SUMMARY_LENGTH = 160;

export interface ContextCapsuleMemorySink {
  addCapsule(input: MemoryCapsuleInput): unknown;
}

export function contextCapsuleToMemoryInput(capsule: ContextCapsuleEntry, sessionId = ""): MemoryCapsuleInput {
  const goal = normalizeText(capsule.portableState.goal) || `Context capsule ${capsule.checkpointId}`;
  const tags = [
    "context-capsule",
    "checkpoint",
    capsule.trigger,
    capsule.strategy,
    capsule.quality,
  ];

  return {
    id: `mem_${capsule.checkpointId}`,
    type: "discovery",
    summary: truncateText(`Context capsule ${capsule.checkpointId}: ${goal}`, MAX_SUMMARY_LENGTH),
    detail: buildContextCapsuleMemoryDetail(capsule),
    context: {
      task: goal,
      sessionId,
      timestamp: capsule.timestamp,
    },
    priority: priorityForCapsule(capsule),
    tags,
    related: [],
  };
}

function buildContextCapsuleMemoryDetail(capsule: ContextCapsuleEntry): string {
  const state = capsule.portableState;
  const lines = [
    `Checkpoint: ${capsule.checkpointId}`,
    `Trigger: ${capsule.trigger}`,
    `Strategy: ${capsule.strategy}`,
    `Quality: ${capsule.quality}`,
    `Goal: ${state.goal}`,
    ...state.completed.map((item) => `Completed: ${item}`),
    ...state.inProgress.map((item) => `In progress: ${item}`),
    ...state.pending.map((item) => `Pending: ${item}`),
    ...state.decisions.map((item) => `Decision: ${item.rationale ? `${item.decision} (${item.rationale})` : item.decision}`),
    ...state.blockers.map((item) => `Blocker: ${item}`),
    ...state.nextSteps.map((item) => `Next: ${item}`),
    `Metrics: ${capsule.metrics.effectiveTokensBefore} -> ${capsule.metrics.estimatedTokensAfter} tokens, reclaimed ${capsule.metrics.reclaimedTokens}.`,
  ];

  return lines.map(normalizeText).filter(Boolean).join("\n");
}

function priorityForCapsule(capsule: ContextCapsuleEntry): MemoryCapsuleInput["priority"] {
  if (capsule.trigger === "context_overflow" || capsule.trigger === "hard_limit") return "high";
  if (capsule.quality === "degraded") return "low";
  return "medium";
}

function normalizeText(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
