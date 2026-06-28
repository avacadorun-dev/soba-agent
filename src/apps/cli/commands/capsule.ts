import type { CommandResult, ContextCapsuleEntry } from "../../../application/cli/public";
import {
  isContextCapsuleEntry,
  PortableCapsuleService,
  PortableCapsuleServiceError,
} from "../../../application/cli/public";
import type { CommandContext } from "./index";

export function handleCapsule(args: string[], ctx: CommandContext): CommandResult {
  const subcommand = args[0]?.toLowerCase();
  if (subcommand === "create") {
    return handleCapsuleCreate(args.slice(1), ctx);
  }
  if (subcommand === "export") {
    return handleCapsuleExport(args.slice(1), ctx);
  }
  if (subcommand === "load") {
    return handleCapsuleLoad(args.slice(1), ctx);
  }

  const checkpointId = args[0];
  const entries = ctx.session.getEntries();
  const capsules = entries.filter((entry) => isContextCapsuleEntry(entry)) as ContextCapsuleEntry[];

  if (!checkpointId) {
    const message =
      capsules.length > 0
        ? [
            ctx.i18n.t("command.capsule.title"),
            ...capsules.map((entry) =>
              `  ${entry.checkpointId}  ${entry.strategy}  ${entry.quality}  ${entry.timestamp}`
            ),
          ].join("\n")
        : ctx.i18n.t("command.capsule.empty");
    ctx.renderer.emit({ type: "info", timestamp: Date.now(), message });
    return { handled: true };
  }

  const capsule = capsules.find(
    (entry) => entry.checkpointId === checkpointId || entry.checkpointId.startsWith(checkpointId)
  );

  if (!capsule) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.capsule.notFound", { id: checkpointId }),
    });
    return { handled: true };
  }

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
      })
    );
  }

  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: lines.join("\n"),
  });
  return { handled: true };
}

function handleCapsuleCreate(args: string[], ctx: CommandContext): CommandResult {
  const objective = stripWrappingQuotes(args.join(" ").trim());
  if (!objective) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.capsule.create.usage"),
    });
    return { handled: true };
  }

  const service = new PortableCapsuleService({ cwd: ctx.session.getCwd() });
  try {
    const result = service.createFromSession(ctx.session, { objective });
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.capsule.create.success", {
        id: result.capsule.id,
        checkpointId: result.capsule.provenance.checkpointId ?? "",
        path: result.path,
      }),
    });
  } catch (error) {
    emitCapsuleError(error, ctx);
  }

  return { handled: true };
}

function handleCapsuleExport(args: string[], ctx: CommandContext): CommandResult {
  const checkpointId = args[0];
  const destinationPath = args[1];
  if (!checkpointId || !destinationPath) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.capsule.export.usage"),
    });
    return { handled: true };
  }

  const service = new PortableCapsuleService({ cwd: ctx.session.getCwd() });
  try {
    const result = service.exportCheckpoint(ctx.session, checkpointId, { destinationPath });
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.capsule.export.success", {
        id: result.capsule.id,
        checkpointId: result.capsule.provenance.checkpointId ?? "",
        path: result.path,
      }),
    });
  } catch (error) {
    emitCapsuleError(error, ctx);
  }

  return { handled: true };
}

function handleCapsuleLoad(args: string[], ctx: CommandContext): CommandResult {
  const capsulePath = args[0];
  if (!capsulePath) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.capsule.load.usage"),
    });
    return { handled: true };
  }

  const service = new PortableCapsuleService({ cwd: ctx.session.getCwd() });
  try {
    const result = service.loadCapsule(capsulePath);
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.capsule.load.success", {
        id: result.capsule.id,
        path: result.path,
      }),
    });
    return { handled: false, prompt: result.prompt };
  } catch (error) {
    emitCapsuleError(error, ctx);
    return { handled: true };
  }
}

function emitCapsuleError(error: unknown, ctx: CommandContext): void {
  const message =
    error instanceof PortableCapsuleServiceError
      ? `${error.message}${error.issues.length > 0 ? `: ${error.issues.map((issue) => issue.code).join(", ")}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);

  ctx.renderer.emit({
    type: "error",
    timestamp: Date.now(),
    message: ctx.i18n.t("command.capsule.error", { error: message }),
  });
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}
