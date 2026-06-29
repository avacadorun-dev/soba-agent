export interface CheckpointArgs {
  kind: "milestone" | "plan_pivot";
  reason: string;
  nextDirection?: string;
  completed?: string[];
  pending?: string[];
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
