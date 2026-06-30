import type { CapsuleCommandView, CommandResult } from "../public";
import { executeCapsuleCommand } from "../public";
import type { CommandContext } from "./index";

export function handleCapsule(args: string[], ctx: CommandContext): CommandResult {
  const emittedCreateStart = emitCapsuleCreateStart(ctx, args);
  const view = executeCapsuleCommand({
    args,
    session: ctx.session,
    createPortableCapsuleService: ctx.portableCapsuleServiceFactory,
    projectMemory: ctx.projectMemory,
  });
  renderCapsuleCommandView(ctx, view);
  if (emittedCreateStart) {
    ctx.renderer.emit({ type: "capsule_create_done", timestamp: Date.now() });
  }
  return view.kind === "loaded" ? { handled: false, prompt: view.prompt } : { handled: true };
}

function emitCapsuleCreateStart(ctx: CommandContext, args: string[]): boolean {
  const subcommand = args[0]?.toLowerCase();
  const objective = args.slice(1).join(" ").trim();
  if (subcommand !== "create" || objective.length === 0) return false;
  ctx.renderer.emit({
    type: "capsule_create_start",
    timestamp: Date.now(),
    message: ctx.i18n.t("command.capsule.create.start"),
  });
  return true;
}

function renderCapsuleCommandView(ctx: CommandContext, view: CapsuleCommandView): void {
  if (view.kind === "empty") {
    ctx.renderer.emit({ type: "info", timestamp: Date.now(), message: ctx.i18n.t("command.capsule.empty") });
    return;
  }

  if (view.kind === "list") {
    const message = [
      ctx.i18n.t("command.capsule.title"),
      ...view.capsules.map((capsule) => `  ${capsule.checkpointId}  ${capsule.strategy}  ${capsule.quality}  ${capsule.timestamp}`),
    ].join("\n");
    ctx.renderer.emit({ type: "info", timestamp: Date.now(), message });
    return;
  }

  if (view.kind === "not_found") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.capsule.notFound", { id: view.checkpointId }),
    });
    return;
  }

  if (view.kind === "details") {
    emitCapsuleDetails(ctx, view);
    return;
  }

  if (view.kind === "usage") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t(`command.capsule.${view.command}.usage`),
    });
    return;
  }

  if (view.kind === "error") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.capsule.error", { error: view.message }),
    });
    return;
  }

  const successKey =
    view.kind === "created"
      ? "command.capsule.create.success"
      : view.kind === "exported"
        ? "command.capsule.export.success"
        : "command.capsule.load.success";
  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: ctx.i18n.t(successKey, {
      id: view.id,
      checkpointId: view.kind === "loaded" ? "" : view.checkpointId,
      path: view.path,
    }),
  });
}

function emitCapsuleDetails(ctx: CommandContext, view: Extract<CapsuleCommandView, { kind: "details" }>): void {
  const { capsule } = view;
  const lines = [
    ctx.i18n.t("command.capsule.details.title", { id: capsule.checkpointId }),
    ctx.i18n.t("command.capsule.details.strategy", { strategy: capsule.strategy }),
    ctx.i18n.t("command.capsule.details.quality", { quality: capsule.quality }),
    ctx.i18n.t("command.capsule.details.timestamp", { timestamp: capsule.timestamp }),
    ctx.i18n.t("command.capsule.details.trigger", { trigger: capsule.trigger }),
    ctx.i18n.t("command.capsule.details.metrics", {
      before: capsule.metrics.effectiveTokensBefore,
      after: capsule.metrics.estimatedTokensAfter,
      saved: capsule.metrics.reclaimedTokens,
      ratio: (capsule.metrics.savingsRatio * 100).toFixed(1),
    }),
    ctx.i18n.t("command.capsule.details.portableState", {
      goal: capsule.portableState.goal.slice(0, 100),
      completed: capsule.portableState.completed.length,
      pending: capsule.portableState.pending.length,
      blockers: capsule.portableState.blockers.length,
    }),
  ];

  if (capsule.nativeContinuation) {
    lines.push(
      ctx.i18n.t("command.capsule.details.nativeContinuation", {
        provider: capsule.nativeContinuation.provider.adapterId,
        compatKey: capsule.nativeContinuation.compatibilityKey.slice(0, 20),
      }),
    );
  }

  ctx.renderer.emit({ type: "info", timestamp: Date.now(), message: lines.join("\n") });
}
