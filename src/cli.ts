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
import packageJson from "../package.json";
import { parseArgs, printHelp } from "./cli/args";
import { executeCommand } from "./cli/commands";
import { ContextManager } from "./core/compaction/context-manager";
import { BackgroundScheduler } from "./core/compaction/scheduler";
import {
  firstTimeSetup,
  loadConfig,
  resolveCompactionConfig,
  resolveSoundConfig,
  validateConfig,
} from "./core/config/config-loader";
import type { SobaConfig } from "./core/config/types";
import { detectLocale, I18n, isLocale } from "./core/i18n/i18n";
import type { Locale } from "./core/i18n/types";
import { AgentLoop } from "./core/loop/agent-loop";
import type { ApprovalDecision } from "./core/loop/types";
import { McpClientManager } from "./core/mcp/client-manager";
import { loadMcpConfig } from "./core/mcp/config";
import { syncMcpToolsIntoRegistry } from "./core/mcp/tool-registry-sync";
import { createMemoryTools } from "./core/memory/memory-tools";
import { ProjectMemory } from "./core/memory/project-memory";
import { SoundNotifier } from "./core/middleware/sound-notifier";
import { OpenResponsesClientProxy } from "./core/provider/client-proxy";
import { ProviderRegistry } from "./core/provider/registry";
import { listSessions, SessionManager } from "./core/session/session-manager";
import { SkillCatalog } from "./core/skills/catalog";
import { SkillDiscovery } from "./core/skills/discovery";
import { ProjectTrustStore } from "./core/skills/project-trust-store";
import { SkillManager } from "./core/skills/skill-manager";
import { bashTool } from "./core/tools/bash";
import { checkpointTool } from "./core/tools/checkpoint";
import { editTool } from "./core/tools/edit";
import { inspectFileTool } from "./core/tools/inspect-file";
import { lsTool } from "./core/tools/ls";
import { readTool } from "./core/tools/read";
import { searchFilesTool } from "./core/tools/search-files";
import { ToolRegistry } from "./core/tools/tool-registry";
import { writeTool } from "./core/tools/write";
import { TrustManager } from "./core/trust/trust-manager";
import { setColorDisabled } from "./tui/colors";
import { createRenderer } from "./tui/renderer";
import { initTheme } from "./tui/theme";

const VERSION = packageJson.version;

// ─── Helpers ───

function resolveLang(cliLang?: Locale): Locale {
  if (cliLang && isLocale(cliLang)) return cliLang;
  const envLang = process.env.SOBA_LANG;
  if (envLang && isLocale(envLang)) return envLang;
  return detectLocale();
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
    const { parseProviderCliArgs, runProviderCli } = await import("./cli/provider-cli");
    const { ProviderRegistry } = await import("./core/provider/registry");
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
    cliOverrides.sound = { ...cliOverrides.sound, ...soundCli } as Partial<import("./core/config/types").SoundConfig>;
  }

  const config = await loadConfig(cliOverrides, { configPath: process.env.SOBA_CONFIG_PATH });

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

  // Create provider registry (Phase 2.5 A1) — loads persisted state, exposes
  // the active provider/model, and produces OpenResponsesClient instances.
  // Everything else in the system holds a proxy, not a direct client, so
  // switching providers/models at runtime (via /model or Ctrl+M) just works.
  const persistedRegistry = await ProviderRegistry.loadFromFile();
  const providerRegistry = new ProviderRegistry(persistedRegistry ?? undefined);
  // Reconcile: when CLI flags (--model, --base-url) change the active
  // selection, override the persisted state for this run.
  //
  // Strategy:
  // 1. If --model was explicitly passed or config.model diverges from the
  //    persisted defaultModel, scan EVERY provider (custom + built-in) for
  //    the model. Built-in getModel() returns synthetic fallback for any id,
  //    which is acceptable here because the user explicitly asked for it.
  // 2. Otherwise fall back to baseUrl matching (--base-url flag).
  // 3. If nothing matched, leave the persisted selection intact.
  const persistedDefaultModel = persistedRegistry?.defaultModel;
  const modelExplicitlyPassed = Boolean(cliArgs.model);
  const modelDiffersFromPersisted = config.model && config.model !== persistedDefaultModel;
  let cliProviderId: string | undefined;
  if (modelExplicitlyPassed || modelDiffersFromPersisted) {
    for (const p of providerRegistry.getAllProviders()) {
      if (providerRegistry.getModel(p.id, config.model)) {
        cliProviderId = p.id;
        break;
      }
    }
  }
  if (!cliProviderId) {
    cliProviderId = providerRegistry.getAllProviders().find((p) => p.baseUrl === config.baseUrl)?.id;
  }
  if (cliProviderId) {
    providerRegistry.setActive(cliProviderId, config.model);
  }
  const clientProxy = new OpenResponsesClientProxy(providerRegistry);
  // Apply CLI --base-url override to the active provider so real HTTP
  // requests use the overridden URL (not just the status-bar display).
  if (cliArgs.baseUrl) {
    providerRegistry.setBaseUrl(clientProxy.getActiveProviderId(), cliArgs.baseUrl);
  }
  // Backwards-compat: expose the proxy via `client` so the rest of the file
  // (which expects OpenResponsesClient) keeps working unchanged.
  const client = clientProxy;

  // Create tool registry
  const tools = new ToolRegistry();
  tools.register(readTool);
  tools.register(writeTool);
  tools.register(bashTool);
  tools.register(editTool);
  tools.register(lsTool);
  tools.register(searchFilesTool);
  tools.register(inspectFileTool);
  tools.register(checkpointTool);
  for (const memoryTool of createMemoryTools()) {
    tools.register(memoryTool);
  }

  const projectMemory = new ProjectMemory({ projectRoot: cwd });
  projectMemory.initialize();

  const trustManager = new TrustManager();
  const mcpConfig = await loadMcpConfig({ projectRoot: cwd });
  const mcpManager = mcpConfig ? new McpClientManager({ servers: mcpConfig.servers }) : undefined;
  if (mcpManager) {
    await syncMcpToolsIntoRegistry(tools, mcpManager, { trustManager });
  }

  // Create ContextManager and BackgroundScheduler for proactive compaction
  const providerIdentity = client.getProviderIdentity();
  const providerCapabilities = client.getProviderCapabilities();
  
  const contextManagerConfig = {
    compaction: compactionConfig,
    contextWindow: config.contextWindow,
    maxOutputTokens: config.maxOutputTokens,
    provider: providerIdentity,
    capabilities: providerCapabilities,
    generatorConfig: {
      modelInvoker: {
        invoke: async (prompt: string, _signal: AbortSignal): Promise<string> => {
          const response = await client.create({
            model: config.model,
            input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }] }],
            max_output_tokens: config.maxOutputTokens,
          });
          const textOutput = response.output.find((o) => o.type === "message" && o.role === "assistant");
          return textOutput && "content" in textOutput
            ? (textOutput as { content: Array<{ text: string }> }).content.map((c) => c.text).join("")
            : "";
        },
      },
    },
  };
  
  const contextManager = new ContextManager(session, contextManagerConfig);
  
  const schedulerConfig = {
    backgroundTimeoutMs: compactionConfig.backgroundTimeoutMs,
  };
  
  const backgroundScheduler = new BackgroundScheduler(session, contextManager, schedulerConfig);

  // Create SkillManager for skill discovery and activation
  const sobaDir = join(homedir(), ".soba");
  const trustStore = new ProjectTrustStore({ sobaDir });
  const userSkillsPath = join(sobaDir, "skills");
  
  const bundledSkillsPath = process.env.SOBA_BUNDLED_SKILLS_PATH ?? join(process.cwd(), "skills");
  
  const skillDiscovery = new SkillDiscovery({
    projectPath: cwd,
    userSkillsPath,
    bundledSkillsPath,
    trustStore,
  });
  
  const skillCatalog = new SkillCatalog({ discovery: skillDiscovery });
  
  const skillManager = new SkillManager({
    catalog: skillCatalog,
    discovery: skillDiscovery,
    trustStore,
  });
  
  // Initial scan of skills
  skillManager.refresh();

  // Register activate_skill tool if skills are available
  if (skillCatalog.getModelInvocable().length > 0) {
    const { createActivateSkillTool } = await import("./core/tools/activate-skill");
    const activateSkillTool = createActivateSkillTool({
      catalog: skillCatalog,
      onActivate: (ref) => {
        // Update runtime activeSkills (for ephemeral messages + events)
        skillManager.activate(ref.name);
        // Persist activation in session
        session.appendSkillActivation({ action: "activate", skill: ref });
      },
      isActive: (name, revision) => {
        // Check if skill is already active with same revision
        const activeSkills = skillManager.getActiveSkills();
        return activeSkills.some(
          (skill) => skill.name === name && skill.revision === revision,
        );
      },
    });
    tools.register(activateSkillTool);
  }

  // Create agent loop
  // Streaming: enabled by default for interactive mode, can be overridden
  const useStreaming = cliArgs.noStream ? false : cliArgs.stream || interactive;

  const loop = new AgentLoop(client, session, tools, cwd, {
    emitEvents: true,
    tokenBudget: cliArgs.budget ?? 0,
    stream: useStreaming,
    debug: cliArgs.debug,
    maxAgentIterations: config.maxAgentIterations,
    maxStalledIterations: config.maxStalledIterations,
    maxRunDurationMs: config.maxRunMinutes * 60 * 1000,
    bashMaxTimeoutSeconds: config.bashMaxTimeoutSeconds,
  }, trustManager, undefined, contextManager, backgroundScheduler, skillManager, { enabled: compactionConfig.auto }, projectMemory);

  // Sound notifications — plays audio on agent events
  const soundNotifier = new SoundNotifier(soundConfig);
  loop.onEvent((event) => soundNotifier.handleEvent(event));

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
    const { configureOpenTuiAssets } = await import("./tui/open-tui-assets");
    configureOpenTuiAssets();
    const { InteractiveTUI } = await import("./tui/interactive-tui");
    const { ProviderStore } = await import("./widgets/tui/model/provider-store");
    const { slashCommandRegistry } = await import("./widgets/tui/commands/registry");
    // Reuse the outer i18n instance (already synced with config.lang after loadConfig)
    const providerStore = new ProviderStore({ registry: providerRegistry, proxy: clientProxy, i18n });
    const tui = new InteractiveTUI({
      cwd,
      tokenBudget: cliArgs.budget ?? 0,
      contextWindow: config.contextWindow,
      theme: config.theme,
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
          session,
          config,
          i18n,
          renderer: { emit: output },
          contextManager,
          skillManager,
          agentLoop: loop,
          registry: providerRegistry,
          mcpManager,
          toolRegistry: tools,
          trustManager,
          tuiRegistry: slashCommandRegistry,
        }),
    });

    loop.onEvent((event) => tui.onAgentEvent(event));
    await tui.run();
    return;
  }

  // Wire agent events to renderer (print mode only — not interactive)
  loop.onEvent((event) => renderer.emitAgentEvent(event));

  // Handle dangerous operation confirmation in print mode
  loop.onEvent((event) => {
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
      await loop.runTurn(prompt);
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
