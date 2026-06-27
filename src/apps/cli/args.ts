/**
 * CLI argument parsing.
 *
 * Parses command-line arguments for SOBA Agent.
 * Priority: CLI args > env vars > config file > defaults
 */

import { isTuiThemeName, TUI_THEME_NAMES, type TuiThemeName } from "../../core/config/types";
import { I18n } from "../../core/i18n/i18n";
import type { Locale } from "../../core/i18n/types";

// ─── Types ───

export interface CliArgs {
  /** Prompt text for one-shot mode (positional) */
  prompt?: string;
  /** Interactive (REPL) mode */
  interactive: boolean;
  /** Continue last session */
  continueLast: boolean;
  /** Resume session via interactive selector */
  resume: boolean;
  /** Resume specific session by ID */
  sessionId?: string;
  /** Override model */
  model?: string;
  /** Override API key */
  apiKey?: string;
  /** Override base URL */
  baseUrl?: string;
  /** Language override */
  lang?: Locale;
  /** Interactive TUI color theme */
  theme?: TuiThemeName;
  /** Token budget limit */
  budget?: number;
  /** Maximum output tokens per model response */
  maxOutputTokens?: number;
  /** Maximum thinking/reasoning tokens per response (DeepSeek, o1, etc.) */
  maxCompletionTokens?: number;
  /** Model context window used for compaction */
  contextWindow?: number;
  /** Emergency ceiling for model invocations in one task */
  maxAgentIterations?: number;
  /** Consecutive no-progress tool iterations before stall recovery */
  maxStalledIterations?: number;
  /** Maximum duration of one task in minutes */
  maxRunMinutes?: number;
  /** Maximum timeout any bash tool call may request, in seconds */
  bashMaxTimeoutSeconds?: number;
  /** Disable session persistence */
  noSession: boolean;
  /** Disable colors */
  noColor: boolean;
  /** Disable streaming (force non-streaming mode) */
  noStream: boolean;
  /** Enable streaming (default for interactive mode) */
  stream: boolean;
  /** Enable sound notifications (overrides config) */
  soundEnabled?: boolean;
  /** Disable sound notifications */
  noSound?: boolean;
  /** Sound volume level (0.0–1.0) */
  soundVolume?: number;
  /** Enable sound repeat mode */
  soundRepeat?: boolean;
  /** Enable debug mode — writes loop decisions to session JSONL */
  debug: boolean;
  /**
   * Phase 2: Disable proactive compaction triggers (turn_complete, milestone).
   * Hard-limit and overflow recovery remain active.
   * Equivalent to SOBA_AUTO_COMPACT=false or compaction.auto: false in config.
   */
  noAutoCompact: boolean;
  /** Show help */
  help: boolean;
  /** Show version */
  version: boolean;
  /** Start ACP JSON-RPC server over stdio */
  acp: boolean;
  /**
   * `soba provider <sub> ...` sub-route. When this is defined, the binary
   * dispatches into the provider-cli module and skips agent setup. The
   * remaining raw argv (everything after the `provider` token) is preserved
   * verbatim in `providerSubArgs` so the subcommand parser can see flags
   * like `--base-url=...` that the top-level parser would otherwise reject.
   */
  providerSubcommand?: string;
  /** Raw argv slice after the `provider <sub>` tokens. */
  providerSubArgs: string[];
}

// ─── Defaults ───

let __maxTokensWarned = false;

/** Reset the deprecation warning flag. Test-only. */
export function _resetMaxTokensWarningForTests(): void {
  __maxTokensWarned = false;
}

export const DEFAULT_CLI_ARGS: CliArgs = {
  interactive: false,
  continueLast: false,
  resume: false,
  noSession: false,
  noColor: false,
  noStream: false,
  stream: false,
  debug: false,
  noAutoCompact: false,
  help: false,
  version: false,
  acp: false,
  providerSubArgs: [],
};

// ─── Parse ───

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { ...DEFAULT_CLI_ARGS };
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case "-i":
      case "--interactive":
        args.interactive = true;
        i++;
        break;

      case "-c":
      case "--continue":
        args.continueLast = true;
        i++;
        break;

      case "-r":
      case "--resume":
        args.resume = true;
        i++;
        break;

      case "-s":
      case "--session":
        args.sessionId = argv[i + 1];
        i += 2;
        break;

      case "-m":
      case "--model":
        args.model = argv[i + 1];
        i += 2;
        break;

      case "-k":
      case "--api-key":
        args.apiKey = argv[i + 1];
        i += 2;
        break;

      case "--base-url":
        args.baseUrl = argv[i + 1];
        i += 2;
        break;

      case "--lang":
        args.lang = argv[i + 1] as Locale;
        i += 2;
        break;

      case "--theme": {
        const themeVal = argv[i + 1];
        if (!themeVal || themeVal.startsWith("-")) {
          console.error(`Error: --theme requires a value. Valid themes: ${TUI_THEME_NAMES.join(", ")}`);
          process.exit(1);
        }
        if (!isTuiThemeName(themeVal)) {
          console.error(`Error: Unknown theme "${themeVal}". Valid themes: ${TUI_THEME_NAMES.join(", ")}`);
          process.exit(1);
        }
        args.theme = themeVal as TuiThemeName;
        i += 2;
        break;
      }

      case "--budget":
        args.budget = Number.parseInt(argv[i + 1], 10);
        i += 2;
        break;

      case "--max-output-tokens":
        args.maxOutputTokens = Number.parseInt(argv[i + 1], 10);
        i += 2;
        break;

      case "--max-tokens":
        // B1e: deprecated alias for --max-output-tokens. Kept for
        // back-compat with scripts written against the old flag name.
        // Logs a one-shot warning to stderr.
        args.maxOutputTokens = Number.parseInt(argv[i + 1], 10);
        if (!__maxTokensWarned) {
          __maxTokensWarned = true;
          // eslint-disable-next-line no-console
          console.warn(
            "[soba] --max-tokens is deprecated, use --max-output-tokens instead.",
          );
        }
        i += 2;
        break;

      case "--max-completion-tokens":
        args.maxCompletionTokens = Number.parseInt(argv[i + 1], 10);
        i += 2;
        break;

      case "--context-window":
        args.contextWindow = Number.parseInt(argv[i + 1], 10);
        i += 2;
        break;

      case "--max-agent-iterations":
        args.maxAgentIterations = Number.parseInt(argv[i + 1], 10);
        i += 2;
        break;

      case "--max-stalled-iterations":
        args.maxStalledIterations = Number.parseInt(argv[i + 1], 10);
        i += 2;
        break;

      case "--max-run-minutes":
        args.maxRunMinutes = Number.parseInt(argv[i + 1], 10);
        i += 2;
        break;

      case "--bash-max-timeout-seconds":
        args.bashMaxTimeoutSeconds = Number.parseInt(argv[i + 1], 10);
        i += 2;
        break;

      case "--no-session":
        args.noSession = true;
        i++;
        break;

      case "--no-color":
        args.noColor = true;
        i++;
        break;

      case "--no-stream":
        args.noStream = true;
        i++;
        break;

      case "--stream":
        args.stream = true;
        i++;
        break;

      case "--debug":
        args.debug = true;
        i++;
        break;

      case "--no-auto-compact":
        args.noAutoCompact = true;
        i++;
        break;

      case "--sound-enabled":
        args.soundEnabled = true;
        i++;
        break;

      case "--no-sound":
        args.noSound = true;
        i++;
        break;

      case "--sound-volume": {
        const vol = Number.parseFloat(argv[i + 1]);
        if (Number.isNaN(vol) || vol < 0 || vol > 1) {
          console.error("Error: --sound-volume must be a number between 0.0 and 1.0");
          process.exit(1);
        }
        args.soundVolume = vol;
        i += 2;
        break;
      }

      case "--sound-repeat":
        args.soundRepeat = true;
        i++;
        break;

      case "-h":
      case "--help":
        args.help = true;
        i++;
        break;

      case "-v":
      case "--version":
        args.version = true;
        i++;
        break;

      case "provider": {
        // Sub-route: `soba provider <subcommand> [...flags]`. Grab the next
        // token as the subcommand name (if any) and forward the rest of
        // argv verbatim. The subcommand parser knows about its own flags
        // and does not need the top-level `case` machinery.
        const sub = argv[i + 1];
        if (sub !== undefined && !sub.startsWith("-")) {
          args.providerSubcommand = sub;
          args.providerSubArgs = argv.slice(i + 2);
        } else {
          // `soba provider` with no subcommand is equivalent to `help`.
          args.providerSubcommand = "help";
          args.providerSubArgs = sub !== undefined ? [sub] : [];
        }
        return args;
      }

      case "acp":
        args.acp = true;
        return args;

      default:
        // Unknown flag starting with "-" — error out
        if (arg.startsWith("-")) {
          console.error(`Error: Unknown flag "${arg}". Run --help for usage.`);
          process.exit(1);
        }
        // Positional argument (prompt text)
        if (!args.prompt) {
          args.prompt = arg;
        }
        i++;
        break;
    }
  }

  return args;
}

// ─── Help Text ───

export function printHelp(i18n?: I18n): void {
  const instance = i18n ?? new I18n("en");
  const t = instance.t.bind(instance);

  console.log(`
${t("cli.help.title")}

${t("cli.help.usage")}

${t("cli.help.modes")}

${t("cli.help.optionsDetail")}

${t("cli.help.soundFlags")}

${t("cli.help.commandsDetail")}

${t("cli.help.env")}
`);
}
