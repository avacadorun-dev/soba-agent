export type {
  WorkspaceErrorCode,
  WorkspaceKind,
  WorkspaceLifecyclePort,
  WorkspacePrepareRequest,
  WorkspaceRef,
} from "../../kernel/workspace/public";
export {
  createLocalWorkspaceRef,
  isWorkspaceKind,
  markWorkspaceKeep,
  WORKSPACE_KINDS,
  WorkspaceError,
} from "../../kernel/workspace/public";
export type { WorkspaceController } from "./service";
export {
  isWorkspaceError,
  prepareWorkspace,
  WorkspaceService,
  workspaceKindFromFlag,
} from "./service";
