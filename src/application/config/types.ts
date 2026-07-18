/**
 * Configuration types for SOBA Agent.
 *
 * Phase 1: OpenAI-compatible provider only (single URL + API key).
 * Phase 2: Adds compaction sub-config with defaults and invariant validation.
 */

import type { CompactionConfig } from "../../kernel/compaction/config";
import {
  DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
  DEFAULT_SYNTHETIC_MAX_OUTPUT,
} from "../providers/model-defaults";
import type { ModelCompatibilityFeature, ProviderRegistryState } from "../providers/types";

export type { CompactionConfig } from "../../kernel/compaction/config";

export const TUI_THEME_NAMES = [
  "graphite",
  "vscode",
  "github",
  "aurora",
  "synthwave",
  "paper",
  "forest",
  "highContrast",
  "clay",
  "operator",
  "ink",
] as const;

export type TuiThemeName = (typeof TUI_THEME_NAMES)[number];

export function isTuiThemeName(value: unknown): value is TuiThemeName {
  return (
    typeof value === "string" && TUI_THEME_NAMES.includes(value as TuiThemeName)
  );
}

// ─── Sound notifications ───

/**
 * Sound notification repeat mode.
 * - "once": play the sound once per event
 * - "repeat": play the sound in a loop with repeatIntervalMs interval
 *   until the next event or agent state change
 */
export type SoundRepeatMode = "once" | "repeat";

export const SOUND_REPEAT_MODES: SoundRepeatMode[] = ["once", "repeat"];

export function isSoundRepeatMode(value: unknown): value is SoundRepeatMode {
  return typeof value === "string" && SOUND_REPEAT_MODES.includes(value as SoundRepeatMode);
}

/**
 * Sound notification configuration.
 *
 * Controllable at all levels:
 * - CLI: --sound-enabled / --no-sound, --sound-volume <n>, --sound-repeat
 * - Env:  SOBA_SOUND_ENABLED, SOBA_SOUND_VOLUME, SOBA_SOUND_REPEAT
 * - File: ~/.soba/config.json "sound" block
 */
export interface SoundConfig {
  /** Enable / disable sound notifications entirely */
  enabled: boolean;
  /** Volume level 0.0 (mute) to 1.0 (max) */
  volume: number;
  /** Play once per event or repeat at interval */
  repeatMode: SoundRepeatMode;
  /** Interval between repeats in milliseconds (only used when repeatMode = "repeat") */
  repeatIntervalMs: number;
}

export const DEFAULT_SOUND_CONFIG: SoundConfig = {
  enabled: true,
  volume: 0.7,
  repeatMode: "once",
  repeatIntervalMs: 3000,
};

export function isSoundConfig(value: unknown): value is SoundConfig {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.enabled === "boolean" &&
    typeof s.volume === "number" &&
    isSoundRepeatMode(s.repeatMode) &&
    typeof s.repeatIntervalMs === "number"
  );
}

export interface SobaConfig {
  /** OpenAI-compatible API base URL (default: https://api.openai.com/v1) */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /**
   * Active model id (e.g. "deepseek-v4-flash" or "openrouter/anthropic/claude-sonnet-4.6").
   * Source of truth is `registry.defaultModel` when a registry is present.
   */
  model: string;
  /** Adapter wire-compatibility features derived from the active ModelDefinition. */
  modelCompatibility?: ModelCompatibilityFeature[];
  /**
   * Maximum output tokens per response. **Derived from the active model**
   * (`ModelDefinition.maxOutput`) — not read from disk. CLI flag
   * `--max-output-tokens` and env `SOBA_MAX_OUTPUT_TOKENS` can override
   * the derived value for advanced use cases (e.g. local proxies that
   * lie about model sizes).
   */
  maxOutputTokens: number;
  /**
   * Active model's context window in tokens. **Derived from the active
   * model** (`ModelDefinition.contextWindow`) — not read from disk. CLI
   * flag `--context-window` and env `SOBA_CONTEXT_WINDOW` can override.
   */
  contextWindow: number;
  /**
   * Maximum completion tokens per response (includes reasoning/thinking).
   * Maps to max_completion_tokens in the provider request.
   * 0 = no explicit limit (provider default).
   * User preference — applies to all models.
   * Overridable via --max-completion-tokens CLI flag or SOBA_MAX_COMPLETION_TOKENS env.
   */
  maxCompletionTokens: number;
  /** Sampling temperature (0-2). User preference. */
  temperature: number;
  /** Emergency ceiling for model invocations in one task (0 = unlimited) */
  maxAgentIterations: number;
  /** Consecutive no-progress tool iterations before the agent is considered stuck */
  maxStalledIterations: number;
  /** Maximum duration of one task in minutes (0 = unlimited) */
  maxRunMinutes: number;
  /** Maximum timeout any bash tool call may request, in seconds */
  bashMaxTimeoutSeconds: number;
  /** Session storage directory (default: ~/.soba/sessions) */
  sessionDir: string;
  /** Default language for TUI (en/ru/zh) */
  lang: "en" | "ru" | "zh";
  /** Color theme for the interactive TUI */
  theme: TuiThemeName;
  /**
   * Phase 2: Compaction sub-config.
   * Partial — merged with DEFAULT_COMPACTION_CONFIG at runtime.
   * SOBA_AUTO_COMPACT=false and --no-auto-compact override compaction.auto.
   */
  compaction?: Partial<CompactionConfig>;
  /**
   * Phase 2.5: provider registry state (active provider/model + custom
   * providers + per-provider overrides). Preferred over the flat
   * `apiKey` / `baseUrl` / `model` fields above when present.
   */
  registry?: ProviderRegistryState;
  /** Sound notification sub-config. Partial — merged with DEFAULT_SOUND_CONFIG at runtime. */
  sound?: Partial<SoundConfig>;
}

/**
 * Default values for fields that have no natural source on disk.
 * `contextWindow` and `maxOutputTokens` are placeholders — they are
 * derived from the active model at config-load time (in `loadConfig`).
 * Code that reads them must always go through `loadConfig` first.
 */
export const DEFAULT_CONFIG: SobaConfig = {
  baseUrl: "", // Empty — filled by the registry/provider or explicit config
  apiKey: "",
  model: "",
  maxOutputTokens: DEFAULT_SYNTHETIC_MAX_OUTPUT,
  contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
  maxCompletionTokens: 0,
  temperature: 0.7,
  maxAgentIterations: 0,
  maxStalledIterations: 4,
  maxRunMinutes: 0,
  bashMaxTimeoutSeconds: 300,
  sessionDir: "",
  lang: "en",
  theme: "graphite",
  sound: { ...DEFAULT_SOUND_CONFIG },
};
