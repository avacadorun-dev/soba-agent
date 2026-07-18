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
    summary: truncateText(memorySummary(capsule, goal), MAX_SUMMARY_LENGTH),
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
    `Context capsule: ${capsule.checkpointId}`,
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

function memorySummary(capsule: ContextCapsuleEntry, goal: string): string {
  const state = capsule.portableState;
  const progress = state.completed[0]
    ? `Completed: ${state.completed[0]}${state.completed.length > 1 ? ` (+${state.completed.length - 1})` : ""}`
    : state.inProgress[0]
      ? `In progress: ${state.inProgress[0]}`
      : state.pending[0]
        ? `Pending: ${state.pending[0]}`
        : `Goal: ${goal}`;
  return `Context capsule ${capsule.checkpointId}: ${progress}`;
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
