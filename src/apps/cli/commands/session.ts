import type {
  CommandResult,
  FlightRecordEntry,
  RuntimeSessionHandle,
  SessionLifecycleService,
} from "../../../application/cli/public";
import { estimateTokens, getCurrentTokens, isContextCapsuleEntry } from "../../../application/cli/public";
import type { CommandContext } from "./index";

export function handleSession(_args: string[], ctx: CommandContext): CommandResult {
  const entries = ctx.session.getEntries();
  const tokens = estimateTokens(ctx.session.buildInput().items);
  const historicalTokens = getCurrentTokens(entries);
  const branch = ctx.session.getBranch();
  const compactionCount = entries.filter((e) => e.type === "compaction").length;
  const capsuleCount = entries.filter((e) => isContextCapsuleEntry(e)).length;

  const lines = [
    ctx.i18n.t("command.session.id", { id: ctx.session.getSessionId().slice(0, 8) }),
    ctx.i18n.t("command.session.version", { version: ctx.session.isV2() ? "v2" : "v1" }),
    ctx.i18n.t("command.session.entries", { entries: entries.length, checkpoints: compactionCount, capsules: capsuleCount }),
    ctx.i18n.t("command.session.branch", { entries: branch.length }),
    ctx.i18n.t("command.session.effectiveTokens", { tokens }),
    ctx.i18n.t("command.session.historicalTokens", { tokens: historicalTokens }),
    ctx.i18n.t("command.session.contextWindow", { tokens: ctx.config.contextWindow }),
    ctx.i18n.t("command.session.maxOutputTokens", { tokens: ctx.config.maxOutputTokens }),
  ];

  if (ctx.contextManager) {
    const systemPromptTokens = 1000;
    const toolSchemaTokens = 500;
    const requestFingerprint = "session_view";
    const snapshot = ctx.contextManager.getSnapshot(
      systemPromptTokens,
      toolSchemaTokens,
      requestFingerprint,
    );

    lines.push(
      ctx.i18n.t("command.session.contextMetrics", {
        effective: snapshot.effectiveTokens,
        historical: snapshot.historicalTokens,
        hardLimit: snapshot.hardLimit,
        source: snapshot.source,
      }),
    );

    lines.push(
      ctx.i18n.t("command.session.contextDetails", {
        systemPrompt: snapshot.systemPromptTokens,
        toolSchemas: snapshot.toolSchemaTokens,
        safetyReserve: snapshot.safetyReserveTokens,
        maxOutput: snapshot.maxOutputTokens,
      }),
    );

    if (snapshot.watermark) {
      lines.push(
        ctx.i18n.t("command.session.watermark", {
          entryId: snapshot.watermark.measuredThroughEntryId?.slice(0, 8) ?? "none",
          fingerprint: snapshot.watermark.requestFingerprint.slice(0, 16),
        }),
      );
    }
  }

  lines.push(
    ctx.i18n.t("command.session.persisted", {
      value: ctx.i18n.t(ctx.session.isPersisted() ? "command.session.yes" : "command.session.noMemory"),
    }),
    ctx.i18n.t("command.session.cwd", { cwd: ctx.session.getCwd() }),
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
  const tokens = estimateTokens(ctx.session.buildInput().items);

  const usedK = (tokens / 1000).toFixed(1);
  const lines = [ctx.i18n.t("command.budget.used", { tokens, formatted: `${usedK}K` })];

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
