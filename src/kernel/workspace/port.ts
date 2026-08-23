import type { WorkspacePrepareRequest, WorkspaceRef } from "./types";

export interface WorkspaceLifecyclePort {
  prepare(request: WorkspacePrepareRequest): Promise<WorkspaceRef>;
  status(workspace: WorkspaceRef): Promise<WorkspaceRef>;
  keep(workspace: WorkspaceRef): WorkspaceRef;
  cleanup(workspace: WorkspaceRef): Promise<void>;
}
