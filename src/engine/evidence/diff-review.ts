import type { EvidenceDiffFileSummary, EvidenceDiffSummary } from "./diff-summary";

export type DiffReviewDecision = "pending" | "accepted" | "rejected" | "mixed";

export type DiffReviewActionType =
  | "accept_file"
  | "reject_file"
  | "accept_hunk"
  | "reject_hunk"
  | "rollback_turn";

export type DiffReviewActionStatus = "recorded" | "unsupported" | "noop";

export type DiffReviewActor = "agent" | "user" | "system";

export interface DiffReviewHunkInput {
  id: string;
  path: string;
  header?: string;
  added?: number;
  removed?: number;
  mutationIds?: string[];
}

export interface DiffReviewHunkState {
  id: string;
  path: string;
  header?: string;
  added: number;
  removed: number;
  mutationIds: string[];
  decision: DiffReviewDecision;
}

export interface DiffReviewFileState {
  path: string;
  oldPath?: string;
  operation: EvidenceDiffFileSummary["operation"];
  added: number;
  removed: number;
  mutationIds: string[];
  decision: DiffReviewDecision;
  hunks: DiffReviewHunkState[];
}

export interface DiffReviewPlannedMutation {
  id: string;
  kind: "reject_file" | "reject_hunk" | "rollback_turn";
  files: string[];
  mutationIds: string[];
  summary: string;
}

export interface DiffReviewActionRecord {
  id: string;
  type: DiffReviewActionType;
  status: DiffReviewActionStatus;
  actor: DiffReviewActor;
  target: {
    path?: string;
    hunkId?: string;
    turnId?: string;
  };
  reason?: string;
  summary: string;
  mutationIds: string[];
  resultingMutation?: DiffReviewPlannedMutation;
  createdAt: string;
}

export interface DiffReviewState {
  version: 1;
  turnId: string;
  files: DiffReviewFileState[];
  actions: DiffReviewActionRecord[];
  rollback?: DiffReviewActionRecord;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDiffReviewStateInput {
  turnId: string;
  diff: EvidenceDiffSummary;
  hunks?: DiffReviewHunkInput[];
  now?: () => Date;
}

export interface ApplyDiffReviewActionInput {
  type: DiffReviewActionType;
  path?: string;
  hunkId?: string;
  actor?: DiffReviewActor;
  reason?: string;
  id?: string;
}

export interface ApplyDiffReviewActionOptions {
  now?: () => Date;
}

export function createDiffReviewState(input: CreateDiffReviewStateInput): DiffReviewState {
  const createdAt = (input.now ?? (() => new Date()))().toISOString();
  const hunksByPath = groupHunksByPath(input.hunks ?? []);

  return {
    version: 1,
    turnId: input.turnId,
    files: input.diff.files.map((file) => fileToReviewState(file, hunksByPath.get(file.path) ?? [])),
    actions: [],
    createdAt,
    updatedAt: createdAt,
  };
}

export function applyDiffReviewAction(
  state: DiffReviewState,
  input: ApplyDiffReviewActionInput,
  options: ApplyDiffReviewActionOptions = {},
): DiffReviewState {
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const next = cloneState(state);
  const actionId = input.id ?? `review_action_${String(next.actions.length + 1).padStart(4, "0")}`;

  if (next.rollback && input.type !== "rollback_turn") {
    return appendAction(next, {
      id: actionId,
      type: input.type,
      status: "noop",
      actor: input.actor ?? "agent",
      target: { path: input.path, hunkId: input.hunkId, turnId: next.turnId },
      reason: input.reason,
      summary: "Review action ignored because the turn is already rolled back.",
      mutationIds: [],
      createdAt,
    });
  }

  switch (input.type) {
    case "accept_file":
      return applyFileDecision(next, input, actionId, createdAt, "accepted");
    case "reject_file":
      return applyFileDecision(next, input, actionId, createdAt, "rejected");
    case "accept_hunk":
      return applyHunkDecision(next, input, actionId, createdAt, "accepted");
    case "reject_hunk":
      return applyHunkDecision(next, input, actionId, createdAt, "rejected");
    case "rollback_turn":
      return applyTurnRollback(next, input, actionId, createdAt);
  }
}

function fileToReviewState(file: EvidenceDiffFileSummary, hunks: DiffReviewHunkInput[]): DiffReviewFileState {
  return {
    path: file.path,
    oldPath: file.oldPath,
    operation: file.operation,
    added: file.added,
    removed: file.removed,
    mutationIds: file.mutationIds.slice(),
    decision: "pending",
    hunks: hunks.map((hunk) => ({
      id: hunk.id,
      path: hunk.path,
      header: hunk.header,
      added: Math.max(0, Math.floor(hunk.added ?? 0)),
      removed: Math.max(0, Math.floor(hunk.removed ?? 0)),
      mutationIds: hunk.mutationIds?.slice() ?? [],
      decision: "pending",
    })),
  };
}

function applyFileDecision(
  state: DiffReviewState,
  input: ApplyDiffReviewActionInput,
  actionId: string,
  createdAt: string,
  decision: "accepted" | "rejected",
): DiffReviewState {
  const file = input.path ? state.files.find((candidate) => candidate.path === input.path) : undefined;
  if (!file) {
    return appendAction(state, unsupportedAction(state, input, actionId, createdAt, "File review target was not found."));
  }

  file.decision = decision;
  file.hunks = file.hunks.map((hunk) => ({ ...hunk, decision }));

  const resultingMutation = decision === "rejected"
    ? plannedMutation(actionId, "reject_file", [file.path], file.mutationIds, `Rejected file change: ${file.path}`)
    : undefined;

  return appendAction(state, {
    id: actionId,
    type: input.type,
    status: "recorded",
    actor: input.actor ?? "agent",
    target: { path: file.path, turnId: state.turnId },
    reason: input.reason,
    summary: `${decision === "accepted" ? "Accepted" : "Rejected"} file change: ${file.path}`,
    mutationIds: file.mutationIds.slice(),
    resultingMutation,
    createdAt,
  });
}

function applyHunkDecision(
  state: DiffReviewState,
  input: ApplyDiffReviewActionInput,
  actionId: string,
  createdAt: string,
  decision: "accepted" | "rejected",
): DiffReviewState {
  const file = input.path ? state.files.find((candidate) => candidate.path === input.path) : undefined;
  const hunk = file?.hunks.find((candidate) => candidate.id === input.hunkId);
  if (!file || !hunk) {
    return appendAction(state, unsupportedAction(state, input, actionId, createdAt, "Hunk review target was not found."));
  }

  hunk.decision = decision;
  file.decision = fileDecisionFromHunks(file);

  const resultingMutation = decision === "rejected"
    ? plannedMutation(actionId, "reject_hunk", [file.path], hunk.mutationIds, `Rejected hunk ${hunk.id} in ${file.path}`)
    : undefined;

  return appendAction(state, {
    id: actionId,
    type: input.type,
    status: "recorded",
    actor: input.actor ?? "agent",
    target: { path: file.path, hunkId: hunk.id, turnId: state.turnId },
    reason: input.reason,
    summary: `${decision === "accepted" ? "Accepted" : "Rejected"} hunk ${hunk.id} in ${file.path}`,
    mutationIds: hunk.mutationIds.slice(),
    resultingMutation,
    createdAt,
  });
}

function applyTurnRollback(
  state: DiffReviewState,
  input: ApplyDiffReviewActionInput,
  actionId: string,
  createdAt: string,
): DiffReviewState {
  if (state.rollback) {
    return appendAction(state, {
      id: actionId,
      type: "rollback_turn",
      status: "noop",
      actor: input.actor ?? "agent",
      target: { turnId: state.turnId },
      reason: input.reason,
      summary: "Rollback ignored because the turn is already rolled back.",
      mutationIds: [],
      createdAt,
    });
  }

  for (const file of state.files) {
    file.decision = "rejected";
    file.hunks = file.hunks.map((hunk) => ({ ...hunk, decision: "rejected" }));
  }

  const files = state.files.map((file) => file.path);
  const mutationIds = unique(state.files.flatMap((file) => file.mutationIds));
  const action: DiffReviewActionRecord = {
    id: actionId,
    type: "rollback_turn",
    status: "recorded",
    actor: input.actor ?? "agent",
    target: { turnId: state.turnId },
    reason: input.reason,
    summary: `Rollback requested for ${state.turnId}.`,
    mutationIds,
    resultingMutation: plannedMutation(
      actionId,
      "rollback_turn",
      files,
      mutationIds,
      `Rollback requested for ${state.turnId}.`,
    ),
    createdAt,
  };
  state.rollback = action;
  return appendAction(state, action);
}

function fileDecisionFromHunks(file: DiffReviewFileState): DiffReviewDecision {
  if (file.hunks.length === 0) return file.decision;
  const decisions = new Set(file.hunks.map((hunk) => hunk.decision));
  if (decisions.size === 1) return file.hunks[0]?.decision ?? "pending";
  return "mixed";
}

function unsupportedAction(
  state: DiffReviewState,
  input: ApplyDiffReviewActionInput,
  actionId: string,
  createdAt: string,
  summary: string,
): DiffReviewActionRecord {
  return {
    id: actionId,
    type: input.type,
    status: "unsupported",
    actor: input.actor ?? "agent",
    target: { path: input.path, hunkId: input.hunkId, turnId: state.turnId },
    reason: input.reason,
    summary,
    mutationIds: [],
    createdAt,
  };
}

function appendAction(state: DiffReviewState, action: DiffReviewActionRecord): DiffReviewState {
  state.actions.push(action);
  state.updatedAt = action.createdAt;
  return state;
}

function plannedMutation(
  actionId: string,
  kind: DiffReviewPlannedMutation["kind"],
  files: string[],
  mutationIds: string[],
  summary: string,
): DiffReviewPlannedMutation {
  return {
    id: `review_mutation_${actionId}`,
    kind,
    files: files.slice(),
    mutationIds: unique(mutationIds),
    summary,
  };
}

function cloneState(state: DiffReviewState): DiffReviewState {
  return {
    ...state,
    files: state.files.map((file) => ({
      ...file,
      mutationIds: file.mutationIds.slice(),
      hunks: file.hunks.map((hunk) => ({ ...hunk, mutationIds: hunk.mutationIds.slice() })),
    })),
    actions: state.actions.map((action) => cloneAction(action)),
    rollback: state.rollback ? cloneAction(state.rollback) : undefined,
  };
}

function cloneAction(action: DiffReviewActionRecord): DiffReviewActionRecord {
  return {
    ...action,
    target: { ...action.target },
    mutationIds: action.mutationIds.slice(),
    resultingMutation: action.resultingMutation
      ? {
          ...action.resultingMutation,
          files: action.resultingMutation.files.slice(),
          mutationIds: action.resultingMutation.mutationIds.slice(),
        }
      : undefined,
  };
}

function groupHunksByPath(hunks: DiffReviewHunkInput[]): Map<string, DiffReviewHunkInput[]> {
  const byPath = new Map<string, DiffReviewHunkInput[]>();
  for (const hunk of hunks) {
    const existing = byPath.get(hunk.path) ?? [];
    existing.push(hunk);
    byPath.set(hunk.path, existing);
  }
  return byPath;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
