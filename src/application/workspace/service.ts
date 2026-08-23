import type { WorkspaceLifecyclePort } from "../../kernel/workspace/port";
import {
  WorkspaceError,
  type WorkspaceKind,
  type WorkspacePrepareRequest,
  type WorkspaceRef,
} from "../../kernel/workspace/public";

export interface WorkspaceController {
  getWorkspace(): WorkspaceRef;
  keep(): WorkspaceRef;
  cleanup(): Promise<void>;
}

export class WorkspaceService implements WorkspaceController {
  private readonly lifecycle: WorkspaceLifecyclePort;
  private workspace: WorkspaceRef;

  constructor(lifecycle: WorkspaceLifecyclePort, workspace: WorkspaceRef) {
    this.lifecycle = lifecycle;
    this.workspace = workspace;
  }

  getWorkspace(): WorkspaceRef {
    return this.workspace;
  }

  keep(): WorkspaceRef {
    this.workspace = this.lifecycle.keep(this.workspace);
    return this.workspace;
  }

  async cleanup(): Promise<void> {
    await this.lifecycle.cleanup(this.workspace);
    this.workspace = this.lifecycle.keep(this.workspace);
  }

  async refresh(): Promise<WorkspaceRef> {
    this.workspace = await this.lifecycle.status(this.workspace);
    return this.workspace;
  }
}

export async function prepareWorkspace(
  lifecycle: WorkspaceLifecyclePort,
  request: WorkspacePrepareRequest,
): Promise<WorkspaceRef> {
  return lifecycle.prepare(request);
}

export function workspaceKindFromFlag(worktree: boolean): WorkspaceKind {
  return worktree ? "worktree" : "local";
}

export function isWorkspaceError(error: unknown): error is WorkspaceError {
  return error instanceof WorkspaceError;
}
