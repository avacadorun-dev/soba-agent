import type { CommandResult, RuntimeSessionHandle } from "../public";
import { buildBudgetStatusView, buildSessionStatusView, executeSessionsCommand } from "../public";
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
  renderSessionsCommandView(ctx, executeSessionsCommand({ args, session: ctx.session, lifecycle: ctx.sessionLifecycle }));
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

function activateSession(ctx: CommandContext, session: RuntimeSessionHandle): void {
  ctx.setSession?.(session);
  ctx.agentLoop?.setSessionManager(session);
}

function renderSessionsCommandView(ctx: CommandContext, view: ReturnType<typeof executeSessionsCommand>): void {
  if (view.kind === "error" || view.kind === "usage") {
    ctx.renderer.emit({ type: "error", timestamp: Date.now(), message: view.message });
    return;
  }

  if (view.kind === "list") {
    const lines =
      view.sessions.length === 0
        ? ["Sessions:", "  none"]
        : [
            "Sessions:",
            ...view.sessions.map((session) => {
              const active = session.active ? " active" : "";
              return `  ${session.id.slice(0, 8)}${active} entries=${session.entries ?? 0} updated=${session.updatedAt ?? "unknown"} evidence=${session.evidence} cwd=${session.cwd}`;
            }),
          ];
    ctx.renderer.emit({ type: "info", timestamp: Date.now(), message: lines.join("\n") });
    return;
  }

  if (view.kind === "resumed") {
    activateSession(ctx, view.session);
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: `Session resumed: ${view.session.getSessionId().slice(0, 8)} (${view.session.getCwd()})`,
    });
    return;
  }

  const verb = view.kind === "closed" ? "closed" : "deleted";
  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: `Session ${verb}: ${view.sessionId.slice(0, 8)}`,
  });
}
