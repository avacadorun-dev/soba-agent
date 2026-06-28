/**
 * REPL slash-commands for SOBA Agent.
 *
 * Commands are prefixed with "/" and processed before sending to the LLM.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentLoop, ContextCapsuleEntry, ContextManager, I18n, McpRuntimeControllerLike, McpRuntimeManager, OpenResponsesClient, PermissionMode, ProviderRegistry, RuntimeSessionHandle, SessionLifecycleService, SkillManager, SlashCommandContext, SlashCommandRegistry, SobaConfig, ToolRegistry, TrustManager, TuiRenderer } from "../../../application/cli/public";
import {
  type CommandResult,compact, estimateTokens, handleSkillSlashCommand, isContextCapsuleEntry, isSkillSlashCommand, isTuiThemeName, McpSecretStore, maskSensitiveFields, notify, ProjectTrustStore,
  parseRuntimeCommandInput,
  RUNTIME_COMMANDS,
  type RuntimeCommandMetadata, TUI_THEME_NAMES, tryTuiRegistryFallback
} from "../../../application/cli/public";
import { handleCapsule } from "./capsule";
import { handleMcp } from "./mcp";
import { handleBudget, handleSession, handleSessions } from "./session";

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
  const { SkillCommands } = await import("../../../application/cli/public");
  const { DraftStore } = await import("../../../application/cli/public");
  const { RevisionStore } = await import("../../../application/cli/public");
  const { SkillEvaluator } = await import("../../../application/cli/public");

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
