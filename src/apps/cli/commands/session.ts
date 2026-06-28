import type {
  CommandResult,
  FlightRecordEntry,
  RuntimeSessionHandle,
  SessionLifecycleService,
} from "../../../application/cli/public";
import { buildBudgetStatusView, buildSessionStatusView } from "../../../application/cli/public";
import type { CommandContext } from "./index";

export function handleSession(_args: string[], ctx: CommandContext): CommandResult {
  const contextSnapshot = ctx.contextManager ? ctx.contextManager.getSnapshot(1000, 500, "session_view") : undefined;
  const view = buildSessionStatusView({
    session: ctx.session,
    config: {
      contextWindow: ctx.config.contextWindow,
      maxOutputTokens: ctx.config.maxOutputTokens,
    },
    contextSnapshot,
  });

  const lines = [
    ctx.i18n.t("command.session.id", { id: view.sessionId.slice(0, 8) }),
    ctx.i18n.t("command.session.version", { version: view.version }),
    ctx.i18n.t("command.session.entries", {
      entries: view.entryCount,
      checkpoints: view.compactionCount,
      capsules: view.capsuleCount,
    }),
    ctx.i18n.t("command.session.branch", { entries: view.branchEntryCount }),
    ctx.i18n.t("command.session.effectiveTokens", { tokens: view.effectiveTokens }),
    ctx.i18n.t("command.session.historicalTokens", { tokens: view.historicalTokens }),
    ctx.i18n.t("command.session.contextWindow", { tokens: view.contextWindow }),
    ctx.i18n.t("command.session.maxOutputTokens", { tokens: view.maxOutputTokens }),
  ];

  if (view.contextSnapshot) {
    lines.push(
      ctx.i18n.t("command.session.contextMetrics", {
        effective: view.contextSnapshot.effectiveTokens,
        historical: view.contextSnapshot.historicalTokens,
        hardLimit: view.contextSnapshot.hardLimit,
        source: view.contextSnapshot.source,
      }),
    );

    lines.push(
      ctx.i18n.t("command.session.contextDetails", {
        systemPrompt: view.contextSnapshot.systemPromptTokens,
        toolSchemas: view.contextSnapshot.toolSchemaTokens,
        safetyReserve: view.contextSnapshot.safetyReserveTokens,
        maxOutput: view.contextSnapshot.maxOutputTokens,
      }),
    );

    if (view.contextSnapshot.watermark) {
      lines.push(
        ctx.i18n.t("command.session.watermark", {
          entryId: view.contextSnapshot.watermark.measuredThroughEntryId?.slice(0, 8) ?? "none",
          fingerprint: view.contextSnapshot.watermark.requestFingerprint.slice(0, 16),
        }),
      );
    }
  }

  lines.push(
    ctx.i18n.t("command.session.persisted", {
      value: ctx.i18n.t(view.persisted ? "command.session.yes" : "command.session.noMemory"),
    }),
    ctx.i18n.t("command.session.cwd", { cwd: view.cwd }),
  );

  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: lines.join("\n"),
  });

  return { handled: true };
}

export function handleSessions(args: string[], ctx: CommandContext): CommandResult {
  const action = args[0]?.toLowerCase() ?? "list";
  const lifecycle = ctx.sessionLifecycle;

  if (!lifecycle) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: "Sessions lifecycle is not configured.",
    });
    return { handled: true };
  }

  try {
    switch (action) {
      case "list":
      case "ls":
        emitSessionsList(ctx, lifecycle);
        break;
      case "resume":
      case "load":
      case "open":
        resumeSessionCommand(args[1], ctx, lifecycle);
        break;
      case "close":
        closeSessionCommand(args[1], ctx, lifecycle);
        break;
      case "delete":
      case "remove":
      case "rm":
        deleteSessionCommand(args[1], ctx, lifecycle);
        break;
      default:
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: "Usage: /sessions list|resume <id>|load <id>|close [id]|delete <id>",
        });
    }
  } catch (error) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: `Sessions error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return { handled: true };
}

export function handleBudget(_args: string[], ctx: CommandContext): CommandResult {
  const view = buildBudgetStatusView(ctx.session);
  const lines = [ctx.i18n.t("command.budget.used", { tokens: view.tokens, formatted: view.formattedTokens })];

  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: lines.join("\n"),
  });

  return { handled: true };
}

function emitSessionsList(ctx: CommandContext, lifecycle: SessionLifecycleService): void {
  const sessions = lifecycle.listSessions({ cwd: ctx.session.getCwd() });
  if (sessions.length === 0) {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: "Sessions:\n  none",
    });
    return;
  }

  const activeId = ctx.session.getSessionId();
  const lines = [
    "Sessions:",
    ...sessions.map((session) => {
      const active = session.id === activeId ? " active" : "";
      const evidence = sessionEvidenceSummary(lifecycle, session.id);
      return `  ${session.id.slice(0, 8)}${active} entries=${session.entries ?? 0} updated=${session.updatedAt ?? "unknown"} evidence=${evidence} cwd=${session.cwd}`;
    }),
  ];
  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: lines.join("\n"),
  });
}

function resumeSessionCommand(sessionId: string | undefined, ctx: CommandContext, lifecycle: SessionLifecycleService): void {
  if (!sessionId) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: "Usage: /sessions resume <id>",
    });
    return;
  }

  const next = lifecycle.resumeSessionManager({ sessionId });
  activateSession(ctx, next);
  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: `Session resumed: ${next.getSessionId().slice(0, 8)} (${next.getCwd()})`,
  });
}

function closeSessionCommand(sessionId: string | undefined, ctx: CommandContext, lifecycle: SessionLifecycleService): void {
  const target = sessionId ?? ctx.session.getSessionId();
  lifecycle.closeSession(target);
  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: `Session closed: ${target.slice(0, 8)}`,
  });
}

function deleteSessionCommand(sessionId: string | undefined, ctx: CommandContext, lifecycle: SessionLifecycleService): void {
  if (!sessionId) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: "Usage: /sessions delete <id>",
    });
    return;
  }

  const activeId = ctx.session.getSessionId();
  if (activeId.startsWith(sessionId) || sessionId === activeId) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: "Cannot delete the active session. Resume another session first.",
    });
    return;
  }

  lifecycle.deleteSession(sessionId);
  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: `Session deleted: ${sessionId.slice(0, 8)}`,
  });
}

function activateSession(ctx: CommandContext, session: RuntimeSessionHandle): void {
  ctx.setSession?.(session);
  ctx.agentLoop?.setSessionManager(session);
}

function sessionEvidenceSummary(lifecycle: SessionLifecycleService, sessionId: string): string {
  try {
    const session = lifecycle.loadSessionManager({ sessionId });
    const records = session.getFlightRecords();
    let evidence: FlightRecordEntry | undefined = records[records.length - 1];
    for (let index = records.length - 1; index >= 0; index--) {
      if (records[index]?.data.kind === "evidence_bundle") {
        evidence = records[index];
        break;
      }
      evidence = undefined;
    }
    if (!evidence) {
      return records.length > 0 ? `records:${records.length}` : "none";
    }
    const payload = evidence.data.payload;
    if (payload && typeof payload === "object" && "status" in payload && typeof payload.status === "string") {
      return payload.status;
    }
    return "recorded";
  } catch {
    return "unavailable";
  }
}
