/**
 * Provider model discovery — Phase 2.5 B1d.
 *
 * Built-in providers don't carry a hard-coded model catalogue any
 * more (it was always drifting out of date — DeepSeek rotates ids,
 * OpenRouter adds new ones weekly, Moonshot launched Kimi K2, etc).
 * Instead, we ask the provider for its current list through the
 * OpenAI-compatible `GET /v1/models` endpoint and cache the
 * result in memory keyed by (providerId, apiKey, baseUrl).
 *
 * The cache is deliberately in-memory only: the persisted
 * `registry.defaultModel` is the only thing written to disk for
 * the active selection (B1e: `selectedModels` is gone). Discovery
 * just populates the picker.
 */

import {
  DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
  DEFAULT_SYNTHETIC_MAX_OUTPUT,
} from "../../../application/providers/model-defaults";
import {
  type ConfiguredModelDefinition,
  MODEL_COMPATIBILITY_FEATURES,
  type ModelCompatibilityFeature,
  type ModelDefinition,
  type ModelLimitScope,
  type ModelLimitSource,
  type ModelLimitValue,
  type ModelMetadataProfile,
  type ProviderDefinition,
} from "../../../application/providers/types";
import {
  isReasoningEffort,
  isReasoningTransport,
  REASONING_EFFORTS,
  type ReasoningCapabilities,
  type ReasoningEffort,
  type ReasoningTransport,
} from "../../../kernel/model/reasoning";

/** A single entry returned by `GET /v1/models`. */
export interface DiscoveredModel {
  id: string;
  /** When the vendor fills in `object` we treat "model" as the type marker. */
  object?: string;
  /** Free-form metadata; we keep the whole object so future code can
   *  surface context_window / max_output / pricing without a second
   *  round trip. */
  raw?: Record<string, unknown>;
}

/** Successful discovery response. */
export interface DiscoveryResult {
  ok: true;
  models: DiscoveredModel[];
  /** The default id the user would most likely want — first by vendor
   *  preference order, falling back to the first list entry. */
  suggestedDefault: string | null;
  source: "upstream" | "empty";
  /** Last-known-good data returned after a refresh failure. */
  stale?: boolean;
}

/** Failure modes. */
export type DiscoveryError =
  | { ok: false; code: "no-key"; message: string }
  | { ok: false; code: "network"; message: string; statusCode?: number }
  | { ok: false; code: "parse"; message: string }
  | { ok: false; code: "empty"; message: string };

export type DiscoveryOutcome = DiscoveryResult | DiscoveryError;

interface CacheKey {
  baseUrl: string;
  apiKey: string | null;
  profile: ModelMetadataProfile;
}

interface CacheEntry {
  outcome: DiscoveryOutcome;
  fetchedAt: number;
}

const DISCOVERY_TTL_MS = 15 * 60 * 1_000;
const FAILED_DISCOVERY_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

function cacheKeyOf(k: CacheKey): string {
  return `${k.baseUrl}::${k.apiKey ?? "<keyless>"}::${k.profile}`;
}

export function resolveMetadataProfile(provider: ProviderDefinition): ModelMetadataProfile {
  return provider.metadataProfile ?? (provider.custom ? "auto" : "generic_openai");
}

/**
 * Return the in-memory cached discovery result for the given
 * provider/credentials, or `null` if discovery hasn't run yet
 * (or returned a failure). Does NOT trigger a network call.
 *
 * Used by `ProviderRegistry.getModelsFor()` for built-in providers:
 * the catalogue is always live (in-memory cache), never persisted.
 */
export function getCachedModels(
  provider: ProviderDefinition,
  apiKey: string | null,
): DiscoveryOutcome | null {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const key: CacheKey = { baseUrl, apiKey, profile: resolveMetadataProfile(provider) };
  return cache.get(cacheKeyOf(key))?.outcome ?? null;
}


/**
 * Build a sensible `ModelDefinition` from a `DiscoveredModel` entry.
 * The upstream doesn't return context window or max output, so we
 * pick conservative defaults that match the proactive-compaction
 * trigger policy. Users can override these by editing
 * `~/.soba/config.json` directly.
 */
function toModelDefinition(
  m: DiscoveredModel,
  provider: ProviderDefinition,
  stale = false,
): ModelDefinition {
  const raw = m.raw ?? {};
  const topProvider = isRecord(raw.top_provider) ? raw.top_provider : undefined;
  const metadataProfile = resolveMetadataProfile(provider);
  const runtimeContextWindow =
    readPositiveInteger(raw.soba_runtime_context_length) ??
    (metadataProfile === "vllm" ? readPositiveInteger(raw.max_model_len) : undefined);
  const modelContextWindow =
    readPositiveInteger(raw.context_window) ??
    readPositiveInteger(raw.context_length) ??
    (metadataProfile === "vllm" ? undefined : readPositiveInteger(raw.max_model_len)) ??
    readPositiveInteger(raw.max_context_length);
  const routeContextWindow = readPositiveInteger(topProvider?.context_length);
  const contextWindow =
    runtimeContextWindow ??
    (modelContextWindow !== undefined && routeContextWindow !== undefined
      ? Math.min(modelContextWindow, routeContextWindow)
      : routeContextWindow ?? modelContextWindow) ??
    DEFAULT_SYNTHETIC_CONTEXT_WINDOW;
  const contextLimit = limitValue(
    contextWindow,
    runtimeContextWindow !== undefined
      ? "provider_runtime"
      : routeContextWindow !== undefined
        ? "provider_route"
        : modelContextWindow !== undefined
          ? "provider_model"
          : "fallback",
    runtimeContextWindow !== undefined
      ? "runtime"
      : routeContextWindow !== undefined
        ? "route"
        : modelContextWindow !== undefined
          ? "model"
          : "assumed",
    stale,
  );
  const declaredMaxOutput =
    readPositiveInteger(raw.max_output_tokens) ??
    readPositiveInteger(raw.max_completion_tokens) ??
    readPositiveInteger(topProvider?.max_completion_tokens);
  const maxOutput = declaredMaxOutput ?? DEFAULT_SYNTHETIC_MAX_OUTPUT;
  const maxOutputLimit = limitValue(
    maxOutput,
    declaredMaxOutput === undefined
      ? "fallback"
      : readPositiveInteger(topProvider?.max_completion_tokens) !== undefined
        ? "provider_route"
        : "provider_model",
    declaredMaxOutput === undefined
      ? "assumed"
      : readPositiveInteger(topProvider?.max_completion_tokens) !== undefined
        ? "route"
        : "model",
    stale,
  );
  const compatibility = readCompatibility(raw);
  const reasoning =
    readReasoningCapabilities(raw) ??
    provider.reasoningProfiles?.[m.id] ??
    provider.reasoning;
  const reasoningTransport = readReasoningTransport(raw) ?? provider.reasoningTransport;
  return {
    id: m.id,
    name:
      typeof raw.display_name === "string"
        ? raw.display_name
        : typeof raw.name === "string"
          ? raw.name
          : m.id,
    contextWindow,
    maxOutput,
    supportsStreaming: readCapability(raw, "streaming") ?? true,
    supportsThinking:
      reasoning !== undefined && reasoning.control !== "none"
        ? true
        : readCapability(raw, "thinking") ?? readCapability(raw, "reasoning") ?? false,
    ...(reasoning ? { reasoning: structuredClone(reasoning) } : {}),
    ...(reasoningTransport ? { reasoningTransport } : {}),
    ...(compatibility.length > 0 ? { compatibility } : {}),
    limits: {
      contextWindow: contextLimit,
      maxOutput: maxOutputLimit,
      ...(modelContextWindow !== undefined ? { modelContextWindow } : {}),
      ...(routeContextWindow !== undefined ? { routeContextWindow } : {}),
    },
  };
}

/**
 * Ask the provider for its current model catalogue.
 *
 * @param provider         The provider to discover (must have `baseUrl`).
 * @param apiKey           Resolved API key (may be null for keyless providers).
 * @param options.timeoutMs    Per-request timeout. Default 8s.
 * @param options.force        Bypass the in-memory cache.
 */
export async function discoverModels(
  provider: ProviderDefinition,
  apiKey: string | null,
  options: { timeoutMs?: number; force?: boolean; fetch?: typeof fetch } = {},
): Promise<DiscoveryOutcome> {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const profile = resolveMetadataProfile(provider);
  const key: CacheKey = { baseUrl, apiKey, profile };
  const k = cacheKeyOf(key);
  const previous = cache.get(k);
  if (!options.force) {
    if (previous) {
      const ttl = previous.outcome.ok && !previous.outcome.stale
        ? DISCOVERY_TTL_MS
        : FAILED_DISCOVERY_TTL_MS;
      if (Date.now() - previous.fetchedAt < ttl) return previous.outcome;
    }
  }

  if (provider.adapter !== "openai" && provider.adapter !== "openai-responses") {
    // Discovery is OpenAI-compatible only. Anthropic / future adapters
    // will need their own listing endpoints.
    const out: DiscoveryOutcome = {
      ok: false,
      code: "network",
      message: `Discovery not implemented for adapter "${provider.adapter}". Use the seed default or add models manually.`,
    };
    cache.set(k, { outcome: out, fetchedAt: Date.now() });
    return out;
  }

  if (provider.apiKeyEnv && !apiKey) {
    const out: DiscoveryOutcome = {
      ok: false,
      code: "no-key",
      message: `${provider.name} requires an API key. Set ${provider.apiKeyEnv} in your environment.`,
    };
    cache.set(k, { outcome: out, fetchedAt: Date.now() });
    return out;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 8_000,
  );
  try {
    const out = await discoverWithProfile(
      provider,
      apiKey,
      profile,
      controller.signal,
      options.fetch ?? fetch,
    );
    if (!out.ok && previous?.outcome.ok) {
      const stale: DiscoveryResult = { ...previous.outcome, stale: true };
      cache.set(k, { outcome: stale, fetchedAt: Date.now() });
      return stale;
    }
    cache.set(k, { outcome: out, fetchedAt: Date.now() });
    return out;
  } catch (err) {
    if (previous?.outcome.ok) {
      const stale: DiscoveryResult = { ...previous.outcome, stale: true };
      cache.set(k, { outcome: stale, fetchedAt: Date.now() });
      return stale;
    }
    const out: DiscoveryOutcome = {
      ok: false,
      code: "network",
      message:
        err instanceof Error
          ? err.message
          : "Unknown error during model discovery",
    };
    cache.set(k, { outcome: out, fetchedAt: Date.now() });
    return out;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convert a successful discovery result to ModelDefinitions.
 * Use this when you want to surface the discovered catalogue to the
 * picker. We never persist the full list — only the user-selected
 * model makes it to `~/.soba/config.json`.
 */
export function toModelDefinitions(
  result: DiscoveryResult,
  provider: ProviderDefinition,
): ModelDefinition[] {
  return result.models.map((m) => toModelDefinition(m, provider, result.stale === true));
}

/** Merge live discovery with user-authored model entries, field by field. */
export function resolveModelsForProvider(
  provider: ProviderDefinition,
  discovered: ModelDefinition[] = [],
): ModelDefinition[] {
  const configured = provider.models ?? [];
  if (configured.length === 0) return discovered;
  const configuredIds = new Set(configured.map((model) => model.id));
  return [
    ...configured.map((model) => resolveConfiguredModel(provider, model, discovered.find((item) => item.id === model.id))),
    ...discovered.filter((model) => !configuredIds.has(model.id)),
  ];
}

function resolveConfiguredModel(
  provider: ProviderDefinition,
  configured: ConfiguredModelDefinition,
  discovered?: ModelDefinition,
): ModelDefinition {
  const configuredContext = readPositiveInteger(configured.contextWindow);
  const configuredOutput = readPositiveInteger(configured.maxOutput);
  const contextWindow = configuredContext ?? discovered?.contextWindow ?? DEFAULT_SYNTHETIC_CONTEXT_WINDOW;
  const maxOutput = configuredOutput ?? discovered?.maxOutput ?? DEFAULT_SYNTHETIC_MAX_OUTPUT;
  const providerReasoning = provider.reasoningProfiles?.[configured.id] ?? provider.reasoning;
  return {
    id: configured.id,
    name: configured.name ?? discovered?.name ?? configured.id,
    contextWindow,
    maxOutput,
    supportsStreaming: configured.supportsStreaming ?? discovered?.supportsStreaming ?? true,
    supportsThinking: configured.supportsThinking ?? discovered?.supportsThinking ?? false,
    reasoning: configured.reasoning ?? discovered?.reasoning ?? providerReasoning,
    reasoningTransport: configured.reasoningTransport ?? discovered?.reasoningTransport ?? provider.reasoningTransport,
    compatibility: configured.compatibility ?? discovered?.compatibility,
    limits: {
      contextWindow: configuredContext !== undefined
        ? limitValue(configuredContext, "user_config", "runtime")
        : discovered?.limits?.contextWindow ?? limitValue(contextWindow, "fallback", "assumed"),
      maxOutput: configuredOutput !== undefined
        ? limitValue(configuredOutput, "user_config", "runtime")
        : discovered?.limits?.maxOutput ?? limitValue(maxOutput, "fallback", "assumed"),
      ...(discovered?.limits?.modelContextWindow !== undefined
        ? { modelContextWindow: discovered.limits.modelContextWindow }
        : {}),
      ...(discovered?.limits?.routeContextWindow !== undefined
        ? { routeContextWindow: discovered.limits.routeContextWindow }
        : {}),
    },
  };
}

function limitValue(
  value: number,
  source: ModelLimitSource,
  scope: ModelLimitScope,
  stale = false,
): ModelLimitValue {
  return { value, source, scope, ...(stale ? { stale: true } : {}) };
}

async function discoverWithProfile(
  provider: ProviderDefinition,
  apiKey: string | null,
  profile: ModelMetadataProfile,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<DiscoveryOutcome> {
  switch (profile) {
    case "none":
      return { ok: false, code: "empty", message: `${provider.name} metadata discovery is disabled.` };
    case "openrouter": {
      const personalized = await discoverOpenAIList(provider, apiKey, "/models/user", signal, fetchImpl);
      if (personalized.ok) return personalized;
      return discoverOpenAIList(provider, apiKey, "/models", signal, fetchImpl);
    }
    case "ollama":
      return discoverOllama(provider, apiKey, signal, fetchImpl);
    case "lmstudio":
      return discoverLmStudio(provider, apiKey, signal, fetchImpl);
    case "llamacpp":
      return discoverLlamaCpp(provider, apiKey, signal, fetchImpl);
    case "vllm":
    case "generic_openai":
      return discoverOpenAIList(provider, apiKey, "/models", signal, fetchImpl);
    case "auto":
      return discoverAuto(provider, apiKey, signal, fetchImpl);
  }
}

async function discoverAuto(
  provider: ProviderDefinition,
  apiKey: string | null,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<DiscoveryOutcome> {
  const generic = await discoverOpenAIList(provider, apiKey, "/models", signal, fetchImpl);
  if (
    generic.ok &&
    generic.models.some((model) => hasDeclaredLimit(model.raw ?? {}))
  ) {
    return generic;
  }
  if (!isPrivateOrLoopback(provider.baseUrl)) return generic;

  const origin = providerOrigin(provider.baseUrl);
  const version = await fetchJson(`${origin}/api/version`, apiKey, signal, {}, fetchImpl);
  if (version.ok && isRecord(version.value) && typeof version.value.version === "string") {
    const ollama = await discoverOllama(provider, apiKey, signal, fetchImpl);
    if (ollama.ok) return ollama;
  }

  const lmStudio = await discoverLmStudio(provider, apiKey, signal, fetchImpl);
  if (lmStudio.ok) return lmStudio;

  const llamaCpp = await discoverLlamaCpp(
    provider,
    apiKey,
    signal,
    fetchImpl,
    generic.ok ? generic : undefined,
  );
  if (llamaCpp.ok) return llamaCpp;
  return generic;
}

async function discoverOpenAIList(
  provider: ProviderDefinition,
  apiKey: string | null,
  path: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<DiscoveryOutcome> {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const response = await fetchJson(`${baseUrl}${path}`, apiKey, signal, {}, fetchImpl);
  if (!response.ok) {
    return {
      ok: false,
      code: "network",
      message: `${provider.name} returned ${response.status} ${response.statusText} for GET ${path}`,
      statusCode: response.status,
    };
  }
  if (!isRecord(response.value) || !Array.isArray(response.value.data)) {
    return {
      ok: false,
      code: "parse",
      message: `${provider.name} returned an unexpected ${path} payload (missing "data" array)`,
    };
  }
  const models = response.value.data
    .filter(isRecord)
    .map((entry): DiscoveredModel => ({
      id: typeof entry.id === "string" ? entry.id : String(entry.id ?? ""),
      object: typeof entry.object === "string" ? entry.object : undefined,
      raw: entry,
    }))
    .filter((model) => model.id.length > 0);
  return discoveryResult(provider, models, path);
}

async function discoverOllama(
  provider: ProviderDefinition,
  apiKey: string | null,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<DiscoveryOutcome> {
  const origin = providerOrigin(provider.baseUrl);
  const [tags, running] = await Promise.all([
    fetchJson(`${origin}/api/tags`, apiKey, signal, {}, fetchImpl),
    fetchJson(`${origin}/api/ps`, apiKey, signal, {}, fetchImpl),
  ]);
  if (!tags.ok || !isRecord(tags.value) || !Array.isArray(tags.value.models)) {
    return { ok: false, code: "parse", message: `${provider.name} did not return an Ollama /api/tags payload.` };
  }
  const runningModels = running.ok && isRecord(running.value) && Array.isArray(running.value.models)
    ? running.value.models.filter(isRecord)
    : [];
  const models: DiscoveredModel[] = [];
  for (const entry of tags.value.models.filter(isRecord).slice(0, 100)) {
    const id = typeof entry.model === "string" ? entry.model : typeof entry.name === "string" ? entry.name : "";
    if (!id) continue;
    const active = runningModels.find((item) => item.model === id || item.name === id);
    const detail = await fetchJson(`${origin}/api/show`, apiKey, signal, {
      method: "POST",
      body: JSON.stringify({ model: id, verbose: false }),
    }, fetchImpl);
    const detailValue = detail.ok && isRecord(detail.value) ? detail.value : undefined;
    const modelInfo = detailValue && isRecord(detailValue.model_info) ? detailValue.model_info : undefined;
    const modelContext = modelInfo
      ? Object.entries(modelInfo).find(([key, value]) => key.endsWith(".context_length") && readPositiveInteger(value) !== undefined)?.[1]
      : undefined;
    const configuredContext = readNumCtx(detailValue?.parameters);
    const raw: Record<string, unknown> = {
      ...entry,
      display_name: id,
      context_length: configuredContext ?? readPositiveInteger(modelContext),
      soba_runtime_context_length: readPositiveInteger(active?.context_length),
      capabilities: detailValue?.capabilities,
      ...(hasStringCapability(detailValue?.capabilities, "thinking")
        ? { soba_reasoning: { transport: "ollama" } }
        : {}),
    };
    models.push({ id, object: "model", raw });
  }
  return discoveryResult(provider, models, "/api/tags");
}

async function discoverLmStudio(
  provider: ProviderDefinition,
  apiKey: string | null,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<DiscoveryOutcome> {
  const response = await fetchJson(
    `${providerOrigin(provider.baseUrl)}/api/v1/models`,
    apiKey,
    signal,
    {},
    fetchImpl,
  );
  if (!response.ok || !isRecord(response.value) || !Array.isArray(response.value.models)) {
    return { ok: false, code: "parse", message: `${provider.name} did not return an LM Studio /api/v1/models payload.` };
  }
  const models = response.value.models
    .filter(isRecord)
    .filter((entry) => entry.type === undefined || entry.type === "llm")
    .map((entry): DiscoveredModel => {
      const id = typeof entry.key === "string" ? entry.key : typeof entry.id === "string" ? entry.id : "";
      const instances = Array.isArray(entry.loaded_instances) ? entry.loaded_instances.filter(isRecord) : [];
      const loaded = instances.find((instance) => instance.id === id) ?? instances[0];
      const loadedConfig = loaded && isRecord(loaded.config) ? loaded.config : undefined;
      return {
        id,
        object: "model",
        raw: {
          ...entry,
          display_name: typeof entry.display_name === "string" ? entry.display_name : id,
          context_length: readPositiveInteger(entry.max_context_length),
          soba_runtime_context_length: readPositiveInteger(loadedConfig?.context_length),
        },
      };
    })
    .filter((model) => model.id.length > 0);
  return discoveryResult(provider, models, "/api/v1/models");
}

async function discoverLlamaCpp(
  provider: ProviderDefinition,
  apiKey: string | null,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
  genericResult?: DiscoveryResult,
): Promise<DiscoveryOutcome> {
  const props = await fetchJson(
    `${providerOrigin(provider.baseUrl)}/props`,
    apiKey,
    signal,
    {},
    fetchImpl,
  );
  if (!props.ok || !isRecord(props.value)) {
    return { ok: false, code: "parse", message: `${provider.name} did not return a llama.cpp /props payload.` };
  }
  const settings = isRecord(props.value.default_generation_settings)
    ? props.value.default_generation_settings
    : undefined;
  const contextWindow = readPositiveInteger(settings?.n_ctx);
  if (contextWindow === undefined) {
    return { ok: false, code: "parse", message: `${provider.name} /props did not declare n_ctx.` };
  }
  const generic = genericResult ?? await discoverOpenAIList(
    provider,
    apiKey,
    "/models",
    signal,
    fetchImpl,
  );
  const models = generic.ok && generic.models.length > 0
    ? generic.models.map((model) => ({
      ...model,
      raw: { ...(model.raw ?? {}), soba_runtime_context_length: contextWindow },
    }))
    : provider.defaultModel
      ? [{ id: provider.defaultModel, object: "model", raw: { soba_runtime_context_length: contextWindow } }]
      : [];
  return discoveryResult(provider, models, "/props");
}

function discoveryResult(
  provider: ProviderDefinition,
  models: DiscoveredModel[],
  path: string,
): DiscoveryOutcome {
  if (models.length === 0) {
    return { ok: false, code: "empty", message: `${provider.name} returned no models from ${path}.` };
  }
  return {
    ok: true,
    models,
    suggestedDefault: pickSuggestedDefault(models) ?? models[0]?.id ?? null,
    source: "upstream",
  };
}

interface JsonFetchSuccess { ok: true; value: unknown }
interface JsonFetchFailure { ok: false; status: number; statusText: string }

async function fetchJson(
  url: string,
  apiKey: string | null,
  signal: AbortSignal,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<JsonFetchSuccess | JsonFetchFailure> {
  try {
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      signal,
    });
    if (!response.ok) return { ok: false, status: response.status, statusText: response.statusText };
    return { ok: true, value: await response.json() };
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, status: 0, statusText: error instanceof Error ? error.message : String(error) };
  }
}

function providerOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl.replace(/\/+$/, "").replace(/\/(?:api\/)?v1$/, "");
  }
}

function isPrivateOrLoopback(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === "localhost" || host === "::1" || host === "[::1]") return true;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
    const match = /^172\.(\d+)\./.exec(host);
    return match ? Number(match[1]) >= 16 && Number(match[1]) <= 31 : false;
  } catch {
    return false;
  }
}

function hasDeclaredLimit(raw: Record<string, unknown>): boolean {
  const topProvider = isRecord(raw.top_provider) ? raw.top_provider : undefined;
  return [
    raw.context_window,
    raw.context_length,
    raw.max_model_len,
    raw.max_context_length,
    raw.max_output_tokens,
    raw.max_completion_tokens,
    topProvider?.context_length,
    topProvider?.max_completion_tokens,
  ].some((value) => readPositiveInteger(value) !== undefined);
}

function readNumCtx(parameters: unknown): number | undefined {
  if (typeof parameters !== "string") return undefined;
  const match = /(?:^|\s)num_ctx\s+(\d+)(?:\s|$)/m.exec(parameters);
  return match ? readPositiveInteger(Number(match[1])) : undefined;
}

export function supportsTextGeneration(model: DiscoveredModel): boolean {
  const raw = model.raw;
  if (!raw) return true;
  const architecture = isRecord(raw.architecture) ? raw.architecture : undefined;
  const declared = raw.output_modalities ?? raw.outputModalities ?? architecture?.output_modalities;
  if (Array.isArray(declared)) {
    return declared.some((value) => typeof value === "string" && value.toLowerCase() === "text");
  }
  if (typeof declared === "string") {
    return declared.toLowerCase().split(/[^a-z]+/).includes("text");
  }
  return true;
}

/**
 * Pick the first upstream model that declares text output. Upstream order and
 * explicit provider defaults remain authoritative; names are not interpreted.
 */
export function pickSuggestedDefault(
  models: DiscoveredModel[],
): string | null {
  if (models.length === 0) return null;

  const textModels = models.filter(supportsTextGeneration);
  const candidates = textModels.length > 0 ? textModels : models;
  return candidates[0]?.id ?? null;
}

function readCapability(raw: Record<string, unknown>, capability: string): boolean | undefined {
  for (const container of [raw, isRecord(raw.capabilities) ? raw.capabilities : undefined]) {
    if (!container) continue;
    for (const key of [`supports_${capability}`, `supports${capitalize(capability)}`, capability]) {
      if (typeof container[key] === "boolean") return container[key];
    }
  }
  return undefined;
}

function readCompatibility(raw: Record<string, unknown>): ModelCompatibilityFeature[] {
  const declared = raw.soba_compatibility ?? raw.compatibility;
  if (!Array.isArray(declared)) return [];
  return declared.filter((value): value is ModelCompatibilityFeature =>
    typeof value === "string" && MODEL_COMPATIBILITY_FEATURES.includes(value as ModelCompatibilityFeature)
  );
}

function readReasoningCapabilities(raw: Record<string, unknown>): ReasoningCapabilities | undefined {
  if (hasStringCapability(raw.capabilities, "thinking")) {
    return { control: "toggle" };
  }
  const capabilities = isRecord(raw.capabilities) ? raw.capabilities : undefined;
  const declared = isRecord(raw.reasoning)
    ? raw.reasoning
    : capabilities && isRecord(capabilities.reasoning)
      ? capabilities.reasoning
      : undefined;
  if (!declared) return undefined;

  const declaredEfforts = Object.hasOwn(declared, "supported_efforts")
    ? declared.supported_efforts
    : declared.supportedEfforts;
  const supportedEfforts = declaredEfforts === null
    ? [...REASONING_EFFORTS]
    : readEfforts(declaredEfforts);
  const defaultEffort = isReasoningEffort(declared.default_effort)
    ? declared.default_effort
    : isReasoningEffort(declared.defaultEffort)
      ? declared.defaultEffort
      : undefined;
  const supportsBudget = readBoolean(declared.supports_max_tokens ?? declared.supportsMaxTokens);
  const mandatory = readBoolean(declared.mandatory);
  const defaultEnabled = readBoolean(declared.default_enabled ?? declared.defaultEnabled);
  const minBudgetTokens = readPositiveInteger(declared.min_tokens ?? declared.minTokens);
  const maxBudgetTokens = readPositiveInteger(declared.max_tokens ?? declared.maxTokens);

  if (supportedEfforts.length > 0) {
    return {
      control: "effort",
      supportedEfforts,
      ...(defaultEffort ? { defaultEffort } : {}),
      ...(defaultEnabled !== undefined ? { defaultEnabled } : {}),
      ...(mandatory !== undefined ? { mandatory } : {}),
      ...(supportsBudget !== undefined ? { supportsBudget } : {}),
      ...(mandatory !== true ? { supportsToggle: true } : {}),
      ...(minBudgetTokens !== undefined ? { minBudgetTokens } : {}),
      ...(maxBudgetTokens !== undefined ? { maxBudgetTokens } : {}),
    };
  }
  if (supportsBudget) {
    return {
      control: "budget",
      supportsBudget: true,
      supportsToggle: mandatory !== true,
      ...(defaultEnabled !== undefined ? { defaultEnabled } : {}),
      ...(mandatory !== undefined ? { mandatory } : {}),
      ...(minBudgetTokens !== undefined ? { minBudgetTokens } : {}),
      ...(maxBudgetTokens !== undefined ? { maxBudgetTokens } : {}),
    };
  }
  if (mandatory === true) {
    return { control: "fixed", mandatory: true, ...(defaultEnabled !== undefined ? { defaultEnabled } : {}) };
  }
  if (defaultEnabled !== undefined) {
    return { control: "toggle", defaultEnabled };
  }
  if (supportsReasoningParameter(raw)) {
    return {
      control: "toggle",
      ...(mandatory !== undefined ? { mandatory } : {}),
    };
  }
  return undefined;
}

function hasStringCapability(value: unknown, capability: string): boolean {
  return Array.isArray(value) && value.some(
    (item) => typeof item === "string" && item.toLowerCase() === capability,
  );
}

function supportsReasoningParameter(raw: Record<string, unknown>): boolean {
  return Array.isArray(raw.supported_parameters) && raw.supported_parameters.includes("reasoning");
}

function readReasoningTransport(raw: Record<string, unknown>): ReasoningTransport | undefined {
  const soba = isRecord(raw.soba_reasoning) ? raw.soba_reasoning : undefined;
  const reasoning = isRecord(raw.reasoning) ? raw.reasoning : undefined;
  const value = soba?.transport ?? reasoning?.transport;
  return isReasoningTransport(value) ? value : undefined;
}

function readEfforts(value: unknown): ReasoningEffort[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isReasoningEffort);
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
