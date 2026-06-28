import type { CommandResult } from "../public";
import {
  buildConfigCommandView,
  buildHelpCommandView,
  executeAutoCompactCommand,
  executeCompactCommand,
  executeLangCommand,
  executeRewindCommand,
  executeThemeCommand,
} from "../public";
import type { CommandContext } from "./index";

export async function handleCompact(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const view = await executeCompactCommand({
    args,
    session: ctx.session,
    client: ctx.client,
    contextWindow: ctx.config.contextWindow,
    i18n: ctx.i18n,
    contextManager: ctx.contextManager,
  });

  for (const event of view.events) {
    ctx.renderer.emit(event);
  }

  return { handled: true };
}

export function handleConfig(_args: string[], ctx: CommandContext): CommandResult {
  const { config: maskedConfig } = buildConfigCommandView(ctx.config);

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

export function handleRewind(args: string[], ctx: CommandContext): CommandResult {
  const view = executeRewindCommand({ args, session: ctx.session });

  if (view.kind === "empty") {
    ctx.renderer.emit({ type: "info", timestamp: Date.now(), message: ctx.i18n.t("command.rewind.empty") });
    return { handled: true };
  }

  if (view.kind === "list") {
    const message = [
      ctx.i18n.t("command.rewind.title"),
      ...view.checkpoints.map((checkpoint) =>
        checkpoint.kind === "compaction"
          ? `  [compaction] ${checkpoint.id}  ${checkpoint.timestamp}`
          : `  [capsule:${checkpoint.strategy}] ${checkpoint.id}  ${checkpoint.timestamp}`,
      ),
    ].join("\n");
    ctx.renderer.emit({ type: "info", timestamp: Date.now(), message });
    return { handled: true };
  }

  if (view.kind === "not_found") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.rewind.notFound", { id: view.checkpointId }),
    });
    return { handled: true };
  }

  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: ctx.i18n.t("command.rewind.complete", { id: view.checkpointId }),
  });
  return { handled: true };
}

export function handleLang(args: string[], ctx: CommandContext): CommandResult {
  const view = executeLangCommand(args);
  if (view.kind === "usage") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.lang.usage"),
    });
    return { handled: true };
  }

  ctx.i18n.setLocale(view.locale);
  ctx.config.lang = view.locale;
  ctx.renderer.emit({
    type: "language_changed",
    timestamp: Date.now(),
    locale: view.locale,
    message: ctx.i18n.t("command.lang.changed", { locale: view.locale }),
  });

  return { handled: true };
}

export function handleTheme(args: string[], ctx: CommandContext): CommandResult {
  const view = executeThemeCommand(args);
  if (view.kind === "usage") {
    ctx.renderer.emit({
      type: "error",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.theme.usage", { themes: view.themes.join("|") }),
    });
    return { handled: true };
  }

  ctx.config.theme = view.theme;
  ctx.renderer.emit({
    type: "theme_changed",
    timestamp: Date.now(),
    theme: view.theme,
    message: ctx.i18n.t("command.theme.changed", { theme: view.theme }),
  });
  return { handled: true };
}

export function handleAutoCompact(args: string[], ctx: CommandContext): CommandResult {
  const view = executeAutoCompactCommand(args, {
    agentOverrideEnabled: ctx.agentLoop?.getAutoCompactOverride()?.enabled,
    contextPolicyEnabled: ctx.contextManager?.getPolicy().getConfig().auto,
    configEnabled: ctx.config.compaction?.auto,
  });

  if (view.kind === "status") {
    ctx.renderer.emit({
      type: "info",
      timestamp: Date.now(),
      message: ctx.i18n.t("command.autoCompact.status", {
        status: ctx.i18n.t(view.enabled ? "command.autoCompact.enabled" : "command.autoCompact.disabled"),
      }),
    });
    return { handled: true };
  }

  if (!ctx.autoCompactOverride) {
    ctx.autoCompactOverride = { enabled: view.enabled };
  } else {
    ctx.autoCompactOverride.enabled = view.enabled;
  }

  if (ctx.agentLoop) {
    ctx.agentLoop.setAutoCompactOverride({ enabled: view.enabled });
  }
  ctx.contextManager?.getPolicy().setAuto(view.enabled);

  ctx.renderer.emit({
    type: "info",
    timestamp: Date.now(),
    message: ctx.i18n.t("command.autoCompact.changed", {
      status: ctx.i18n.t(view.enabled ? "command.autoCompact.enabled" : "command.autoCompact.disabled"),
    }),
  });
  return { handled: true };
}

export function handleHelp(_args: string[], ctx: CommandContext): CommandResult {
  const view = buildHelpCommandView();
  const helpText = [
    ctx.i18n.t("command.help.title"),
    ...view.commands.map((command) =>
      ctx.i18n.t("command.help.line", {
        command: command.command,
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
