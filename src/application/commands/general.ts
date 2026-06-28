import type { RuntimeCommandMetadata } from "../command-service";
import { RUNTIME_COMMANDS } from "../command-service";
import type { SobaConfig, TuiThemeName } from "../config/types";
import { isTuiThemeName, TUI_THEME_NAMES } from "../config/types";

export interface ConfigCommandView {
  config: SobaConfig;
}

export type LangCommandView = { kind: "usage" } | { kind: "changed"; locale: "en" | "ru" | "zh" };

export type ThemeCommandView = { kind: "usage"; themes: readonly TuiThemeName[] } | { kind: "changed"; theme: TuiThemeName };

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
  if (lang !== "en" && lang !== "ru" && lang !== "zh") {
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
