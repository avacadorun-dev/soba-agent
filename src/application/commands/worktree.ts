import type { WorkspaceController, WorkspaceRef } from "../workspace/public";

export type WorktreeCommandView =
  | { kind: "not_configured" }
  | { kind: "usage" }
  | { kind: "status"; workspace: WorkspaceRef }
  | { kind: "kept"; workspace: WorkspaceRef }
  | { kind: "cleaned"; workspace: WorkspaceRef }
  | { kind: "not_worktree"; workspace: WorkspaceRef }
  | { kind: "error"; message: string };

export async function executeWorktreeCommand(input: {
  args: string[];
  controller?: WorkspaceController;
}): Promise<WorktreeCommandView> {
  const { args, controller } = input;
  if (!controller) return { kind: "not_configured" };

  const action = args[0]?.toLowerCase();
  if (!action) {
    return { kind: "status", workspace: controller.getWorkspace() };
  }

  if (action === "keep") {
    const workspace = controller.getWorkspace();
    if (workspace.kind !== "worktree") {
      return { kind: "not_worktree", workspace };
    }
    return { kind: "kept", workspace: controller.keep() };
  }

  if (action === "cleanup") {
    const workspace = controller.getWorkspace();
    if (workspace.kind !== "worktree") {
      return { kind: "not_worktree", workspace };
    }
    try {
      await controller.cleanup();
    } catch (error) {
      return {
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return { kind: "cleaned", workspace: controller.getWorkspace() };
  }

  return { kind: "usage" };
}
