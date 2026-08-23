import type { CommandResult } from "../public";
import { executeWorktreeCommand } from "../public";
import type { CommandContext } from "./index";

export async function handleWorktree(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const view = await executeWorktreeCommand({
    args,
    controller: ctx.workspaceService,
  });

  if (view.kind === "not_configured" || view.kind === "usage") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.worktree.usage"),
    });
    return { handled: true };
  }

  if (view.kind === "error") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.worktree.cleanupFailed", { message: view.message }),
    });
    return { handled: true };
  }

  if (view.kind === "not_worktree") {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.worktree.notWorktree"),
    });
    return { handled: true };
  }

  if (view.kind === "kept") {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.worktree.kept", { path: view.workspace.executionRoot }),
    });
    return { handled: true };
  }

  if (view.kind === "cleaned") {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.worktree.cleaned"),
    });
    return { handled: true };
  }

  const workspace = view.workspace;
  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: [
      ctx.i18n.t("command.worktree.kind", { kind: workspace.kind }),
      ctx.i18n.t("command.worktree.source", { path: workspace.sourceRoot }),
      ctx.i18n.t("command.worktree.execution", { path: workspace.executionRoot }),
      ctx.i18n.t("command.worktree.branch", { branch: workspace.branch ?? "—" }),
      ctx.i18n.t("command.worktree.keep", {
        value: workspace.keep ? "yes" : "no",
      }),
    ].join("\n"),
  });
  return { handled: true };
}
