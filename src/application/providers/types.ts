/**
 * Provider registry types — Phase 2.5 A1.
 *
 * ProviderDefinition declares a vendor (OpenAI, Anthropic, ...) together with
 * the concrete models it exposes. Infrastructure adapters use these
 * application-level definitions to spin up clients for any given model.
 *
 * Design notes:
 * - Provider ids are stable, lowercase, kebab-friendly strings used as keys
 *   in config.json and in slash commands (`/model set openai/gpt-4o`).
 * - `apiKeyEnv` is the canonical env var to read when an API key is missing
 *   from the persisted config. Ollama uses no key.
 * - `adapter` selects the provider adapter. Today only "openai" is implemented
 *   in infrastructure; "anthropic" is reserved for future work and treated as
 *   unsupported at runtime (see ProviderRegistry.testConnection).
 * - Custom providers can be added/removed at runtime via addProvider/removeProvider.
 */

/** Adapter identifier — selects the provider adapter implementation. */
export type ProviderAdapterId = "openai" | "anthropic";

export const MODEL_COMPATIBILITY_FEATURES = [
  "adaptive_thinking",
  "reasoning_split",
  "reasoning_details_input",
  "prefer_max_completion_tokens",
] as const;

export type ModelCompatibilityFeature = (typeof MODEL_COMPATIBILITY_FEATURES)[number];

/**
 * A model exposed by a provider.
 */
export interface ModelDefinition {
  /** Vendor-specific model id used in API calls (e.g. "gpt-4o"). */
  id: string;
  /** Human-readable name shown in the model selector. */
  name: string;
  /** Total context window size in tokens. */
  contextWindow: number;
  /** Maximum output tokens per response. */
  maxOutput: number;
  /** Whether the provider supports streaming for this model. */
  supportsStreaming: boolean;
  /** Whether the provider exposes explicit thinking/reasoning control. */
  supportsThinking: boolean;
  /** Explicit wire-compatibility features; never inferred from vendor/model names. */
  compatibility?: ModelCompatibilityFeature[];
}

/**
 * A provider definition — vendor + endpoint + models.
 *
 * `models` is **optional**. When omitted (or empty), the provider's
 * catalogue is fetched on demand from `<baseUrl>/v1/models` (the standard
 * OpenAI-compatible listing endpoint). The first time a user picks this
 * provider, SOBA runs discovery and persists only the user-selected
 * model(s) into `registry.customProviders[].models` and
 * `registry.defaultModel`. Built-in providers don't carry a hard-coded
 * catalogue any more — the catalogue is the live one.
 */
export interface ProviderDefinition {
  /** Stable provider id, e.g. "openai", "anthropic", "ollama". */
  id: string;
  /** Human-readable name shown in the model selector. */
  name: string;
  /** OpenAI-compatible base URL (no trailing slash). */
  baseUrl: string;
  /** Environment variable holding the API key, or null for keyless providers. */
  apiKeyEnv: string | null;
  /** Adapter to instantiate for this provider. */
  adapter: ProviderAdapterId;
  /**
   * Models exposed by this provider. Optional — see interface doc.
   * When undefined, the registry will call `discoverModels()` on first
   * access and cache the result in memory (not on disk).
   */
  models?: ModelDefinition[];
  /**
   * Default model id. Optional — when empty, the user must pick a model
   * through discovery in the wizard or /model selector.
   */
  defaultModel?: string;
  /** True if this is a custom, user-added provider. */
  custom?: boolean;
}

/**
 * Result of a connection test for a given provider/model.
 */
export interface TestResult {
  ok: boolean;
  /** Latency in milliseconds (round-trip) when ok. */
  latencyMs?: number;
  /** Error message when !ok. */
  error?: string;
  /** HTTP status code when the failure is HTTP-related. */
  statusCode?: number;
}

/**
 * Persisted per-provider secret.
 * Stored in ~/.soba/config.json under `providers[providerId].apiKey`.
 */
export interface ProviderSecret {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Persisted provider config block (subset of ProviderDefinition that
 * is user-mutable: apiKey + optional baseUrl override).
 */
export type ProviderConfigMap = Record<string, ProviderSecret>;

/**
 * User-custom providers persisted across runs.
 * Keyed by provider id; values are full ProviderDefinitions with `custom: true`.
 */
export type CustomProviderMap = Record<string, ProviderDefinition>;

/**
 * Persisted registry state — written to ~/.soba/config.json under `registry`.
 *
 * B1e: model catalogues for built-in providers are no longer persisted.
 * They're discovered at runtime via `discoverModels()` (in-memory cache)
 * and never written to disk. The user's `defaultModel` is still recorded
 * so the active selection survives across runs.
 */
export interface ProviderRegistryState {
  defaultProvider: string;
  defaultModel: string;
  providers: ProviderConfigMap;
  customProviders: CustomProviderMap;
}
