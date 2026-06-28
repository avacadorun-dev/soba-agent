/**
 * REPL slash-commands for SOBA Agent.
 *
 * Commands are prefixed with "/" and processed before sending to the LLM.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentLoop, ContextCapsuleEntry, ContextManager, FlightRecordEntry, I18n, McpManagedServerAuthStatus, McpRemoteAuthCommandResult, McpRuntimeControllerLike, McpRuntimeManager, McpRuntimeReloadResult, OpenResponsesClient, PermissionMode, ProviderRegistry, RuntimeSessionHandle, SessionLifecycleService, SkillManager, SobaConfig, ToolRegistry, TrustManager } from "../../application/cli/public";
import {
  type CommandResult,compact, estimateTokens, getCurrentTokens, handleSkillSlashCommand, isContextCapsuleEntry, isSkillSlashCommand, isTuiThemeName, McpSecretStore, McpSecretStoreError, maskSensitiveFields, PortableCapsuleService, PortableCapsuleServiceError, ProjectTrustStore,
  parseRuntimeCommandInput,
  RUNTIME_COMMANDS,
  type RuntimeCommandMetadata,redactMcpSensitiveText, syncMcpToolsIntoRegistry, TUI_THEME_NAMES, tryTuiRegistryFallback
} from "../../application/cli/public";
import type { SlashCommandRegistry } from "../../ui/terminal/interactive/commands/registry";
import type { SlashCommandContext } from "../../ui/terminal/interactive/commands/types";
import { notify } from "../../ui/terminal/interactive/lib/notification";
import type { TuiRenderer } from "../../ui/terminal/output/renderer";

// ─── Types ───

export interface CommandContext {
  client: OpenResponsesClient;
  session: RuntimeSessionHandle;
  sessionLifecycle?: SessionLifecycleService;
  setSession?: (session: RuntimeSessionHandle) => void;
  config: SobaConfig;
  i18n: I18n;
  renderer: Pick<TuiRenderer, "emit">;
  contextManager?: ContextManager;
  autoCompactOverride?: { enabled: boolean };
  skillManager?: SkillManager;
  agentLoop?: AgentLoop;
  registry?: ProviderRegistry;
  mcpRuntime?: McpRuntimeControllerLike;
  mcpManager?: McpRuntimeManager;
  mcpSecretStore?: McpSecretStore;
  toolRegistry?: ToolRegistry;
  trustManager?: TrustManager;
  /** TUI slash command registry for dispatching TUI commands (Phase 2.5 A4). */
  tuiRegistry?: SlashCommandRegistry;
}

export type { CommandResult };

export const SLASH_COMMANDS: readonly RuntimeCommandMetadata[] = RUNTIME_COMMANDS;

// ─── Command Handlers ───

async function handleCompact(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const instructions = args.join(" ") || undefined;
  const tokens = estimateTokens(ctx.session.buildInput().items);

  if (tokens <= ctx.config.contextWindow * 0.7) {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.compact.manualBelowThreshold", { tokens, contextWindow: ctx.config.contextWindow }),
    });
  }

  ctx.renderer.emit({
    type: "compaction_start",
    timestamp: Date.now(),
    tokensBefore: tokens,
  });

  try {
    // Use ContextManager if available (Phase 2 capsule-based compaction)
    if (ctx.contextManager) {
      // Estimate system prompt and tool schema tokens
      const systemPromptTokens = 1000; // Reasonable estimate for system prompt
      const toolSchemaTokens = 500; // Reasonable estimate for tool schemas
      const requestFingerprint = `manual_compact_${Date.now()}`;

      const outcome = await ctx.contextManager.manualCompact(
        instructions,
        systemPromptTokens,
        toolSchemaTokens,
        requestFingerprint,
      );

      if (outcome.compacted) {
        ctx.renderer.emit({
          type: "compaction_done",
          timestamp: Date.now(),
          reason: "manual",
          tokensBefore: outcome.metrics?.effectiveTokensBefore ?? tokens,
          tokensAfter: outcome.metrics?.estimatedTokensAfter ?? estimateTokens(ctx.session.buildInput().items),
          tokensSaved: outcome.metrics?.reclaimedTokens ?? 0,
          strategy: outcome.strategy ?? "unknown",
        });

        // Show additional capsule details
        ctx.renderer.emit({
          type: "info",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.compact.capsuleInfo", {
            checkpointId: outcome.checkpointId ?? "",
            strategy: outcome.strategy ?? "",
            quality: outcome.quality ?? "",
            savingsRatio: ((outcome.metrics?.savingsRatio ?? 0) * 100).toFixed(1),
          }),
        });
      } else {
        // No-op: nothing to compact or insufficient reclaimable tokens
        ctx.renderer.emit({
          type: "info",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.compact.noOp", { reason: outcome.reason }),
        });
        ctx.renderer.emit({
          type: "compaction_skipped",
          timestamp: Date.now(),
          reason: outcome.reason ?? "no reclaimable context",
          tokensBefore: outcome.metrics?.effectiveTokensBefore ?? tokens,
          tokensAfter: outcome.metrics?.estimatedTokensAfter ?? estimateTokens(ctx.session.buildInput().items),
        });
      }
    } else {
      // Fallback to legacy compaction (Phase 1, v1 sessions)
      const keepRecentTokens = Math.min(8000, Math.floor(tokens * 0.5));
      const result = await compact(ctx.session, ctx.client, { instructions, keepRecentTokens });
      ctx.renderer.emit({
        type: "compaction_done",
        timestamp: Date.now(),
        tokensBefore: result.tokensBefore,
        tokensAfter: estimateTokens(ctx.session.buildInput().items),
        savedTokens: result.tokensBefore - result.tokensKept,
      });
    }
  } catch (error) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("compact.failed", { error: error instanceof Error ? error.message : String(error) }),
    });
    ctx.renderer.emit({
      type: "compaction_skipped",
      timestamp: Date.now(),
      reason: "failed",
      tokensBefore: tokens,
      tokensAfter: estimateTokens(ctx.session.buildInput().items),
    });
  }

  return { handled: true };
}

function handleSession(_args: string[], ctx: CommandContext): CommandResult {
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

  // Add context manager metrics if available
  if (ctx.contextManager) {
    const systemPromptTokens = 1000; // Estimate for system prompt
    const toolSchemaTokens = 500; // Estimate for tool schemas
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

    // Additional Phase 2 context details
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

function handleSessions(args: string[], ctx: CommandContext): CommandResult {
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

function handleBudget(_args: string[], ctx: CommandContext): CommandResult {
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

function handleConfig(_args: string[], ctx: CommandContext): CommandResult {
  const maskedConfig = maskSensitiveFields(ctx.config);

  // Format config as readable key-value pairs
  const lines = [
    ctx.i18n.t("command.config.title"),
    ctx.i18n.t("command.config.baseUrl", { value: maskedConfig.baseUrl }),
    ctx.i18n.t("command.config.apiKey", { value: maskedConfig.apiKey }),
    ctx.i18n.t("command.config.model", { value: maskedConfig.model }),
    ctx.i18n.t("command.config.maxTokens", { value: maskedConfig.maxOutputTokens }),
    ctx.i18n.t("command.config.contextWindow", { value: maskedConfig.contextWindow }),
    ctx.i18n.t("command.config.maxAgentIterations", { value: maskedConfig.maxAgentIterations }),
    ctx.i18n.t("command.config.maxStalledIterations", { value: maskedConfig.maxStalledIterations }),
    ctx.i18n.t("command.config.maxRunMinutes", { value: maskedConfig.maxRunMinutes }),
  ];

  if (maskedConfig.lang) {
    lines.push(ctx.i18n.t("command.config.lang", { value: maskedConfig.lang }));
  }

  if (maskedConfig.theme) {
    lines.push(ctx.i18n.t("command.config.theme", { value: maskedConfig.theme }));
  }

  if (maskedConfig.compaction) {
    lines.push(ctx.i18n.t("command.config.compaction", { value: JSON.stringify(maskedConfig.compaction) }));
  }

  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: lines.join("\n"),
  });

  return { handled: true };
}

function handleRewind(args: string[], ctx: CommandContext): CommandResult {
  const checkpointId = args[0];
  const entries = ctx.session.getEntries();
  const compactionCheckpoints = entries.filter((entry) => entry.type === "compaction");
  const capsules = entries.filter((entry) => isContextCapsuleEntry(entry)) as ContextCapsuleEntry[];
  const allCheckpoints = [...compactionCheckpoints, ...capsules];

  if (!checkpointId) {
    const message =
      allCheckpoints.length > 0
        ? [
            ctx.i18n.t("command.rewind.title"),
            ...compactionCheckpoints.map((entry) => `  [compaction] ${entry.id}  ${entry.timestamp}`),
            ...capsules.map((entry) => `  [capsule:${entry.strategy}] ${entry.checkpointId}  ${entry.timestamp}`),
          ].join("\n")
        : ctx.i18n.t("command.rewind.empty");
    ctx.renderer.emit({ type: "info", timestamp: Date.now(), message });
    return { handled: true };
  }

  // Try to find checkpoint by ID (compaction or capsule)
  const checkpoint = compactionCheckpoints.find(
    (entry) => entry.id === checkpointId || entry.id.startsWith(checkpointId)
  );
  const capsule = capsules.find(
    (entry) => entry.checkpointId === checkpointId || entry.checkpointId.startsWith(checkpointId)
  );

  const targetEntry = checkpoint ?? capsule;
  if (!targetEntry) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.rewind.notFound", { id: checkpointId }),
    });
    return { handled: true };
  }

  ctx.session.branch(targetEntry.id);
  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: ctx.i18n.t("command.rewind.complete", { id: targetEntry.id }),
  });
  return { handled: true };
}

function handleLang(args: string[], ctx: CommandContext): CommandResult {
  const lang = args[0];
  if (lang !== "en" && lang !== "ru" && lang !== "zh") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.lang.usage"),
    });
    return { handled: true };
  }

  ctx.i18n.setLocale(lang);
  ctx.config.lang = lang;
  ctx.renderer.emit({
    type: "language_changed",
    timestamp: Date.now(),
    locale: lang,
    message: ctx.i18n.t("command.lang.changed", { locale: lang }),
  });

  return { handled: true };
}

function handleTheme(args: string[], ctx: CommandContext): CommandResult {
  const theme = args[0];
  if (!isTuiThemeName(theme)) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.theme.usage", { themes: TUI_THEME_NAMES.join("|") }),
    });
    return { handled: true };
  }

  ctx.config.theme = theme;
  ctx.renderer.emit({
    type: "theme_changed",
    timestamp: Date.now(),
    theme,
    message: ctx.i18n.t("command.theme.changed", { theme }),
  });
  return { handled: true };
}

function handleCapsule(args: string[], ctx: CommandContext): CommandResult {
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

function handleAutoCompact(args: string[], ctx: CommandContext): CommandResult {
  const action = args[0]?.toLowerCase();

  if (!action || (action !== "on" && action !== "off")) {
    const currentStatus =
      ctx.agentLoop?.getAutoCompactOverride()?.enabled ??
      ctx.contextManager?.getPolicy().getConfig().auto ??
      ctx.config.compaction?.auto ??
      true;
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.autoCompact.status", {
        status: ctx.i18n.t(currentStatus ? "command.autoCompact.enabled" : "command.autoCompact.disabled"),
      }),
    });
    return { handled: true };
  }

  const enabled = action === "on";

  // Update CommandContext
  if (!ctx.autoCompactOverride) {
    ctx.autoCompactOverride = { enabled };
  } else {
    ctx.autoCompactOverride.enabled = enabled;
  }

  // Update AgentLoop if available
  if (ctx.agentLoop) {
    ctx.agentLoop.setAutoCompactOverride({ enabled });
  }
  ctx.contextManager?.getPolicy().setAuto(enabled);

  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: ctx.i18n.t("command.autoCompact.changed", {
      status: ctx.i18n.t(enabled ? "command.autoCompact.enabled" : "command.autoCompact.disabled"),
    }),
  });
  return { handled: true };
}

function handleHelp(_args: string[], ctx: CommandContext): CommandResult {
  const usages: Partial<Record<string, string>> = {
    "/theme": `/theme <${TUI_THEME_NAMES.join("|")}>`,
    "/queue": "/queue [edit <id> <message> | cancel <id|all>]",
  };
  const helpText = [
    ctx.i18n.t("command.help.title"),
    ...SLASH_COMMANDS.map((command) =>
      ctx.i18n.t("command.help.line", {
        command: command.usage ?? usages[command.name] ?? command.name,
        description: ctx.i18n.t(command.descriptionKey),
      }),
    ),
  ];

  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: helpText.join("\n"),
  });

  return { handled: true };
}

// ─── Skill Commands ───

async function handleSkill(args: string[], ctx: CommandContext): Promise<CommandResult> {
  if (!ctx.skillManager) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.skill.notConfigured"),
    });
    return { handled: true };
  }

  const subcommand = args[0]?.toLowerCase();

  if (!subcommand) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.skill.usage"),
    });
    return { handled: true };
  }

  // Import SkillCommands dynamically to avoid circular dependencies
  const { SkillCommands } = await import("../../application/cli/public");
  const { DraftStore } = await import("../../application/cli/public");
  const { RevisionStore } = await import("../../application/cli/public");
  const { SkillEvaluator } = await import("../../application/cli/public");

  const sobaDir = join(homedir(), ".soba");
  const draftStore = new DraftStore({ draftsPath: join(sobaDir, "skill-drafts") });
  const revisionStore = new RevisionStore({ revisionsPath: join(sobaDir, "skill-revisions") });
  const evaluator = new SkillEvaluator({ evalRunsPath: join(sobaDir, "eval-runs") });

  const skillCommands = new SkillCommands({
    draftStore,
    revisionStore,
    evaluator,
    catalog: ctx.skillManager["catalog"],
    userSkillsPath: join(sobaDir, "skills"),
    projectSkillsPath: join(process.cwd(), ".soba", "skills"),
  });

  let result;

  switch (subcommand) {
    case "list": {
      const includeInvalid = args.includes("--invalid");
      const includeDisabled = args.includes("--disabled");
      result = await skillCommands.list({ includeInvalid, includeDisabled });
      break;
    }

    case "new": {
      const name = args[1];
      const description = args.slice(2).join(" ");
      if (!name) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.skill.newUsage"),
        });
        return { handled: true };
      }
      result = await skillCommands.new(name, description);
      break;
    }

    case "edit": {
      const name = args[1];
      const instructions = args.slice(2).join(" ");
      if (!name) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.skill.editUsage"),
        });
        return { handled: true };
      }
      result = await skillCommands.edit(name, instructions || undefined);
      break;
    }

    case "eval": {
      const name = args[1];
      if (!name) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.skill.evalUsage"),
        });
        return { handled: true };
      }
      result = await skillCommands.eval(name);
      break;
    }

    case "promote": {
      const name = args[1];
      const scopeArg = args.find((a) => a.startsWith("--scope="))?.split("=")[1] || "user";
      const scope = scopeArg === "project" ? "project" : "user";
      if (!name) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.skill.promoteUsage"),
        });
        return { handled: true };
      }
      result = await skillCommands.promote(name, scope);
      break;
    }

    case "history": {
      const name = args[1];
      if (!name) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.skill.historyUsage"),
        });
        return { handled: true };
      }
      result = await skillCommands.history(name);
      break;
    }

    case "rollback": {
      const name = args[1];
      const revisionId = args[2];
      if (!name || !revisionId) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.skill.rollbackUsage"),
        });
        return { handled: true };
      }
      result = await skillCommands.rollback(name, revisionId);
      break;
    }

    case "rm":
    case "remove": {
      const name = args[1];
      const confirmed = args.includes("--confirm");
      if (!name) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.skill.removeUsage"),
        });
        return { handled: true };
      }
      result = await skillCommands.remove(name, confirmed);
      break;
    }

    default:
      ctx.renderer.emit({
        type: "error",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.skill.unknownSubcommand", { subcommand }),
      });
      return { handled: true };
  }

  ctx.renderer.emit({
    type: result.success ? "info" : "error",
    timestamp: Date.now(),
    message: result.message,
  });

  return { handled: true };
}

async function handleProjectTrust(args: string[], ctx: CommandContext): Promise<CommandResult> {
  if (!ctx.skillManager) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.projectTrust.notConfigured"),
    });
    return { handled: true };
  }

  const subcommand = args[0]?.toLowerCase();

  if (!subcommand) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.projectTrust.usage"),
    });
    return { handled: true };
  }

  const trustStore = ctx.skillManager["trustStore"];
  const projectIdentity = ProjectTrustStore.computeProjectIdentity(process.cwd());

  switch (subcommand) {
    case "status": {
      const isTrusted = trustStore.isTrusted(projectIdentity);
      const record = trustStore.getRecord(projectIdentity);

      const lines = [
        ctx.i18n.t("command.projectTrust.status.title"),
        ctx.i18n.t("command.projectTrust.status.root", { root: projectIdentity.canonicalRoot }),
      ];

      if (projectIdentity.gitCommonDir) {
        lines.push(ctx.i18n.t("command.projectTrust.status.gitDir", { gitDir: projectIdentity.gitCommonDir }));
      }

      lines.push(
        ctx.i18n.t("command.projectTrust.status.trusted", {
          trusted: ctx.i18n.t(isTrusted ? "general.yes" : "general.no"),
        }),
      );

      if (record) {
        lines.push(ctx.i18n.t("command.projectTrust.status.trustedAt", { date: record.trustedAt }));
        lines.push(ctx.i18n.t("command.projectTrust.status.fingerprint", { fp: record.skillsFingerprint.slice(0, 16) }));
      }

      ctx.renderer.emit({
        type: "info",
        timestamp: Date.now(),
        message: lines.join("\n"),
      });
      break;
    }

    case "approve": {
      // Compute fingerprint from current skill tree
      const discovery = ctx.skillManager["discovery"];
      const fingerprint = discovery.computeFingerprint(projectIdentity.canonicalRoot);

      const isTrusted = trustStore.isTrusted(projectIdentity);

      if (isTrusted) {
        // Update fingerprint
        trustStore.updateFingerprint(projectIdentity, fingerprint);
        ctx.renderer.emit({
          type: "info",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.projectTrust.approve.updated"),
        });
      } else {
        // Approve new project
        trustStore.approve(projectIdentity, fingerprint);
        ctx.renderer.emit({
          type: "info",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.projectTrust.approve.approved"),
        });
      }

      // Refresh catalog to include newly trusted project skills
      ctx.skillManager.refresh();
      ctx.renderer.emit({ type: "trust_changed", trusted: true, timestamp: Date.now() });
      break;
    }

    case "revoke": {
      const revoked = trustStore.revoke(projectIdentity);

      if (revoked) {
        ctx.renderer.emit({
          type: "info",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.projectTrust.revoke.revoked"),
        });

        // Refresh catalog to remove project skills
        ctx.skillManager.refresh();
        ctx.renderer.emit({ type: "trust_changed", trusted: false, timestamp: Date.now() });
      } else {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.projectTrust.revoke.notTrusted"),
        });
      }
      break;
    }

    default:
      ctx.renderer.emit({
        type: "error",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.projectTrust.unknownSubcommand", { subcommand }),
      });
  }

  return { handled: true };
}

function handlePermissions(args: string[], ctx: CommandContext): CommandResult {
  const trustManager = ctx.trustManager ?? ctx.agentLoop?.getTrustManager();
  if (!trustManager) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("tui.permissions.usage"),
    });
    return { handled: true };
  }

  const mode = args[0]?.toLowerCase();
  if (!mode) {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("tui.permissions.current", { mode: trustManager.getPermissionMode() }),
    });
    return { handled: true };
  }

  if (mode === "clear") {
    trustManager.clearSessionApprovals();
    trustManager.setPermissionMode("ask");
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("tui.permissions.cleared"),
    });
    return { handled: true };
  }

  if (isPermissionMode(mode)) {
    trustManager.setPermissionMode(mode);
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("tui.permissions.changed", { mode }),
    });
    return { handled: true };
  }

  ctx.renderer.emit({
    type: "error",
    timestamp: Date.now(),
    message: ctx.i18n.t("tui.permissions.usage"),
  });
  return { handled: true };
}

function isPermissionMode(value: string): value is PermissionMode {
  return value === "ask" || value === "repo" || value === "full";
}

async function handleMcp(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const subcommand = args[0]?.toLowerCase() ?? "status";

  switch (subcommand) {
    case "status":
      emitMcpStatus(ctx);
      return { handled: true };
    case "reload":
      return handleMcpReload(ctx);
    case "start":
    case "stop":
    case "restart":
      return handleMcpLifecycle(subcommand, args.slice(1), ctx);
    case "auth":
      return handleMcpAuth(args.slice(1), ctx);
    case "secret":
    case "secrets":
      return handleMcpSecret(args.slice(1), ctx);
    default:
      ctx.renderer.emit({
        type: "error",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.mcp.result", {
          operation: subcommand,
          server: "-",
          result: ctx.i18n.t("command.mcp.usage"),
        }),
      });
      return { handled: true };
  }
}

async function handleMcpSecret(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const action = args[0]?.toLowerCase();
  const name = args[1];
  const store = ctx.mcpSecretStore;

  if (!store || !action || !["list", "set", "unset", "delete", "remove"].includes(action)) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.secret.usage"),
    });
    return { handled: true };
  }

  try {
    if (action === "list") {
      const names = await store.listNames();
      ctx.renderer.emit({
        type: "info",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.mcp.secret.list", {
          names: names.length > 0 ? names.join(", ") : ctx.i18n.t("command.mcp.secret.none"),
        }),
      });
      return { handled: true };
    }

    if (!name) {
      ctx.renderer.emit({
        type: "error",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.mcp.secret.usage"),
      });
      return { handled: true };
    }

    if (action === "set") {
      const value = args.slice(2).join(" ");
      if (!value) {
        ctx.renderer.emit({
          type: "error",
          timestamp: Date.now(),
          message: ctx.i18n.t("command.mcp.secret.usage"),
        });
        return { handled: true };
      }

      await store.set(name, value);
      ctx.renderer.emit({
        type: "info",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.mcp.secret.set", { name }),
      });
      return { handled: true };
    }

    const existed = await store.delete(name);
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.secret.unset", {
        name,
        result: existed ? ctx.i18n.t("command.mcp.secret.removed") : ctx.i18n.t("command.mcp.secret.notFound"),
      }),
    });
  } catch (error) {
    const message = error instanceof McpSecretStoreError || error instanceof Error ? error.message : String(error);
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.secret.error", { message }),
    });
  }

  return { handled: true };
}

function emitMcpStatus(ctx: CommandContext): void {
  const manager = getMcpManager(ctx);
  if (!manager) {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.status.empty"),
    });
    return;
  }

  const status = manager.getStatus();
  if (status.servers.length === 0) {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.status.empty"),
    });
    return;
  }

  const running = status.servers.filter((server) => server.started).length;
  const lines = [
    ctx.i18n.t("command.mcp.status.summary", {
      configured: status.servers.length,
      running,
      ready: status.counts.ready,
      degraded: status.counts.degraded,
      crashed: status.counts.crashed,
      stopped: status.counts.stopped,
    }),
    ...status.servers.map((server) =>
      ctx.i18n.t("command.mcp.status.server", {
        id: server.id,
        name: server.name,
        enabled: String(server.enabled),
        started: String(server.started),
        state: server.state,
        lifecycle: server.lifecycle ?? "none",
        protocol: server.protocolVersion ?? "none",
        transport: server.transport ?? "stdio",
        auth: formatMcpAuthStatus(server.authState),
        restarts: server.crashRestartCount,
        error: server.lastError ? redactMcpManagerError(server.id, server.lastError, manager) : "none",
      }),
    ),
  ];

  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: lines.join("\n"),
  });
}

async function handleMcpLifecycle(
  action: "start" | "stop" | "restart",
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  const serverId = args[0];
  if (!serverId) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.usage"),
    });
    return { handled: true };
  }

  const manager = getMcpManager(ctx);
  if (!manager) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.result", {
        operation: action,
        server: serverId,
        result: ctx.i18n.t("command.mcp.status.empty"),
      }),
    });
    return { handled: true };
  }

  try {
    if (action === "start") {
      await manager.start(serverId);
    } else if (action === "stop") {
      await manager.stop(serverId);
    } else {
      await manager.restart(serverId);
    }

    await syncMcpRegistryAfterLifecycle(ctx);

    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.result", {
        operation: action,
        server: serverId,
        result: "ok",
      }),
    });
  } catch (error) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.result", {
        operation: action,
        server: serverId,
        result: redactMcpManagerError(serverId, error instanceof Error ? error.message : String(error), manager),
      }),
    });
  }

  return { handled: true };
}

async function handleMcpAuth(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const action = args[0]?.toLowerCase();
  const serverId = args[1];
  if ((action !== "status" && action !== "login" && action !== "logout") || !serverId) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.auth.usage"),
    });
    return { handled: true };
  }

  const manager = getMcpManager(ctx);
  if (!manager) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.result", {
        operation: `auth ${action}`,
        server: serverId,
        result: ctx.i18n.t("command.mcp.status.empty"),
      }),
    });
    return { handled: true };
  }

  try {
    const result = await runMcpAuthAction(manager, action, serverId);
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: formatMcpAuthResult(action, serverId, result, ctx),
    });
  } catch (error) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.result", {
        operation: `auth ${action}`,
        server: serverId,
        result: redactMcpManagerError(serverId, error instanceof Error ? error.message : String(error), manager),
      }),
    });
  }

  return { handled: true };
}

async function runMcpAuthAction(
  manager: McpRuntimeManager,
  action: "status" | "login" | "logout",
  serverId: string,
): Promise<McpRemoteAuthCommandResult> {
  if (action === "status") {
    return manager.getAuthStatus(serverId);
  }
  if (action === "login") {
    return manager.login(serverId);
  }
  return manager.logout(serverId);
}

function formatMcpAuthResult(
  action: "status" | "login" | "logout",
  serverId: string,
  result: McpRemoteAuthCommandResult,
  ctx: CommandContext,
): string {
  const lines = [
    ctx.i18n.t(mcpAuthActionKey(action), {
      server: serverId,
      state: result.status.state,
      type: result.status.type,
      message: result.message,
    }),
  ];

  if (result.status.nextAction) {
    lines.push(ctx.i18n.t("command.mcp.auth.nextAction", { action: result.status.nextAction }));
  }
  if (result.details) {
    lines.push(ctx.i18n.t("command.mcp.auth.details", { details: result.details }));
  }

  return lines.join("\n");
}

function mcpAuthActionKey(action: "status" | "login" | "logout"): "command.mcp.auth.status" | "command.mcp.auth.login" | "command.mcp.auth.logout" {
  if (action === "status") {
    return "command.mcp.auth.status";
  }
  if (action === "login") {
    return "command.mcp.auth.login";
  }
  return "command.mcp.auth.logout";
}

function formatMcpAuthStatus(status: McpManagedServerAuthStatus | undefined): string {
  if (!status) {
    return "unknown";
  }

  const detail = status.detail ? `:${status.detail}` : "";
  const nextAction = status.nextAction ? ` next=${status.nextAction}` : "";
  return `${status.type}/${status.state}${detail}${nextAction}`;
}

async function syncMcpRegistryAfterLifecycle(ctx: CommandContext): Promise<void> {
  if (ctx.mcpRuntime) {
    await ctx.mcpRuntime.syncTools();
    return;
  }

  const manager = getMcpManager(ctx);
  if (!manager || !ctx.toolRegistry) {
    return;
  }

  await syncMcpToolsIntoRegistry(ctx.toolRegistry, manager, {
    trustManager: ctx.trustManager ?? ctx.agentLoop?.getTrustManager(),
  });
}

async function handleMcpReload(ctx: CommandContext): Promise<CommandResult> {
  if (!ctx.mcpRuntime) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.reload.unavailable"),
    });
    return { handled: true };
  }

  try {
    const result = await ctx.mcpRuntime.reload();
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: formatMcpReloadResult(result, ctx),
    });
  } catch (error) {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.mcp.reload.error", {
        message: error instanceof Error ? error.message : String(error),
      }),
    });
  }

  return { handled: true };
}

function formatMcpReloadResult(result: McpRuntimeReloadResult, ctx: CommandContext): string {
  return ctx.i18n.t("command.mcp.reload.result", {
    configured: result.serverIds.length,
    added: formatList(result.addedServerIds),
    removed: formatList(result.removedServerIds),
    restarted: formatList(result.restartedServerIds),
    tools: result.toolSync.registered.length,
    skipped: result.toolSync.skipped.length,
  });
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function getMcpManager(ctx: CommandContext): McpRuntimeManager | undefined {
  return ctx.mcpRuntime?.getManager() ?? ctx.mcpManager;
}

function redactMcpManagerError(serverId: string, message: string, manager: McpRuntimeManager): string {
  try {
    return redactMcpSensitiveText(message, manager.getServerSecurity(serverId));
  } catch {
    return redactMcpSensitiveText(message);
  }
}

// ─── Command Router ───

const COMMAND_HANDLERS: Record<
  string,
  (args: string[], ctx: CommandContext) => CommandResult | Promise<CommandResult>
> = {
  compact: handleCompact,
  rewind: handleRewind,
  session: handleSession,
  sessions: handleSessions,
  capsule: handleCapsule,
  "auto-compact": handleAutoCompact,
  budget: handleBudget,
  config: handleConfig,
  lang: handleLang,
  theme: handleTheme,
  permissions: handlePermissions,
  skill: handleSkill,
  "project-trust": handleProjectTrust,
  mcp: handleMcp,
  help: handleHelp,
  exit: () => ({ handled: true, exit: true }),
  quit: () => ({ handled: true, exit: true }),
};

/**
 * Process a slash command. Returns CommandResult indicating
 * whether the input was handled and if the REPL should exit.
 */
export async function executeCommand(input: string, ctx: CommandContext): Promise<CommandResult> {
  if (!input.startsWith("/")) return { handled: false };

  // Check for skill slash command first: /skill:<name> [args]
  if (isSkillSlashCommand(input)) {
    if (!ctx.skillManager) {
      ctx.renderer.emit({
        type: "error",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.skill.notConfigured"),
      });
      return { handled: true };
    }

    const result = handleSkillSlashCommand(
      input,
      ctx.skillManager,
      (ref) => {
        // Persist activation in session
        ctx.session.appendSkillActivation({ action: "activate", skill: ref });
      },
    );

    if (result.success) {
      ctx.renderer.emit({
        type: "info",
        timestamp: Date.now(),
        message: ctx.i18n.t("command.skill.activated", { name: result.activation?.name ?? input }),
      });
      notify(
        "success",
        `Skill activated: ${result.activation?.name ?? input}`,
        `Revision ${result.activation?.revision ?? "?"}`,
      );

      // If there's a user message, we need to return it as unhandled so it gets processed
      if (result.userMessage) {
        return { handled: false, prompt: result.userMessage };
      }
    } else {
      ctx.renderer.emit({
        type: "error",
        timestamp: Date.now(),
        message: result.error || "Failed to activate skill",
      });
    }

    return { handled: true };
  }

  const parsed = parseRuntimeCommandInput(input);
  const cmd = parsed?.id;

  if (!cmd) return { handled: true };

  const handler = COMMAND_HANDLERS[cmd];
  if (!handler) {
    // Phase 2.5 A4: Try TUI slash command registry as fallback
    if (ctx.tuiRegistry) {
      const tuiContext: SlashCommandContext = {
        addMessage: undefined, // Non-TUI mode has no message list
        exit: undefined,
      };
      const result = tryTuiRegistryFallback(input, ctx.tuiRegistry, tuiContext);
      if (result) {
        if (result.exit) return { handled: true, exit: true };
        if (result.message) {
          ctx.renderer.emit({
            type: "info",
            timestamp: Date.now(),
            message: result.message,
          });
        }
        return { handled: true };
      }
    }

    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.unknown", { command: `/${cmd}` }),
    });
    return { handled: true };
  }

  return handler(parsed.args, ctx);
}
