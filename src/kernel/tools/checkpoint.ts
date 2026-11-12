export type PlanItemStatus = "pending" | "active" | "done" | "blocked";

export interface PlanItem {
  title: string;
  status: PlanItemStatus;
  evidenceIds?: string[];
}

export interface CheckpointArgs {
  kind: "milestone" | "plan_pivot";
  reason: string;
  nextDirection?: string;
  completed?: string[];
  pending?: string[];
  /** Structured plan state: ordered items with status and evidence links. Replaces the persisted plan. */
  items?: PlanItem[];
}

export interface CheckpointEvent {
  kind: "milestone" | "plan_pivot";
  reason: string;
  nextDirection?: string;
  completed: string[];
  pending: string[];
  timestamp: string;
}

export function extractCheckpointEvent(args: CheckpointArgs): CheckpointEvent {
  return {
    kind: args.kind,
    reason: args.reason,
    nextDirection: args.nextDirection,
    completed: args.completed ?? [],
    pending: args.pending ?? [],
    timestamp: new Date().toISOString(),
  };
}
