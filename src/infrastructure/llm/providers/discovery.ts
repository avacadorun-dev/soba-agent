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
} from "./model-defaults";
import type { ModelDefinition, ProviderDefinition } from "./types";

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
  modelsPath: string; // e.g. "/v1/models"
}

const cache = new Map<string, DiscoveryOutcome>();

function cacheKeyOf(k: CacheKey): string {
  return `${k.baseUrl}::${k.apiKey ?? "<keyless>"}::${k.modelsPath}`;
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
  const key: CacheKey = { baseUrl, apiKey, modelsPath: "/models" };
  return cache.get(cacheKeyOf(key)) ?? null;
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
  providerId: string,
): ModelDefinition {
  const raw = m.raw ?? {};
  return {
    id: m.id,
    name: typeof raw.display_name === "string" ? raw.display_name : m.id,
    // The OpenAI `/v1/models` endpoint doesn't return context window;
    // default to 128k which covers the vast majority of 2025-era
    // models. Users can override per-model via the flat
    // `contextWindow` field in `~/.soba/config.json`.
    contextWindow:
      typeof raw.context_window === "number" ? raw.context_window : DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
    maxOutput:
      typeof raw.max_output_tokens === "number" ? raw.max_output_tokens : DEFAULT_SYNTHETIC_MAX_OUTPUT,
    supportsStreaming: true,
    supportsThinking:
      providerId === "deepseek" ||
      providerId === "kimi" ||
      // OpenRouter has a /v1/models endpoint that doesn't expose
      // reasoning, but most models behind it do — default to true so
      // the picker shows the "thinking" badge by default.
      providerId === "openrouter",
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
  options: { timeoutMs?: number; force?: boolean } = {},
): Promise<DiscoveryOutcome> {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const key: CacheKey = { baseUrl, apiKey, modelsPath: "/models" };
  const k = cacheKeyOf(key);
  if (!options.force) {
    const cached = cache.get(k);
    if (cached) return cached;
  }

  if (provider.adapter !== "openai") {
    // Discovery is OpenAI-compatible only. Anthropic / future adapters
    // will need their own listing endpoints.
    const out: DiscoveryOutcome = {
      ok: false,
      code: "network",
      message: `Discovery not implemented for adapter "${provider.adapter}". Use the seed default or add models manually.`,
    };
    cache.set(k, out);
    return out;
  }

  if (provider.apiKeyEnv && !apiKey) {
    const out: DiscoveryOutcome = {
      ok: false,
      code: "no-key",
      message: `${provider.name} requires an API key. Set ${provider.apiKeyEnv} in your environment.`,
    };
    cache.set(k, out);
    return out;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 8_000,
  );
  try {
    const url = `${baseUrl}/models`;
    const res = await fetch(url, {
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    });
    if (!res.ok) {
      const out: DiscoveryOutcome = {
        ok: false,
        code: "network",
        message: `${provider.name} returned ${res.status} ${res.statusText} for GET /models`,
        statusCode: res.status,
      };
      cache.set(k, out);
      return out;
    }
    const json: unknown = await res.json();
    if (!json || typeof json !== "object" || !("data" in json)) {
      const out: DiscoveryOutcome = {
        ok: false,
        code: "parse",
        message: `${provider.name} returned an unexpected /models payload (missing "data" field)`,
      };
      cache.set(k, out);
      return out;
    }
    const data = (json as { data: unknown }).data;
    if (!Array.isArray(data) || data.length === 0) {
      const out: DiscoveryOutcome = {
        ok: false,
        code: "empty",
        message: `${provider.name} returned no models from the /models endpoint.`,
      };
      cache.set(k, out);
      return out;
    }

    const models: DiscoveredModel[] = data
      .filter(
        (e): e is Record<string, unknown> => e != null && typeof e === "object",
      )
      .map((e) => ({
        id: typeof e.id === "string" ? e.id : String(e.id ?? ""),
        object: typeof e.object === "string" ? e.object : undefined,
        raw: e,
      }))
      .filter((m) => m.id);

    // Vendor-specific preference order: prefer chat / coder / instruct
    // variants when picking a default. The user's choice is still
    // authoritative — this is only what the wizard highlights.
    const suggest = pickSuggestedDefault(models, provider.id);

    const out: DiscoveryOutcome = {
      ok: true,
      models,
      suggestedDefault: suggest ?? models[0]?.id ?? null,
      source: "upstream",
    };
    cache.set(k, out);
    return out;
  } catch (err) {
    const out: DiscoveryOutcome = {
      ok: false,
      code: "network",
      message:
        err instanceof Error
          ? err.message
          : "Unknown error during model discovery",
    };
    cache.set(k, out);
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
  return result.models.map((m) => toModelDefinition(m, provider.id));
}

export function isLikelyChatModelId(modelId: string): boolean {
  const id = modelId.toLowerCase();
  const blockedFragments = [
    "audio",
    "clip",
    "content-safety",
    "dall-e",
    "diffusion",
    "embed",
    "embedding",
    "guard",
    "imagen",
    "image",
    "moderation",
    "rerank",
    "sora",
    "speech",
    "stable-diffusion",
    "transcribe",
    "tts",
    "vision-embed",
    "whisper",
  ];
  return !blockedFragments.some((fragment) => id.includes(fragment));
}

/**
 * Pick the most "useful" default from a list of model ids. Pure
 * function so it's easy to unit-test. The heuristic favours coding /
 * chat / instruct variants over embedding / audio / image / preview
 * (preview is allowed as a last resort, e.g. qwen3-max-preview).
 */
export function pickSuggestedDefault(
  models: DiscoveredModel[],
  _providerId: string,
): string | null {
  if (models.length === 0) return null;

  const chatModels = models.filter((model) => isLikelyChatModelId(model.id));
  const candidates = chatModels.length > 0 ? chatModels : models;
  const candidateIds = candidates.map((m) => m.id.toLowerCase());

  // Generic preferences (any provider): chat > coder > instruct > first chat-like model.
  const genericOrder = ["chat", "coder", "code", "instruct", "it"];
  for (const tag of genericOrder) {
    const hit = candidateIds.findIndex((id) => id.includes(tag));
    if (hit >= 0) return candidates[hit]?.id ?? null;
  }
  return candidates[0]?.id ?? null;
}
