/**
 * SOBA Agent — CLI entry point.
 *
 * Handles:
 * - Argument parsing (one-shot, interactive, continue)
 * - Configuration loading and first-time setup
 * - One-shot mode: single prompt → response
 * - Interactive (REPL) mode: continuous conversation
 * - Session continuation
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { AcpClientRequester } from "../../adapters/acp/client-delegation";
import type { ApprovalDecision, Locale, RuntimeEvent, SobaConfig } from "../../application/public";
import {APP_VERSION, detectLocale, 
  firstTimeSetup,I18n, isLocale, listSessions, 
  loadConfig,
  resolveCompactionConfig,
  resolveSoundConfig,SessionManager, SoundNotifier, 
  validateConfig
} from "../../application/public";
import { createSobaRuntime } from "../../application/runtime/public";
import { setColorDisabled } from "../../ui/terminal/output/colors";
import { createRenderer } from "../../ui/terminal/output/renderer";
import { initTheme } from "../../ui/terminal/output/theme";
import { parseArgs, printHelp } from "./args";
import { executeCommand } from "./commands";

const VERSION = APP_VERSION;

// ─── Helpers ───

function resolveLang(cliLang?: Locale): Locale {
  if (cliLang && isLocale(cliLang)) return cliLang;
  const envLang = process.env.SOBA_LANG;
  if (envLang && isLocale(envLang)) return envLang;
  return detectLocale();
}

function emitAcpCommandOutput(
  event: { type: string; timestamp?: number; message?: unknown; [key: string]: unknown },
  messageId: string,
  emit: (event: RuntimeEvent) => void,
): void {
  const text = commandOutputText(event);
  if (!text) return;
  emit({
    type: "assistant_text_delta",
    timestamp: event.timestamp ?? Date.now(),
    messageId,
    delta: `${text}\n`,
  });
}

function commandOutputText(event: { type: string; message?: unknown; [key: string]: unknown }): string | undefined {
  if (typeof event.message === "string" && event.message.trim().length > 0) {
    return event.type === "error" ? `Error: ${event.message}` : event.message;
  }

  if (event.type === "compaction_start") {
    const tokensBefore = typeof event.tokensBefore === "number" ? ` (${event.tokensBefore} tokens)` : "";
    return `Compaction started${tokensBefore}.`;
  }

  if (event.type === "compaction_done") {
    const before = typeof event.tokensBefore === "number" ? event.tokensBefore : undefined;
    const after = typeof event.tokensAfter === "number" ? event.tokensAfter : undefined;
    if (before !== undefined && after !== undefined) {
      return `Compaction complete: ${before} -> ${after} tokens.`;
    }
    return "Compaction complete.";
  }

  return undefined;
}

/**
 * Ask the user for confirmation of a dangerous operation in print mode.
 * Uses readline to prompt with y/N.
 */
async function handleDangerousConfirmation(
  i18n: I18n,
  _toolName: string,
  description: string,
  reason: string,
  resolve: (decision: ApprovalDecision) => void,
): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((res) => {
    rl.question(`\n${i18n.t("cli.confirm.dangerous", { description, reason })}`, (a) => {
      rl.close();
      res(a.trim().toLowerCase());
    });
  });

  const decision =
    answer === "y" || answer === "yes"
      ? "once"
      : answer === "s" || answer === "session"
        ? "session"
        : answer === "r" || answer === "repo"
          ? "repo"
          : answer === "f" || answer === "full"
            ? "full"
          : "deny";
  if (decision !== "deny") {
    console.log(`   ${i18n.t("tui.info.allowed")}.\n`);
  } else {
    console.log(`   ${i18n.t("tui.info.denied")}.\n`);
  }
  resolve(decision);
}

/**
 * Interactive session selection: list sessions and let user pick one.
 * Returns SessionManager or null if cancelled/empty.
 */
async function interactiveSessionSelect(i18n: I18n, cwd: string): Promise<SessionManager | null> {
  const t = i18n.t.bind(i18n);
  const defaultDir = join(homedir(), ".soba", "sessions");
  // Try project-specific sessions first
  const sessionDir = join(defaultDir, Buffer.from(cwd).toString("base64url").slice(0, 32));

  const sessions = listSessions(sessionDir);
  if (sessions.length === 0) {
    console.log(t("session.listEmpty", { dir: sessionDir }));
    return null;
  }

  console.log(`\n${t("session.listTitle")}\n`);
  const now = new Date();
  for (let i = 0; i < sessions.length; i++) {
    const date = new Date(sessions[i].timestamp);
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    const dateStr =
      diff < 60 ? t("cli.session.secondsAgo", { count: diff }) :
      diff < 3600 ? t("cli.session.minutesAgo", { count: Math.floor(diff / 60) }) :
      diff < 86400 ? t("cli.session.hoursAgo", { count: Math.floor(diff / 3600) }) :
      date.toLocaleDateString();
    console.log(t("session.listEntry", {
      index: i + 1,
      id: sessions[i].id.slice(0, 8),
      cwd: sessions[i].cwd,
      entries: sessions[i].entries,
      date: dateStr,
    }));
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`\n${t("session.selectPrompt")}`, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });

  if (!answer) {
    console.log(t("session.selectCancelled"));
    return null;
  }

  const index = Number.parseInt(answer, 10) - 1;
  if (Number.isNaN(index) || index < 0 || index >= sessions.length) {
    console.log(t("cli.error.invalidSelection", { selection: answer }));
    return null;
  }

  return SessionManager.open(sessions[index].filePath, sessionDir);
}

// ─── Main ───

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));

  // Resolve language
  const lang = resolveLang(cliArgs.lang);
  const i18n = new I18n(lang);

  // --version
  if (cliArgs.version) {
    console.log(`soba v${VERSION}`);
    return;
  }

  // --help
  if (cliArgs.help) {
    printHelp(i18n);
    return;
  }

  // `soba provider <subcommand> ...` — manage custom providers. Implemented
  // as a sub-route of the binary so the user does not have to install a
  // separate tool. Runs without loading the agent loop, the tool registry,
  // or the session manager — it only needs the ProviderRegistry.
  if (cliArgs.providerSubcommand !== undefined) {
    const { parseProviderCliArgs, runProviderCli } = await import("./provider-cli");
    const { ProviderRegistry } = await import("../../application/public");
    const persistedRegistryForProvider = await ProviderRegistry.loadFromFile();
    const providerRegistryForCli = new ProviderRegistry(persistedRegistryForProvider ?? undefined);
    const options = parseProviderCliArgs(cliArgs.providerSubArgs);
    const result = await runProviderCli(
      cliArgs.providerSubcommand,
      options,
      providerRegistryForCli,
      i18n,
    );
    for (const line of result.stdout) console.log(line);
    for (const line of result.stderr) console.error(line);
    if (result.exitCode !== 0) process.exit(result.exitCode);
    return;
  }

  if (cliArgs.init) {
    const { parseInitCommandArgs, runInitCommand } = await import("./init-command");
    let options;
    try {
      options = parseInitCommandArgs(cliArgs.initArgs);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    const result = await runInitCommand(
      {
        ...options,
        cwd: process.cwd(),
        configPath: process.env.SOBA_CONFIG_PATH,
      },
      i18n,
    );
    for (const line of result.stdout) console.log(line);
    for (const line of result.stderr) console.error(line);
    if (result.exitCode !== 0) process.exit(result.exitCode);
    return;
  }

  // --no-color
  if (cliArgs.noColor) {
    setColorDisabled(true);
  }

  // Init theme (dark by default, will be overridden after config load)
  initTheme("dark");

  // Load config
  const cliOverrides: Partial<SobaConfig> = {};
  if (cliArgs.model) cliOverrides.model = cliArgs.model;
  if (cliArgs.apiKey) cliOverrides.apiKey = cliArgs.apiKey;
  if (cliArgs.baseUrl) cliOverrides.baseUrl = cliArgs.baseUrl;
  if (cliArgs.lang) cliOverrides.lang = cliArgs.lang;
  if (cliArgs.theme) cliOverrides.theme = cliArgs.theme;
  if (cliArgs.maxOutputTokens) cliOverrides.maxOutputTokens = cliArgs.maxOutputTokens;
  if (cliArgs.maxCompletionTokens !== undefined) cliOverrides.maxCompletionTokens = cliArgs.maxCompletionTokens;
  if (cliArgs.contextWindow) cliOverrides.contextWindow = cliArgs.contextWindow;
  if (cliArgs.maxAgentIterations !== undefined) cliOverrides.maxAgentIterations = cliArgs.maxAgentIterations;
  if (cliArgs.maxStalledIterations !== undefined) cliOverrides.maxStalledIterations = cliArgs.maxStalledIterations;
  if (cliArgs.maxRunMinutes !== undefined) cliOverrides.maxRunMinutes = cliArgs.maxRunMinutes;
  if (cliArgs.bashMaxTimeoutSeconds !== undefined) cliOverrides.bashMaxTimeoutSeconds = cliArgs.bashMaxTimeoutSeconds;

  // Sound config from CLI
  const soundCli: Record<string, unknown> = {};
  if (cliArgs.noSound) soundCli.enabled = false;
  else if (cliArgs.soundEnabled) soundCli.enabled = true;
  if (cliArgs.soundVolume !== undefined) soundCli.volume = cliArgs.soundVolume;
  if (cliArgs.soundRepeat) soundCli.repeatMode = "repeat";
  if (Object.keys(soundCli).length > 0) {
    cliOverrides.sound = { ...cliOverrides.sound, ...soundCli } as Partial<import("../../application/public").SoundConfig>;
  }

  const configPath = process.env.SOBA_CONFIG_PATH;
  const config = await loadConfig(cliOverrides, { configPath });

  // Apply lang from config file, but only if not overridden by CLI --lang or SOBA_LANG env.
  // The config file has lower priority than CLI args and env vars.
  if (!cliArgs.lang && !process.env.SOBA_LANG && config.lang && config.lang !== i18n.getLocale()) {
    i18n.setLocale(config.lang);
  }

  const soundConfig = resolveSoundConfig(config);

  const compactionConfig = resolveCompactionConfig(config, cliArgs.noAutoCompact);
  config.compaction = compactionConfig;

  // Apply theme from loaded config (maps TuiThemeName → ThemeMode)
  const themeMode = config.theme === "forest" ? "forest" : config.theme === "paper" ? "light" : "dark";
  initTheme(themeMode);

  if (cliArgs.acp) {
    const missing = validateConfig(config);
    if (missing.length > 0) {
      console.error(`Error: missing required configuration for ACP mode: ${missing.join(", ")}`);
      process.exit(1);
    }

    const cwd = process.cwd();
    const session = SessionManager.create(cwd);
    const { AcpClientToolDelegation } = await import("../../adapters/acp/client-delegation");
    let acpRequestClient: AcpClientRequester | undefined;
    const acpToolDelegation = new AcpClientToolDelegation(() => acpRequestClient);
    const runtimeComposition = await createSobaRuntime({
      cwd,
      session,
      config,
      compactionConfig,
      interactive: false,
      modelExplicitlyPassed: Boolean(cliArgs.model || process.env.SOBA_MODEL),
      baseUrlOverride: cliArgs.baseUrl,
      baseUrlExplicitlyPassed: Boolean(cliArgs.baseUrl || process.env.SOBA_BASE_URL),
      apiKeyExplicitlyPassed: Boolean(cliArgs.apiKey || process.env.SOBA_API_KEY),
      noStream: cliArgs.noStream,
      stream: !cliArgs.noStream,
      tokenBudget: cliArgs.budget ?? 0,
      debug: cliArgs.debug,
      toolDelegation: acpToolDelegation,
      commandExecutorFactory: (context) => async ({ command, emit }) => {
        const messageId = `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
        return executeCommand(command, {
          client: context.client,
          session: context.getSession(),
          sessionLifecycle: context.sessionLifecycle,
          setSession: context.setSession,
          config: context.config,
          i18n,
          renderer: {
            emit: (event) => emitAcpCommandOutput(event, messageId, emit),
          },
          contextManager: context.contextManager,
          skillManager: context.skillManager,
          agentLoop: context.agentLoop,
          registry: context.providerRegistry,
          mcpRuntime: context.mcpRuntime,
          mcpManager: context.mcpManager,
          mcpSecretStore: context.mcpSecretStore,
          toolRegistry: context.toolRegistry,
          trustManager: context.trustManager,
        });
      },
      providerRegistryConfigPath: configPath,
    });
    const { runAcpServer } = await import("../acp/server");
    await runAcpServer({
      runtime: runtimeComposition.runtime,
      cwd,
      input: process.stdin,
      writeStdout: (chunk) => {
        process.stdout.write(chunk);
      },
      writeStderr: (chunk) => {
        process.stderr.write(chunk);
      },
      agentInfo: { name: "soba-agent", version: VERSION },
      onClientRequester: (requestClient) => {
        acpRequestClient = requestClient;
      },
      onClientCapabilities: (_capabilities, raw) => {
        acpToolDelegation.updateCapabilities(raw);
      },
    });
    return;
  }

  // First-time setup if no API key
  const missing = validateConfig(config);
  if (missing.length > 0) {
    await firstTimeSetup(config, i18n);
    return;
  }

  // Determine if we're in interactive mode.
  // When no prompt is provided (including when only modifier flags like
  // --no-session are passed), behave as if -i/--interactive was passed.
  const interactive = cliArgs.interactive || !cliArgs.prompt;

  // Create session
  const cwd = process.cwd();
  let session: SessionManager;
  if (cliArgs.noSession) {
    session = SessionManager.inMemory(cwd);
  } else if (cliArgs.sessionId) {
    try {
      session = SessionManager.openById(cwd, cliArgs.sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  } else if (cliArgs.resume) {
    const selected = await interactiveSessionSelect(i18n, cwd);
    if (!selected) return;
    session = selected;
  } else if (cliArgs.continueLast) {
    session = SessionManager.continueRecent(cwd);
  } else {
    session = interactive || cliArgs.prompt ? SessionManager.create(cwd) : SessionManager.inMemory(cwd);
  }

  const runtimeComposition = await createSobaRuntime({
    cwd,
    session,
    config,
    compactionConfig,
    interactive,
    modelExplicitlyPassed: Boolean(cliArgs.model || process.env.SOBA_MODEL),
    baseUrlOverride: cliArgs.baseUrl,
    baseUrlExplicitlyPassed: Boolean(cliArgs.baseUrl || process.env.SOBA_BASE_URL),
    apiKeyExplicitlyPassed: Boolean(cliArgs.apiKey || process.env.SOBA_API_KEY),
    noStream: cliArgs.noStream,
    stream: cliArgs.stream,
    tokenBudget: cliArgs.budget ?? 0,
    debug: cliArgs.debug,
    providerRegistryConfigPath: configPath,
  });
  const {
    runtime,
    agentLoop: loop,
    providerRegistry,
    client,
    tools,
    contextManager,
    skillManager,
    trustStore,
    sessionLifecycle,
    mcpRuntime,
    mcpManager,
    trustManager,
    mcpSecretStore,
  } = runtimeComposition;
  let activeSession = session;

  // Sound notifications — plays audio on agent events
  const soundNotifier = new SoundNotifier(soundConfig);
  runtime.onEvent((event) => soundNotifier.handleEvent(event));

  // Create renderer
  const renderer = createRenderer({
    mode: interactive ? "interactive" : "print",
    model: config.model,
    cwd,
    tokenBudget: cliArgs.budget ?? 0,
    i18n,
  });

  // Interactive REPL mode — full-screen TUI (pi-agent style)
  if (interactive) {
    const { configureOpenTuiAssets } = await import("../../ui/terminal/open-tui-assets");
    configureOpenTuiAssets();
    const { InteractiveTUI } = await import("../../ui/terminal/interactive-tui");
    const { ProviderStore } = await import("../../ui/terminal/interactive/model/provider-store");
    const { slashCommandRegistry } = await import("../../ui/terminal/interactive/commands/registry");
    // Reuse the outer i18n instance (already synced with config.lang after loadConfig)
    const providerStore = new ProviderStore({ registry: providerRegistry, proxy: client, i18n });
    const tui = new InteractiveTUI({
      cwd,
      tokenBudget: cliArgs.budget ?? 0,
      contextWindow: config.contextWindow,
      theme: config.theme,
      runtime,
      agentLoop: loop,
      toolNames: tools.getNames(),
      i18n,
      trustStore,
      providerStore,
      debug: cliArgs.debug,
      maxOutputTokens: config.maxOutputTokens,
      maxCompletionTokens: config.maxCompletionTokens,
      maxAgentIterations: config.maxAgentIterations,
      maxStalledIterations: config.maxStalledIterations,
      maxRunMinutes: config.maxRunMinutes,
      autoCompact: compactionConfig.auto,
      executeCommand: (input, output) =>
        executeCommand(input, {
          client,
          session: activeSession,
          sessionLifecycle,
          setSession: (nextSession) => {
            activeSession = nextSession;
            loop.setSessionManager(nextSession);
          },
          config,
          i18n,
          renderer: { emit: output },
          contextManager,
          skillManager,
          agentLoop: loop,
          registry: providerRegistry,
          mcpRuntime,
          mcpManager,
          mcpSecretStore,
          toolRegistry: tools,
          trustManager,
          tuiRegistry: slashCommandRegistry,
        }),
    });

    runtime.onEvent((event) => tui.onAgentEvent(event));
    await tui.run();
    return;
  }

  // Wire agent events to renderer (print mode only — not interactive)
  runtime.onEvent((event) => renderer.emitAgentEvent(event));

  // Handle dangerous operation confirmation in print mode
  runtime.onEvent((event) => {
    if (event.type === "dangerous_confirmation") {
      handleDangerousConfirmation(i18n, event.toolName, event.description, event.reason, event.resolve);
    }
  });

  // Read prompt from stdin if no CLI argument was provided and stdin is piped
  let prompt = cliArgs.prompt;
  if (!prompt && !process.stdin.isTTY) {
    const chunks: string[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    }
    prompt = chunks.join("").trim();
  }

  // One-shot mode
  if (prompt) {
    renderer.renderSessionStart(session.getSessionId());
    try {
      await runtime.runTurn({
        sessionId: session.getSessionId(),
        source: "print",
        content: [{ type: "text", text: prompt }],
      });
    } catch (error) {
      console.error(i18n.t("general.error", { message: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  // No prompt specified — show status
  console.log(i18n.t("cli.status.ready", { version: VERSION, model: config.model, baseUrl: config.baseUrl }));
  console.log(i18n.t("cli.status.interactiveHint"));
  console.log(i18n.t("cli.status.helpHint"));
}

// ─── Entry ───

main().catch((err) => {
  const i18n = new I18n(detectLocale());
  console.error(i18n.t("cli.error.fatal", { message: err.message }));
  process.exit(1);
});
