/**
 * Configuration loader for SOBA Agent.
 *
 * Flow on first run:
 *   1. Load .env from cwd (if exists) — development convenience
 *   2. Load env vars (SOBA_API_KEY, SOBA_MODEL, SOBA_BASE_URL, SOBA_LANG)
 *   3. Load ~/.soba/config.json (persistent user config)
 *   4. Merge: CLI args > env > file > defaults
 *   5. If no apiKey → prompt first-time wizard
 *
 * Priority: CLI args > env vars > config file > defaults
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SobaConfig, SoundConfig } from "../../application/config/types";
import { DEFAULT_CONFIG, DEFAULT_SOUND_CONFIG, isTuiThemeName } from "../../application/config/types";
import {
  DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
  DEFAULT_SYNTHETIC_MAX_OUTPUT,
} from "../../application/providers/model-defaults";
import { BUILTIN_PROVIDERS } from "../../application/providers/providers";
import type { ModelDefinition, ProviderDefinition } from "../../application/providers/types";
import {
  type CompactionConfig,
  DEFAULT_COMPACTION_CONFIG,
  validateCompactionConfig,
} from "../../engine/compaction/trigger-policy";
import { discoverModels, toModelDefinitions } from "../../infrastructure/llm/providers/discovery";
import { ProviderRegistry } from "../../infrastructure/llm/providers/registry";
import type { I18n } from "../../shared/i18n/i18n";

/** Path to the config file: ~/.soba/config.json */
export function getConfigPath(): string {
  return join(homedir(), ".soba", "config.json");
}

/** Load .env file from cwd if it exists (for development). */
function loadDotEnv(): void {
  try {
    const envPath = join(process.cwd(), ".env");
    if (!existsSync(envPath)) return;
    const content = require("node:fs").readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env is optional
  }
}

/** Deep merge: override non-empty values from source into base. */
function mergeConfig(
  base: SobaConfig,
  override: Partial<SobaConfig>,
): SobaConfig {
  const merged = { ...base };
  for (const key of Object.keys(override) as (keyof SobaConfig)[]) {
    const val = override[key];
    if (val !== undefined && val !== "") {
      if (key === "compaction") {
        merged.compaction = {
          ...merged.compaction,
          ...(val as Partial<CompactionConfig>),
        };
      } else {
        (merged as Record<string, unknown>)[key] = val;
      }
    }
  }
  return merged;
}

function parseCompactionConfig(
  value: unknown,
): Partial<CompactionConfig> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;

  const parsed = value as Record<string, unknown>;
  const config: Partial<CompactionConfig> = {};
  const booleanKeys = [
    "auto",
    "compactOnTurnComplete",
    "compactOnMilestone",
  ] as const;
  const numberKeys = [
    "minTokensForAutoCompact",
    "minReclaimableTokens",
    "minSavingsRatio",
    "keepRecentTokens",
    "safetyReserveTokens",
    "backgroundTimeoutMs",
  ] as const;

  for (const key of booleanKeys) {
    if (typeof parsed[key] === "boolean") config[key] = parsed[key];
  }
  for (const key of numberKeys) {
    if (typeof parsed[key] === "number") config[key] = parsed[key];
  }

  return config;
}

/**
 * Detect the legacy `registry.selectedModels[*][*].apiKey` field
 * (a side-effect of an early wizard version) and migrate it to
 * `registry.providers[id].apiKey`. Returns true if any migration
 * happened.
 *
 * Safe to call multiple times — once the key is in providers[], the
 * selectedModels field is ignored.
 */
function migrateLegacySelectedModelApiKeys(
  parsed: Record<string, unknown>,
): boolean {
  const reg = parsed.registry;
  if (!reg || typeof reg !== "object") return false;
  const r = reg as Record<string, unknown>;
  const selected = r.selectedModels;
  const providers = (
    r.providers && typeof r.providers === "object"
      ? { ...(r.providers as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  let migrated = false;
  if (selected && typeof selected === "object") {
    for (const [providerId, models] of Object.entries(
      selected as Record<string, unknown>,
    )) {
      if (!Array.isArray(models)) continue;
      for (const m of models) {
        if (!m || typeof m !== "object") continue;
        const modelRec = m as Record<string, unknown>;
        const k = modelRec.apiKey;
        if (typeof k === "string" && k.length > 0) {
          const existing = providers[providerId];
          const existingRec =
            existing && typeof existing === "object"
              ? (existing as Record<string, unknown>)
              : {};
          const existingKey =
            typeof existingRec.apiKey === "string"
              ? (existingRec.apiKey as string)
              : "";
          if (!existingKey) {
            providers[providerId] = { ...existingRec, apiKey: k };
            migrated = true;
          }
        }
      }
    }
  }
  if (migrated) {
    r.providers = providers;
    if (!Array.isArray(r.migrationLog)) r.migrationLog = [];
    (r.migrationLog as unknown[]).push({
      at: new Date().toISOString(),
      from: "selectedModels[*][*].apiKey",
      to: "providers[*].apiKey",
    });
  }
  return migrated;
}

/**
 * Internal helper: read the on-disk JSON and extract both the
 * SobaConfig-shaped values and the legacy `maxTokens` /
 * `contextWindow` fields (B1e: these are no longer read into the
 * SobaConfig — the active model is the source of truth — but we
 * still want to detect them so we can warn the user).
 */
async function readConfigFile(
  configPath?: string,
): Promise<{
  config: SobaConfig;
  legacy: { maxTokens?: number; contextWindow?: number };
} | null> {
  const path = configPath ?? getConfigPath();
  try {
    const raw = await Bun.file(path).text();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // B1e migration: lift apiKey from registry.selectedModels[*][*] into
    // registry.providers[*]. Happens before constructing the SobaConfig
    // so downstream code can rely on providers[] being authoritative.
    migrateLegacySelectedModelApiKeys(parsed);

    const config = { ...DEFAULT_CONFIG };
    if (typeof parsed.baseUrl === "string") config.baseUrl = parsed.baseUrl;
    if (typeof parsed.apiKey === "string") config.apiKey = parsed.apiKey;
    if (typeof parsed.model === "string") config.model = parsed.model;
    if (typeof parsed.temperature === "number")
      config.temperature = parsed.temperature;
    if (typeof parsed.maxAgentIterations === "number")
      config.maxAgentIterations = parsed.maxAgentIterations;
    if (typeof parsed.maxStalledIterations === "number")
      config.maxStalledIterations = parsed.maxStalledIterations;
    if (typeof parsed.maxRunMinutes === "number")
      config.maxRunMinutes = parsed.maxRunMinutes;
    if (typeof parsed.bashMaxTimeoutSeconds === "number")
      config.bashMaxTimeoutSeconds = parsed.bashMaxTimeoutSeconds;
    if (typeof parsed.sessionDir === "string")
      config.sessionDir = parsed.sessionDir;
    if (parsed.lang === "en" || parsed.lang === "ru" || parsed.lang === "zh")
      config.lang = parsed.lang;
    if (isTuiThemeName(parsed.theme)) config.theme = parsed.theme;
    config.compaction = parseCompactionConfig(parsed.compaction);
    // Sound notifications block
    if (parsed.sound && typeof parsed.sound === "object" && !Array.isArray(parsed.sound)) {
      config.sound = { ...config.sound, ...parsed.sound } as Partial<SoundConfig>;
    }
    // New Phase 2.5 registry block — preferred over the flat top-level
    // fields when present. The flat fields are kept for back-compat with
    // pre-2.5 config files and legacy CLI overrides.
    if (parsed.registry && typeof parsed.registry === "object") {
      config.registry = parsed.registry as SobaConfig["registry"];
    }
    // B1e: extract legacy maxTokens / contextWindow as a side-channel.
    // The active model is the source of truth; these fields are only
    // honoured as a back-compat fallback when no registry is present
    // (pre-2.5 flat-only configs).
    const legacy: { maxTokens?: number; contextWindow?: number } = {};
    if (typeof parsed.maxTokens === "number")
      legacy.maxTokens = parsed.maxTokens;
    if (typeof parsed.contextWindow === "number")
      legacy.contextWindow = parsed.contextWindow;
    return { config, legacy };
  } catch {
    return null;
  }
}

/** Load config from JSON file at the given path. Returns null if file doesn't exist or is invalid. */
export async function loadConfigFromFile(
  configPath?: string,
): Promise<SobaConfig | null> {
  const result = await readConfigFile(configPath);
  return result ? result.config : null;
}

/** Save config to JSON file. Creates parent dirs if needed. */
export async function saveConfigToFile(
  config: SobaConfig,
  configPath?: string,
): Promise<void> {
  const path = configPath ?? getConfigPath();
  const dir = join(path, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await Bun.write(path, JSON.stringify(config, null, 2));
}

/**
 * Mask sensitive fields in config for safe display.
 * Returns a copy with apiKey showing only first 4 and last 4 characters.
 */
export function maskSensitiveFields(config: SobaConfig): SobaConfig {
  const masked = { ...config };
  if (masked.apiKey && masked.apiKey.length > 8) {
    masked.apiKey = `${masked.apiKey.slice(0, 4)}${"*".repeat(masked.apiKey.length - 8)}${masked.apiKey.slice(-4)}`;
  } else if (masked.apiKey) {
    masked.apiKey = "****";
  }
  return masked;
}

/** Per-session flags to keep deprecation warnings one-shot. */
const _deprecationWarnings = {
  legacyMaxTokens: false,
  legacyContextWindow: false,
  legacyApiKeyFromSelectedModels: false,
  legacyFlatMaxTokens: false,
  legacyFlatContextWindow: false,
};

/** Reset the deprecation-warning flags. Test-only. */
export function _resetDeprecationWarningsForTests(): void {
  _deprecationWarnings.legacyMaxTokens = false;
  _deprecationWarnings.legacyContextWindow = false;
  _deprecationWarnings.legacyApiKeyFromSelectedModels = false;
  _deprecationWarnings.legacyFlatMaxTokens = false;
  _deprecationWarnings.legacyFlatContextWindow = false;
}

/** Load config from environment variables (SOBA_* prefix). */
export function loadConfigFromEnv(): Partial<SobaConfig> {
  const overrides: Partial<SobaConfig> = {};
  if (process.env.SOBA_API_KEY) overrides.apiKey = process.env.SOBA_API_KEY;
  if (process.env.SOBA_MODEL) overrides.model = process.env.SOBA_MODEL;
  if (process.env.SOBA_BASE_URL) overrides.baseUrl = process.env.SOBA_BASE_URL;
  // Canonical: SOBA_MAX_OUTPUT_TOKENS. Legacy alias: SOBA_MAX_TOKENS.
  if (process.env.SOBA_MAX_OUTPUT_TOKENS) {
    overrides.maxOutputTokens = Number.parseInt(
      process.env.SOBA_MAX_OUTPUT_TOKENS,
      10,
    );
  } else if (process.env.SOBA_MAX_TOKENS) {
    if (!_deprecationWarnings.legacyMaxTokens) {
      _deprecationWarnings.legacyMaxTokens = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[soba] SOBA_MAX_TOKENS is deprecated, use SOBA_MAX_OUTPUT_TOKENS instead.",
      );
    }
    overrides.maxOutputTokens = Number.parseInt(
      process.env.SOBA_MAX_TOKENS,
      10,
    );
  }
  if (process.env.SOBA_MAX_COMPLETION_TOKENS) {
    overrides.maxCompletionTokens = Number.parseInt(
      process.env.SOBA_MAX_COMPLETION_TOKENS,
      10,
    );
  }
  if (process.env.SOBA_CONTEXT_WINDOW) {
    overrides.contextWindow = Number.parseInt(
      process.env.SOBA_CONTEXT_WINDOW,
      10,
    );
  }
  if (process.env.SOBA_MAX_AGENT_ITERATIONS) {
    overrides.maxAgentIterations = Number.parseInt(
      process.env.SOBA_MAX_AGENT_ITERATIONS,
      10,
    );
  }
  if (process.env.SOBA_MAX_STALLED_ITERATIONS) {
    overrides.maxStalledIterations = Number.parseInt(
      process.env.SOBA_MAX_STALLED_ITERATIONS,
      10,
    );
  }
  if (process.env.SOBA_MAX_RUN_MINUTES)
    overrides.maxRunMinutes = Number.parseInt(
      process.env.SOBA_MAX_RUN_MINUTES,
      10,
    );
  if (process.env.SOBA_BASH_MAX_TIMEOUT_SECONDS) {
    overrides.bashMaxTimeoutSeconds = Number.parseInt(
      process.env.SOBA_BASH_MAX_TIMEOUT_SECONDS,
      10,
    );
  }
  if (
    process.env.SOBA_LANG === "en" ||
    process.env.SOBA_LANG === "ru" ||
    process.env.SOBA_LANG === "zh"
  ) {
    overrides.lang = process.env.SOBA_LANG;
  }
  if (isTuiThemeName(process.env.SOBA_THEME))
    overrides.theme = process.env.SOBA_THEME;

  // Phase 2: SOBA_AUTO_COMPACT=false disables proactive compaction triggers
  if (
    process.env.SOBA_AUTO_COMPACT === "false" ||
    process.env.SOBA_AUTO_COMPACT === "0"
  ) {
    overrides.compaction = { ...overrides.compaction, auto: false };
  }

  // Sound notifications
  const soundEnv: Partial<Record<string, unknown>> = {};
  if (process.env.SOBA_SOUND_ENABLED !== undefined) {
    const val = process.env.SOBA_SOUND_ENABLED.toLowerCase();
    soundEnv.enabled = val === "true" || val === "1";
  }
  if (process.env.SOBA_SOUND_VOLUME !== undefined) {
    const vol = Number.parseFloat(process.env.SOBA_SOUND_VOLUME);
    if (!Number.isNaN(vol) && vol >= 0 && vol <= 1) {
      soundEnv.volume = vol;
    }
  }
  if (process.env.SOBA_SOUND_REPEAT !== undefined) {
    const val = process.env.SOBA_SOUND_REPEAT.toLowerCase();
    if (val === "true" || val === "1") {
      soundEnv.repeatMode = "repeat";
    } else if (val === "false" || val === "0") {
      soundEnv.repeatMode = "once";
    }
  }
  if (Object.keys(soundEnv).length > 0) {
    overrides.sound = { ...overrides.sound, ...soundEnv } as Partial<SoundConfig>;
  }

  return overrides;
}

/**
 * Check if config is ready to use (has apiKey and model).
 * Returns missing fields.
 */
export function validateConfig(config: SobaConfig): string[] {
  const missing: string[] = [];
  // Phase 2.5: registry is the primary config shape. Built-in providers
  // carry a baseUrl, while secrets come from registry.providers[id].apiKey
  // or the provider-specific environment variable.
  if (config.registry?.defaultProvider) {
    const providerId = config.registry.defaultProvider;
    const provider =
      config.registry.customProviders?.[providerId] ??
      BUILTIN_PROVIDERS.find((candidate) => candidate.id === providerId);
    const persistedKey = config.registry.providers?.[providerId]?.apiKey;
    if (!provider) {
      missing.push(`provider:${providerId}`);
    } else if (
      provider.apiKeyEnv &&
      !persistedKey &&
      !process.env[provider.apiKeyEnv] &&
      !hasUsableRegistryFallback(config, providerId)
    ) {
      missing.push(provider.apiKeyEnv);
    }
    return missing;
  }
  // Backward compat: old key name.
  if (
    (config.registry as Record<string, unknown> | undefined)?.["activeProvider"]
  ) {
    return missing;
  }
  // Legacy flat fields — kept for back-compat with pre-2.5 config files
  // and for setups that prefer the single-endpoint shape.
  if (!config.apiKey) missing.push("apiKey");
  if (!config.baseUrl) missing.push("baseUrl");
  return missing;
}

function hasUsableRegistryFallback(config: SobaConfig, activeProviderId: string): boolean {
  const registry = config.registry;
  if (!registry) return false;
  const providers = new Map<string, ProviderDefinition>();
  for (const provider of BUILTIN_PROVIDERS) providers.set(provider.id, provider);
  for (const [providerId, provider] of Object.entries(registry.customProviders ?? {})) {
    providers.set(providerId, provider);
  }

  for (const [providerId, secret] of Object.entries(registry.providers ?? {})) {
    if (providerId === activeProviderId || !secret.apiKey) continue;
    if (providers.has(providerId)) return true;
  }

  for (const [providerId, provider] of providers) {
    if (providerId === activeProviderId) continue;
    if (!provider.apiKeyEnv || process.env[provider.apiKeyEnv]) return true;
  }
  return false;
}

/**
 * Load the final config with proper priority:
 * 1. Load .env from cwd (development convenience)
 * 2. CLI overrides (highest)
 * 3. Environment variables
 * 4. Config file (~/.soba/config.json)
 * 5. Defaults (lowest)
 *
 * After all merging, if a registry is present, the active model's
 * parameters (`contextWindow`, `maxOutputTokens`) are derived from
 * `ModelDefinition` — they never come from disk. CLI/env overrides
 * take precedence over the derived values when explicitly set.
 */
export async function loadConfig(
  cliOverrides: Partial<SobaConfig> = {},
  options: { configPath?: string } = {},
): Promise<SobaConfig> {
  loadDotEnv();

  const fileResult = await readConfigFile(options.configPath);
  const fileConfig = fileResult?.config ?? null;
  const fileLegacy = fileResult?.legacy ?? {};
  const envOverrides = loadConfigFromEnv();

  let config = DEFAULT_CONFIG;
  if (fileConfig) config = mergeConfig(config, fileConfig);
  config = mergeConfig(config, envOverrides);
  config = mergeConfig(config, cliOverrides);

  // B1d: if the file has a registry, lift the active provider's
  // baseUrl/apiKey/model into the flat config so legacy callers
  // (agent loop, TUI status bar) keep showing the right values.
  // The registry is the source of truth. Stale flat fields from older
  // config versions are ignored unless the user explicitly overrides
  // them through env vars or CLI flags.
  const hasModelOverride =
    envOverrides.model !== undefined || cliOverrides.model !== undefined;
  const hasBaseUrlOverride =
    envOverrides.baseUrl !== undefined || cliOverrides.baseUrl !== undefined;
  const hasApiKeyOverride =
    envOverrides.apiKey !== undefined || cliOverrides.apiKey !== undefined;
  if (fileConfig?.registry?.defaultProvider) {
    const reg = fileConfig.registry;
    const regProviderId = reg.defaultProvider;
    const secret = reg.providers?.[regProviderId];
    const provider =
      reg.customProviders?.[regProviderId] ??
      BUILTIN_PROVIDERS.find((p) => p.id === regProviderId);
    if (!hasModelOverride) config.model = reg.defaultModel ?? "";
    if (!hasBaseUrlOverride) config.baseUrl = secret?.baseUrl ?? provider?.baseUrl ?? "";
    if (!hasApiKeyOverride) config.apiKey = secret?.apiKey ?? "";
  }
  // Backward compat: read old `activeProvider` key.
  if (fileConfig && !fileConfig.registry?.defaultProvider) {
    const reg = fileConfig.registry as unknown as
      | Record<string, unknown>
      | undefined;
    const oldActiveProvider = reg?.activeProvider as string | undefined;
    const oldActiveModel = reg?.activeModel as string | undefined;
    if (oldActiveProvider) {
      const regTyped = fileConfig.registry!;
      const secret = regTyped.providers?.[oldActiveProvider];
      const provider =
        regTyped.customProviders?.[oldActiveProvider] ??
        BUILTIN_PROVIDERS.find((p) => p.id === oldActiveProvider);
      if (!hasModelOverride) config.model = oldActiveModel ?? "";
      if (!hasBaseUrlOverride) config.baseUrl = secret?.baseUrl ?? provider?.baseUrl ?? "";
      if (!hasApiKeyOverride) config.apiKey = secret?.apiKey ?? "";
    }
  }

  // B1e: derive contextWindow + maxOutputTokens from the active model.
  // The file is no longer the source of truth for these fields — the
  // active ModelDefinition is. CLI/env overrides win.
  if (
    fileConfig?.registry?.defaultProvider ||
    (fileConfig?.registry as unknown as Record<string, unknown>)?.activeProvider
  ) {
    try {
      const reg = new ProviderRegistry(
        regStateFromFile(fileConfig!.registry!),
        {
          configPath: options.configPath ?? getConfigPath(),
        },
      );
      const model = reg.getActiveModel();
      const hasCtxOverride =
        envOverrides.contextWindow !== undefined ||
        cliOverrides.contextWindow !== undefined;
      const hasMaxOverride =
        envOverrides.maxOutputTokens !== undefined ||
        cliOverrides.maxOutputTokens !== undefined;
      if (!hasCtxOverride) config.contextWindow = model.contextWindow;
      if (!hasMaxOverride) config.maxOutputTokens = model.maxOutput;
    } catch {
      // If registry resolution fails (e.g. the active model id has
      // been removed from the catalogue), keep the file-derived values.
      // The wizard will offer a replacement.
    }
  } else if (
    fileLegacy.maxTokens !== undefined ||
    fileLegacy.contextWindow !== undefined
  ) {
    // Pre-2.5 flat-only config (no registry). Honour the legacy
    // maxTokens / contextWindow as a back-compat fallback, with a
    // one-shot deprecation warning telling the user to run the wizard.
    const hasMaxOverride =
      envOverrides.maxOutputTokens !== undefined ||
      cliOverrides.maxOutputTokens !== undefined;
    const hasCtxOverride =
      envOverrides.contextWindow !== undefined ||
      cliOverrides.contextWindow !== undefined;
    if (!hasMaxOverride && fileLegacy.maxTokens !== undefined) {
      config.maxOutputTokens = fileLegacy.maxTokens;
    }
    if (!hasCtxOverride && fileLegacy.contextWindow !== undefined) {
      config.contextWindow = fileLegacy.contextWindow;
    }
    if (
      fileLegacy.maxTokens !== undefined &&
      !_deprecationWarnings.legacyFlatMaxTokens
    ) {
      _deprecationWarnings.legacyFlatMaxTokens = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[soba] Flat `maxTokens` in ~/.soba/config.json is deprecated. " +
          "Run the first-time setup (delete this file and run `soba`) to migrate to a registry.",
      );
    }
    if (
      fileLegacy.contextWindow !== undefined &&
      !_deprecationWarnings.legacyFlatContextWindow
    ) {
      _deprecationWarnings.legacyFlatContextWindow = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[soba] Flat `contextWindow` in ~/.soba/config.json is deprecated. " +
          "Run the first-time setup (delete this file and run `soba`) to migrate to a registry.",
      );
    }
  }

  return config;
}

/**
 * Build a `ProviderRegistryState`-shaped object from the on-disk
 * registry block. Used by `loadConfig` to resolve the active model
 * without touching the registry's `persistConfig` side-effects.
 */
function regStateFromFile(
  registry: NonNullable<SobaConfig["registry"]>,
): NonNullable<SobaConfig["registry"]> {
  // Normalize old `activeProvider`/`activeModel` keys to the new
  // `defaultProvider`/`defaultModel` naming.
  const r = registry as unknown as Record<string, unknown>;
  if (!r.defaultProvider && r.activeProvider) {
    r.defaultProvider = r.activeProvider;
  }
  if (!r.defaultModel && r.activeModel) {
    r.defaultModel = r.activeModel;
  }
  delete r.activeProvider;
  delete r.activeModel;
  return r as unknown as NonNullable<SobaConfig["registry"]>;
}

/** Resolve a complete, validated compaction config for runtime use. */
export function resolveSoundConfig(
  config: SobaConfig,
): SoundConfig {
  return {
    ...DEFAULT_SOUND_CONFIG,
    ...config.sound,
  };
}

export function resolveCompactionConfig(
  config: SobaConfig,
  disableAuto = false,
): CompactionConfig {
  const compaction = {
    ...DEFAULT_COMPACTION_CONFIG,
    ...config.compaction,
    ...(disableAuto ? { auto: false } : {}),
  };

  // Auto-adapt keepRecentTokens when contextWindow is too small for defaults.
  // This prevents a fatal crash with small --context-window values.
  const hardLimit =
    config.contextWindow -
    config.maxOutputTokens -
    compaction.safetyReserveTokens;
  if (hardLimit > 0 && compaction.keepRecentTokens >= hardLimit) {
    compaction.keepRecentTokens = Math.max(1, Math.floor(hardLimit * 0.85));
  }

  const validation = validateCompactionConfig(
    compaction,
    config.contextWindow,
    config.maxOutputTokens,
  );
  if (!validation.valid) {
    throw new Error(
      `Invalid compaction config: ${validation.errors.join("; ")}`,
    );
  }
  return compaction;
}

/**
 * Fetch available models from the OpenAI-compatible /v1/models endpoint.
 * Returns model IDs sorted alphabetically. Returns empty array on failure.
 */
/**
 * ANSI helpers for the setup banner (no external deps).
 */
const _BOLD = "\x1b[1m";
const _GREEN_DEEP = "\x1b[38;2;34;80;50m"; // #225032 — deep forest
const _GREEN_DARK = "\x1b[38;2;56;116;74m"; // #38744A — dark green
const _GREEN = "\x1b[38;2;85;155;106m"; // #559B6A — mid forest
const _GREEN_BRIGHT = "\x1b[38;2;126;196;148m"; // #7EC494 — vibrant green
const _GREEN_GLOW = "\x1b[38;2;163;230;175m"; // #A3E6AF — soft glow
const _CYAN = "\x1b[38;2;110;158;184m"; // #6E9EB8 — info
const _YELLOW = "\x1b[38;2;227;179;65m"; // #E3B341 — gold accent
const _DIM = "\x1b[38;2;108;123;102m"; // #6C7B66 — muted
const _RESET = "\x1b[0m";

/** Inner content width (visible chars between the ║ decorations). */
const CW = 50;

/** Strip ANSI codes, return visible character count. */
function vw(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Right-pad ANSI-coloured string to exactly `w` visible chars. */
function pad(text: string, w: number): string {
  return text + " ".repeat(Math.max(0, w - vw(text)));
}

/**
 * Truncate an ANSI-coloured string so its visible width ≤ `w`.
 * Adds `…` (single char) at the truncation point.
 */
function trunc(text: string, w: number): string {
  if (vw(text) <= w) return text;
  let result = "";
  let vis = 0;
  let i = 0;
  while (i < text.length && vis < w - 1) {
    if (text[i] === "\x1b") {
      const end = text.indexOf("m", i);
      if (end === -1) break;
      result += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    result += text[i];
    vis++;
    i++;
  }
  return result + "…";
}

/**
 * Wrap content in the border frame: `  ║  content  ║`.
 */
function frame(content: string): string {
  return `  ${_DIM}║${_RESET}  ${content}  ${_DIM}║${_RESET}`;
}

/** ═ line segments. */
const _HBAR = "═".repeat(50);

/**
 * Print the SOBA AGENT ASCII art banner for first-time setup.
 *
 * Uses a 5-shade green gradient for a modern 3D brand look.
 * Each letter is 9 chars wide × 7 rows tall, all aligned to 50-char container.
 */
function printSetupBanner(): void {
  // ── Row colours (top → bottom gradient) ──
  const gc = [_GREEN_DEEP, _GREEN_DARK, _GREEN, _GREEN_BRIGHT, _GREEN_GLOW];

  // ── S (9 wide, 7 tall) ──
  const s: string[] = [
    "          ",
    " ▄▄▄▄▄▄▄▄ ",
    " ██▀▀▀▀▀▀▀ ",
    " ▀▀▀▀▄▄▄▄█ ",
    " ▄▄▄▄▄▄▄██ ",
    " ██▀▀▀▀▀▀▀ ",
    " ▀▀▀▀▀▀▀▀▀ ",
  ];
  // ── O (9 wide, 7 tall) ──
  const o: string[] = [
    "          ",
    " ▄▄▄▄▄▄▄▄ ",
    " ██▀▀▀▀▀▀█ ",
    " ██      ██",
    " ██      ██",
    " ██▄▄▄▄▄▄█ ",
    " ▀▀▀▀▀▀▀▀ ",
  ];
  // ── B (9 wide, 7 tall) ──
  const b: string[] = [
    "          ",
    " ▄▄▄▄▄▄▄▄ ",
    " ██▀▀▀▀▀▀█ ",
    " ██▄▄▄▄▄▄█ ",
    " ██▀▀▀▀▀▀█ ",
    " ██▄▄▄▄▄▄█ ",
    " ▀▀▀▀▀▀▀▀ ",
  ];
  // ── A (9 wide, 7 tall) ──
  const a: string[] = [
    "          ",
    "  ▄▄▄▄▄▄▄ ",
    "  ██▀▀▀▀▀█ ",
    " ██▄▄▄▄▄██",
    " ██▀▀▀▀▀██",
    " ██      ██",
    " ▀▀      ▀▀",
  ];

  // ── Build gradient-coloured rows ──
  const artRows: string[] = [];
  for (let i = 1; i < s.length; i++) {
    // Use gradient colours: map row index to gradient array
    const ci = Math.min(i, gc.length) - 1;
    const c = ci >= 0 ? gc[ci] : gc[gc.length - 1];
    const raw = `${c}${s[i]} ${o[i]} ${b[i]} ${a[i]}${_RESET}`;
    artRows.push(frame(pad(raw, CW)));
  }

  // ── Print banner ──
  console.log();
  console.log(`  ${_DIM}╔══${_RESET}${_GREEN}${_HBAR}${_RESET}${_DIM}══╗${_RESET}`);
  console.log(frame("".padEnd(CW)));
  for (const row of artRows) console.log(row);
  console.log(frame("".padEnd(CW)));

  // ── AGENT sub-title with diamonds ──
  const agentLine = `          ${_YELLOW}◆${_RESET} ${_CYAN}◈${_RESET} ${_YELLOW}◆${_RESET}${_DIM}  ${_RESET}${_BOLD}${_GREEN_GLOW}A${_RESET}${_BOLD}${_GREEN_BRIGHT}G${_RESET}${_BOLD}${_GREEN}E${_RESET}${_BOLD}${_GREEN_DARK}N${_RESET}${_BOLD}${_GREEN_DEEP}T${_RESET}${_DIM}  ${_RESET}${_YELLOW}◆${_RESET} ${_CYAN}◈${_RESET} ${_YELLOW}◆${_RESET}            `;
  console.log(frame(agentLine));

  // ── FIRST TIME SETUP label ──
  const setupLabel = `              ${_DIM}${_BOLD}F I R S T   T I M E   S E T U P${_RESET}              `;
  console.log(frame(pad(setupLabel, CW)));

  console.log(frame("".padEnd(CW)));
  console.log(`  ${_DIM}╚══${_RESET}${_GREEN}${_HBAR}${_RESET}${_DIM}══╝${_RESET}`);
  console.log();
}

/**
 * Print a nice completion panel after setup succeeds.
 */
function printSetupComplete(config: SobaConfig): void {
  const divider = `  ${_DIM}╠══${_RESET}${_GREEN}${_HBAR}${_RESET}${_DIM}══╣${_RESET}`;

  const modelLabel = `${_BOLD}${_GREEN}Model${_RESET}${_DIM}:${_RESET} ${config.model}`;
  const apiLabel = `${_BOLD}${_CYAN}API${_RESET}${_DIM}:${_RESET} ${config.baseUrl}`;
  const configLabel = `${_BOLD}${_YELLOW}Config${_RESET}${_DIM}:${_RESET} ${getConfigPath()}`;

  const setupMsg = `${_GREEN_BRIGHT}${_BOLD}✦  S E T U P   C O M P L E T E  ✦${_RESET}`;

  console.log();
  console.log(`  ${_DIM}╔══${_RESET}${_GREEN}${_HBAR}${_RESET}${_DIM}══╗${_RESET}`);
  console.log(frame(pad(setupMsg, CW)));
  console.log(divider);
  console.log(frame(pad(trunc(modelLabel, CW), CW)));
  console.log(frame(pad(trunc(apiLabel, CW), CW)));
  console.log(frame(pad(trunc(configLabel, CW), CW)));
  console.log(`  ${_DIM}╚══${_RESET}${_GREEN}${_HBAR}${_RESET}${_DIM}══╝${_RESET}`);
  console.log();
  console.log(`  ${_BOLD}${_GREEN_GLOW}SOBA AGENT${_RESET}${_DIM} is ready. Use ${_RESET}${_GREEN}soba${_RESET}${_DIM} to start coding.${_RESET} 🚀`);
  console.log();
}

/**
 * First-time setup: prompt user to pick a built-in provider, then
 * ask the upstream for its current model catalogue, then let the
 * user pick the model they want. The chosen model is persisted to
 * `registry.defaultProvider` and `registry.defaultModel`.
 *
 * B1e: the catalogue itself is **not** persisted anywhere. It's
 * discovered at runtime (B1d) and cached in memory. This keeps the
 * file small, matches what the TUI picker shows, and means a new
 * SOBA release doesn't have to ship with a stale vendor model list.
 */
export async function firstTimeSetup(
  existingConfig: SobaConfig,
  i18n: I18n,
): Promise<SobaConfig> {
  const readline = (await import("node:readline")).createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => readline.question(prompt, resolve));

  printSetupBanner();

  // Picker-style provider selection.
  console.log(`\n${_BOLD}${i18n.t("config.setup.chooseProvider")}${_RESET}\n`);
  BUILTIN_PROVIDERS.forEach((p, idx) => {
    console.log(
      `  ${_CYAN}${idx + 1}${_RESET}) ${_BOLD}${p.name}${_RESET}  ${_DIM}(${p.id})${_RESET}`,
    );
  });
  console.log(
    `  ${_CYAN}5${_RESET}) ${_BOLD}${i18n.t("config.setup.customOption")}${_RESET}  ${_DIM}(OpenAI-compatible URL)${_RESET}`,
  );

  let providerIdx = -1;
  while (providerIdx < 0) {
    const raw = await question(
      `\n${i18n.t("config.setup.chooseProviderPrompt", { max: BUILTIN_PROVIDERS.length + 1 })} `,
    );
    const n = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(n) && n >= 1 && n <= BUILTIN_PROVIDERS.length) {
      providerIdx = n - 1;
    } else if (n === BUILTIN_PROVIDERS.length + 1) {
      readline.close();
      return firstTimeSetupCustom(existingConfig, i18n);
    } else {
      console.log(
        `  ${_YELLOW}⚠${_RESET}  ${i18n.t("config.setup.invalidChoice")}`,
      );
    }
  }

  const provider: ProviderDefinition = BUILTIN_PROVIDERS[providerIdx]!;

  // Try reading the API key from the environment first. If the provider
  // expects an env var but it's not set, prompt the user to type the key.
  // This makes the wizard self-contained — no need to set up env vars
  // beforehand.
  let apiKey: string | null;
  if (provider.apiKeyEnv) {
    apiKey = process.env[provider.apiKeyEnv] ?? null;
    if (!apiKey) {
      apiKey =
        (
          await question(
            `\n${i18n.t("config.setup.apiKeyPrompt", { var: provider.apiKeyEnv, provider: provider.name })} `,
          )
        ).trim() || null;
    }
  } else {
    apiKey = null;
  }

  // Discover the live model catalogue. If discovery fails (no key,
  // network, parse), the user must type a model id manually.
  console.log(
    `\n🔍 ${i18n.t("config.setup.discoveringModels")} (${provider.name})`,
  );
  const discovery = await discoverModels(provider, apiKey);

  let available: ModelDefinition[];
  let suggestedDefault: string | null = null;
  if (discovery.ok) {
    available = toModelDefinitions(discovery, provider);
    suggestedDefault = discovery.suggestedDefault ?? null;
    const sourceTag =
      discovery.source === "upstream"
        ? ""
        : `  ${_DIM}(upstream empty)${_RESET}`;
    console.log(
      `${i18n.t("config.modelsFound", { count: available.length })}${sourceTag}\n`,
    );
  } else {
    available = [];
    console.log(
      `  ${_YELLOW}⚠${_RESET}  ${i18n.t("config.setup.discoveryFailed", { error: discovery.message })}`,
    );
    console.log(`\n${i18n.t("config.setup.typeModelIdManually")}\n`);
  }

  console.log(
    `${_BOLD}${i18n.t("config.setup.chooseModelFor", { provider: provider.name })}${_RESET}\n`,
  );
  const preview = available.slice(0, 20);
  preview.forEach((m, idx) => {
    const marker = m.id === suggestedDefault ? ` ${_GREEN}*${_RESET}` : "";
    const cw = m.contextWindow
      ? ` ${_DIM}(${formatContext(m.contextWindow)} ctx)${_RESET}`
      : "";
    console.log(
      `  ${_CYAN}${idx + 1}${_RESET}) ${_BOLD}${m.name}${_RESET}  ${_DIM}(${m.id})${_RESET}${cw}${marker}`,
    );
  });
  if (available.length > preview.length) {
    console.log(
      `  ${_DIM}${i18n.t("config.setup.moreModels", { count: available.length - preview.length })}${_RESET}`,
    );
  }

  let chosenId: string;
  while (true) {
    const raw = await question(
      `\n${i18n.t("config.setup.chooseModelPrompt", { default: suggestedDefault ?? "" })} `,
    );
    const trimmed = raw.trim();
    if (!trimmed) {
      chosenId = suggestedDefault ?? "";
      if (chosenId) break;
      console.log(
        `  ${_YELLOW}⚠${_RESET}  ${i18n.t("config.setup.invalidChoice")}`,
      );
      continue;
    }
    const n = Number.parseInt(trimmed, 10);
    if (Number.isFinite(n) && n >= 1 && n <= preview.length) {
      chosenId = preview[n - 1]!.id;
      break;
    }
    if (available.some((m) => m.id === trimmed)) {
      chosenId = trimmed;
      break;
    }
    // User typed a free-form id that's not in the discovered list —
    // accept it (the user knows their vendor's model ids better than
    // we do) and we'll create a minimal ModelDefinition for it.
    if (/^[\w.\-/]+$/.test(trimmed)) {
      chosenId = trimmed;
      break;
    }
    console.log(
      `  ${_YELLOW}⚠${_RESET}  ${i18n.t("config.setup.invalidChoice")}`,
    );
  }

  const chosenModel: ModelDefinition = available.find(
    (m) => m.id === chosenId,
  ) ?? {
    id: chosenId,
    name: chosenId,
    contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
    maxOutput: DEFAULT_SYNTHETIC_MAX_OUTPUT,
    supportsStreaming: true,
    supportsThinking: false,
  };

  // If the user didn't provide a key (empty input after prompt), remind
  // them about the environment variable as a fallback.
  if (provider.apiKeyEnv && !apiKey) {
    console.log(
      `\n${_YELLOW}⚠${_RESET}  ${i18n.t("config.setup.setEnvVar", { var: provider.apiKeyEnv })}`,
    );
  }

  readline.close();

  // Persist: setActive + selectModel (so future /model picks remember
  // the user's choice), then write to disk. If the provider has an
  // apiKeyEnv and we resolved a key, also persist it via setApiKey so
  // the key lives in registry.providers[id].apiKey (the canonical
  // location) — not just in env.
  const registry = new ProviderRegistry(undefined, {
    configPath: getConfigPath(),
  });
  registry.setActive(provider.id, chosenModel.id);
  registry.selectModel(provider.id, chosenModel);
  if (provider.apiKeyEnv && apiKey) {
    registry.setApiKey(provider.id, apiKey);
  }
  await registry.persistConfig();

  // The flat top-level `baseUrl` / `apiKey` / `model` fields are
  // legacy fallback paths. The registry is the canonical source of
  // truth — `registry.persistConfig()` above has already merged the
  // new `registry` block into the on-disk file, preserving any
  // user preferences (lang, theme, temperature, compaction, …)
  // that were already there. Writing the flat fields again would
  // only duplicate data and risk clobbering user edits with
  // `DEFAULT_CONFIG` values, so we skip the second save here.
  // The completion panel reads display values from local
  // variables, not from a re-saved config. The returned SobaConfig
  // is the in-memory view (with the new registry applied); it is
  // not re-saved to disk.
  const viewConfig: SobaConfig = {
    ...existingConfig,
    baseUrl: provider.baseUrl,
    apiKey: apiKey ?? "",
    model: chosenModel.id,
    registry: registry.snapshotState(),
  };
  printSetupComplete(viewConfig);
  return viewConfig;
}

/** Format context window like "128k" or "1M" for compact display. */
function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/**
 * Custom-endpoint branch of the first-time setup. Used when the user
 * picks '5' from the provider picker. Creates a custom provider in
 * the registry block instead of a flat top-level entry, with the
 * model list discovered live from `<baseUrl>/v1/models` (or
 * accepted as a free-form id when discovery fails).
 */
async function firstTimeSetupCustom(
  existingConfig: SobaConfig,
  i18n: I18n,
): Promise<SobaConfig> {
  const readline = (await import("node:readline")).createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => readline.question(prompt, resolve));

  // Fall back to DeepSeek as the default suggestion for the wizard,
  // since DEFAULT_CONFIG.baseUrl is now empty (resolved from registry).
  const defaultBaseUrl =
    existingConfig.baseUrl ||
    DEFAULT_CONFIG.baseUrl ||
    "https://api.deepseek.com";
  const baseUrl =
    (
      await question(i18n.t("config.setup.apiUrl", { default: defaultBaseUrl }))
    ).trim() || defaultBaseUrl;

  const apiKey = (await question(i18n.t("config.setup.apiKey"))).trim() || null;
  const apiKeyEnv = apiKey ? null : "CUSTOM_API_KEY";

  // Build a transient ProviderDefinition so we can reuse the same
  // discovery path as built-ins. Custom providers use id "custom"
  // and inherit the discovered models into `models` (which is
  // hard-coded for custom providers; see ProviderRegistry.addProvider).
  const transient: ProviderDefinition = {
    id: "custom",
    name: "Custom",
    baseUrl,
    apiKeyEnv,
    adapter: "openai",
  };

  console.log(`\n🔍 ${i18n.t("config.setup.discoveringModels")}`);
  const discovery = await discoverModels(transient, apiKey);
  let available: ModelDefinition[] = [];
  if (discovery.ok) {
    available = toModelDefinitions(discovery, transient);
    console.log(i18n.t("config.modelsFound", { count: available.length }));
    const preview = available.slice(0, 20);
    for (const m of preview) {
      console.log(`   ${_CYAN}•${_RESET} ${m.id}`);
    }
    if (available.length > preview.length) {
      console.log(
        `   ${_DIM}${i18n.t("config.setup.moreModels", { count: available.length - preview.length })}${_RESET}`,
      );
    }
  } else {
    console.log(
      `  ${_YELLOW}⚠${_RESET}  ${i18n.t("config.setup.discoveryFailed", { provider: "Custom", error: discovery.message })}`,
    );
    console.log(`\n${i18n.t("config.setup.typeModelIdManually")}\n`);
  }

  const raw = await question(
    `\n${i18n.t("config.setup.chooseModelPrompt", { default: existingConfig.model || "" })} `,
  );
  const chosenId = raw.trim() || existingConfig.model || "";

  const chosenModel: ModelDefinition = available.find(
    (m) => m.id === chosenId,
  ) ?? {
    id: chosenId,
    name: chosenId,
    contextWindow: existingConfig.contextWindow || 8192,
    maxOutput: existingConfig.maxOutputTokens || 4096,
    supportsStreaming: true,
    supportsThinking: false,
  };

  readline.close();

  const registry = new ProviderRegistry(undefined, {
    configPath: getConfigPath(),
  });
  registry.addProvider({
    id: "custom",
    name: "Custom",
    baseUrl,
    apiKeyEnv,
    adapter: "openai",
    defaultModel: chosenModel.id,
    custom: true,
    // Custom providers keep their full model list (no need for the
    // discoverable catalogue split — the user added it by hand and
    // it doesn't change as often as the vendor catalogue). The
    // definition is persisted verbatim by `persistConfig()`.
    models: available.length > 0 ? available : [chosenModel],
  });
  registry.setActive("custom", chosenModel.id);
  // Persist the API key in the registry so resolveApiKey() can find it
  // later — not just in the env var or the flat fallback field.
  if (apiKey) {
    registry.setApiKey("custom", apiKey);
  }
  await registry.persistConfig();

  // The flat top-level `baseUrl` / `apiKey` / `model` fields are
  // legacy fallback paths. The registry is the canonical source of
  // truth — `registry.persistConfig()` above has already merged the
  // new `registry` block into the on-disk file, preserving any
  // user preferences (lang, theme, temperature, compaction, …)
  // that were already there. Writing the flat fields again would
  // only duplicate data and risk clobbering user edits with
  // `DEFAULT_CONFIG` values, so we skip the second save here.
  // The returned SobaConfig is the in-memory view (with the new
  // registry applied); it is not re-saved to disk.
  const viewConfig: SobaConfig = {
    ...existingConfig,
    baseUrl,
    apiKey: apiKey ?? "",
    model: chosenModel.id,
    registry: registry.snapshotState(),
  };
  printSetupComplete(viewConfig);
  return viewConfig;
}

/**
 * Fetch the model catalogue from an OpenAI-compatible `/v1/models`
 * endpoint. Returns an empty array on any failure (network or
 * non-2xx) — used by the first-time setup wizard to seed the
 * provider's "available models" list (B1d).
 */
export interface AvailableModel {
  id: string;
  owned_by?: string;
  object?: string;
}

export async function fetchAvailableModels(
  baseUrl: string,
  apiKey: string,
  options: { signal?: AbortSignal } = {},
): Promise<AvailableModel[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers, signal: options.signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: AvailableModel[] };
    return Array.isArray(body.data) ? body.data : [];
  } catch {
    return [];
  }
}
