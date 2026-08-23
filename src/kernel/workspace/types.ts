export type WorkspaceKind = "local" | "worktree";

export const WORKSPACE_KINDS = ["local", "worktree"] as const satisfies readonly WorkspaceKind[];

export function isWorkspaceKind(value: string): value is WorkspaceKind {
  return value === "local" || value === "worktree";
}

export interface WorkspaceRef {
  id: string;
  kind: WorkspaceKind;
  sourceRoot: string;
  executionRoot: string;
  /** Root registered with git for a linked worktree; executionRoot may be a project subdirectory. */
  checkoutRoot?: string;
  canonicalRoot: string;
  branch?: string;
  head?: string;
  keep: boolean;
}

export interface WorkspacePrepareRequest {
  kind: WorkspaceKind;
  sourceRoot: string;
  keep?: boolean;
}

export type WorkspaceErrorCode =
  | "not_a_git_repository"
  | "git_unavailable"
  | "already_in_soba_worktree"
  | "prepare_failed"
  | "cleanup_refused"
  | "cleanup_failed"
  | "workspace_not_prepared";

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

export function createLocalWorkspaceRef(input: {
  sourceRoot: string;
  canonicalRoot: string;
  id?: string;
}): WorkspaceRef {
  return {
    id: input.id ?? "ws_local",
    kind: "local",
    sourceRoot: input.sourceRoot,
    executionRoot: input.sourceRoot,
    canonicalRoot: input.canonicalRoot,
    keep: true,
  };
}

export function markWorkspaceKeep(workspace: WorkspaceRef): WorkspaceRef {
  return { ...workspace, keep: true };
}
