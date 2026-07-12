import { isLocale } from "../../shared/i18n/i18n";
import type { Locale } from "../../shared/i18n/types";
import type { RuntimeCommandMetadata } from "../command-service";
import { RUNTIME_COMMANDS } from "../command-service";
import type { SobaConfig, TuiThemeName } from "../config/types";
import { isTuiThemeName, TUI_THEME_NAMES } from "../config/types";

export interface ConfigCommandView {
  config: SobaConfig;
}

export type LangCommandView = { kind: "usage" } | { kind: "changed"; locale: Locale };

export type ThemeCommandView = { kind: "usage"; themes: readonly TuiThemeName[] } | { kind: "changed"; theme: TuiThemeName };

export type AutoCompactCommandView =
  | { kind: "status"; enabled: boolean }
  | { kind: "changed"; enabled: boolean };

export interface AutoCompactState {
  agentOverrideEnabled?: boolean;
  contextPolicyEnabled?: boolean;
  configEnabled?: boolean;
}

export interface HelpCommandView {
  commands: Array<{
    command: string;
    descriptionKey: RuntimeCommandMetadata["descriptionKey"];
  }>;
}

export function buildConfigCommandView(config: SobaConfig): ConfigCommandView {
  return { config: maskSensitiveConfig(config) };
}

export function executeLangCommand(args: string[]): LangCommandView {
  const lang = args[0];
  if (!lang || !isLocale(lang)) {
    return { kind: "usage" };
  }
  return { kind: "changed", locale: lang };
}

export function executeThemeCommand(args: string[]): ThemeCommandView {
  const theme = args[0];
  if (!isTuiThemeName(theme)) {
    return { kind: "usage", themes: TUI_THEME_NAMES };
  }
  return { kind: "changed", theme };
}

export function executeAutoCompactCommand(args: string[], state: AutoCompactState): AutoCompactCommandView {
  const action = args[0]?.toLowerCase();

  if (action !== "on" && action !== "off") {
    return {
      kind: "status",
      enabled: state.agentOverrideEnabled ?? state.contextPolicyEnabled ?? state.configEnabled ?? true,
    };
  }

  return {
    kind: "changed",
    enabled: action === "on",
  };
}

export function buildHelpCommandView(commands: readonly RuntimeCommandMetadata[] = RUNTIME_COMMANDS): HelpCommandView {
  const usages: Partial<Record<string, string>> = {
    "/theme": `/theme <${TUI_THEME_NAMES.join("|")}>`,
    "/queue": "/queue [edit <id> <message> | cancel <id|all>]",
  };

  return {
    commands: commands.map((command) => ({
      command: command.usage ?? usages[command.name] ?? command.name,
      descriptionKey: command.descriptionKey,
    })),
  };
}

function maskSensitiveConfig(config: SobaConfig): SobaConfig {
  const masked = { ...config };
  if (masked.apiKey && masked.apiKey.length > 8) {
    masked.apiKey = `${masked.apiKey.slice(0, 4)}${"*".repeat(masked.apiKey.length - 8)}${masked.apiKey.slice(-4)}`;
  } else if (masked.apiKey) {
    masked.apiKey = "****";
  }
  return masked;
}
