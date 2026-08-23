import { FilesystemProjectIdentityResolver } from "../../infrastructure/persistence/skills/project-trust-storage";
import { GitWorkspaceLifecycle } from "../../infrastructure/workspace/git-workspace";
import type { WorkspaceLifecyclePort } from "../../kernel/workspace/public";

export interface CreateWorkspaceLifecycleOptions {
  worktreesHome?: string;
  createId?: () => string;
}

export function createWorkspaceLifecycle(
  options: CreateWorkspaceLifecycleOptions = {},
): WorkspaceLifecyclePort {
  return new GitWorkspaceLifecycle({
    identityResolver: new FilesystemProjectIdentityResolver(),
    worktreesHome: options.worktreesHome,
    createId: options.createId,
  });
}
