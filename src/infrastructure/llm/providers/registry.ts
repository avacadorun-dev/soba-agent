/**
 * ProviderRegistry — Phase 2.5 A1.
 *
 * Owns the list of available providers, persists user-overrides (API keys,
 * baseUrl, custom providers, active selection) to ~/.soba/config.json,
 * and instantiates OpenResponsesClient objects on demand.
 *
 * Persistence layout (lives under `registry` in config.json):
 *   {
 *     "defaultProvider": "openai",
 *     "defaultModel": "gpt-4o",
 *     "providers": {
 *       "openai": { "apiKey": "...", "baseUrl": "https://api.openai.com/v1" },
 *       ...
 *     },
 *     "customProviders": { "my-llm": { ...ProviderDefinition, "custom": true } }
 *   }
 *
 * The registry is a pure in-memory facade over this state. Call persistConfig()
 * to flush changes to disk. Tests construct registries with `loadFromState`
 * to avoid touching the real filesystem.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SobaConfig } from "../../../application/config/types";
import {
  DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
  DEFAULT_SYNTHETIC_MAX_OUTPUT,
} from "../../../application/providers/model-defaults";
import { BUILTIN_PROVIDERS, findBuiltinProvider } from "../../../application/providers/providers";
import type {
  ConfiguredModelDefinition,
  CustomProviderMap,
  ModelDefinition,
  ProviderConfigMap,
  ProviderDefinition,
  ProviderRegistryState,
  TestResult,
} from "../../../application/providers/types";
import { MODEL_METADATA_PROFILES } from "../../../application/providers/types";
import {
  DEFAULT_REASONING_SELECTION,
  type ReasoningSelection,
} from "../../../kernel/model/reasoning";
import { OpenAIAdapter } from "../openai/openai-adapter";
import { OpenAIResponsesAdapter } from "../openai/openai-responses-adapter";
import type { ProviderAdapter } from "../openai/types";
import {
  createOpenResponsesClient,
  type OpenResponsesClient,
  type OpenResponsesClientConfig,
} from "../openresponses/openresponses-client";
import {
  discoverModels,
  getCachedModels,
  resolveMetadataProfile,
  resolveModelsForProvider,
  toModelDefinitions,
} from "./discovery";

/** Default path to the user config file. */
export function getProviderRegistryConfigPath(): string {
  return join(homedir(), ".soba", "config.json");
}

/** Default adapter selection. */
function createAdapterFor(
  adapterId: ProviderDefinition["adapter"],
): ProviderAdapter {
  switch (adapterId) {
    case "openai":
      return new OpenAIAdapter();
    case "openai-responses":
      return new OpenAIResponsesAdapter();
    case "anthropic":
      // Phase 2.5: no Anthropic adapter yet. Throwing at construction time
      // is intentional — testConnection surfaces a clear "adapter pending"
      // error rather than a confusing wire failure. Built so the registry
      // contract stays valid for future Anthropic support.
      throw new Error(
        "Anthropic adapter is not yet implemented. Use an OpenAI-compatible provider.",
      );
  }
}

/** Public registry API. */
export class ProviderRegistry {
  private providers: Map<string, ProviderDefinition> = new Map();
  private providerSecrets: ProviderConfigMap = {};
  private customProviders: Map<string, ProviderDefinition> = new Map();
  // Initialised in the constructor body — TS strict mode requires the
  // definite-assignment ack since we read these in helper methods that
  // can be called from the constructor before they are guaranteed to be
  // written. The non-null assertion is safe: by the time the constructor
  // returns, both fields hold valid (providerId, modelId) pairs.
  private activeProvider: string = "";
  private activeModel: string = "";
  private clientCache: Map<string, OpenResponsesClient> = new Map();
  private clientDefaults: {
    maxCompletionTokens: number;
    temperature: number;
    reasoning: ReasoningSelection;
  };
  private readonly configPath: string;
  /** Optional callback to be notified of state changes (for tests and TUI). */
  public readonly onChange?: (state: ProviderRegistryState) => void;

  constructor(
    initialState?: Partial<ProviderRegistryState>,
    options: {
      configPath?: string;
      onChange?: (state: ProviderRegistryState) => void;
      clientDefaults?: Partial<{
        maxCompletionTokens: number;
        temperature: number;
        reasoning: ReasoningSelection;
      }>;
    } = {},
  ) {
    this.configPath = options.configPath ?? getProviderRegistryConfigPath();
    this.onChange = options.onChange;
    this.clientDefaults = {
      maxCompletionTokens: options.clientDefaults?.maxCompletionTokens ?? 0,
      temperature: options.clientDefaults?.temperature ?? 0.7,
      reasoning: structuredClone(options.clientDefaults?.reasoning ?? DEFAULT_REASONING_SELECTION),
    };

    // Seed built-in providers.
    for (const p of BUILTIN_PROVIDERS) {
      this.providers.set(p.id, structuredClone(p));
    }

    // Apply initial state if provided.
    if (initialState) {
      this.applyState(initialState);
    }

    // B1e: scrub any legacy `selectedModels` from the initial state.
    // They're no longer persisted; the catalogue is discovered at runtime.
    // (Handled in parseRegistryState and config-loader; this is a safety
    // net in case some other caller passes selectedModels directly.)

    // Pick a default active selection if none was set.
    if (!this.activeProvider || !this.providers.has(this.activeProvider)) {
      const fallback = BUILTIN_PROVIDERS[0];
      this.activeProvider = fallback.id;
      // Built-in providers don't carry a hard-coded model catalogue
      // (Phase 2.5 B1d). The wizard will discover models from the
      // live endpoint. Until then, activeModel stays empty.
      this.activeModel = "";
    }
    // B1e: only reset activeModel when it's actually empty.
    // `getActiveModel()` returns a synthetic placeholder when
    // discovery hasn't run yet. The wizard will trigger discovery
    // and let the user pick a real model.
    if (this.activeProvider && !this.activeModel) {
      const def = this.getActiveProvider();
      this.activeModel = def.defaultModel ?? "";
    }
  }

  // ─── State application ───

  private applyState(state: Partial<ProviderRegistryState>): void {
    if (state.providers) {
      this.providerSecrets = { ...state.providers };
    }
    if (state.customProviders) {
      this.customProviders = new Map();
      for (const [id, def] of Object.entries(state.customProviders)) {
        this.customProviders.set(id, { ...def, custom: true });
        if (!this.providers.has(id)) {
          this.providers.set(id, { ...def, custom: true });
        }
      }
    }
    if (state.defaultProvider) {
      this.activeProvider = state.defaultProvider;
    } else if ((state as Record<string, unknown>).activeProvider) {
      // Backward compat: read old `activeProvider` key
      this.activeProvider = (state as Record<string, unknown>)
        .activeProvider as string;
    }
    if (state.defaultModel) {
      this.activeModel = state.defaultModel;
    } else if ((state as Record<string, unknown>).activeModel) {
      // Backward compat: read old `activeModel` key
      this.activeModel = (state as Record<string, unknown>)
        .activeModel as string;
    }
  }

  /** Snapshot of the registry state — used by persistConfig and tests. */
  public snapshotState(): ProviderRegistryState {
    return {
      defaultProvider: this.activeProvider,
      defaultModel: this.activeModel,
      providers: { ...this.providerSecrets },
      customProviders: Object.fromEntries(
        Array.from(this.customProviders.entries()).map(([id, def]) => [
          id,
          structuredClone(def),
        ]),
      ),
    };
  }

  private emitChange(): void {
    this.onChange?.(this.snapshotState());
  }

  // ─── Provider / Model accessors ───

  /** All providers (built-in + custom), in stable order. */
  public getAllProviders(): ProviderDefinition[] {
    const builtins = BUILTIN_PROVIDERS.map(
      (p) => this.providers.get(p.id) ?? p,
    );
    const customs = Array.from(this.customProviders.values());
    return [...builtins, ...customs];
  }

  /** Built-in providers only. */
  public getBuiltinProviders(): ProviderDefinition[] {
    return BUILTIN_PROVIDERS.map((p) => this.providers.get(p.id) ?? p);
  }

  /** Custom (user-added) providers. */
  public getCustomProviders(): ProviderDefinition[] {
    return Array.from(this.customProviders.values());
  }

  public getProvider(id: string): ProviderDefinition | undefined {
    return this.providers.get(id);
  }

  public getActiveProvider(): ProviderDefinition {
    const p = this.providers.get(this.activeProvider);
    if (!p) {
      throw new Error(`Active provider "${this.activeProvider}" not found`);
    }
    return p;
  }

  public getActiveModel(): ModelDefinition {
    const provider = this.getActiveProvider();
    // No model selected yet — return a synthetic placeholder so the
    // runtime doesn't crash. The wizard / discovery will fill it in.
    if (!this.activeModel) {
      return syntheticModelDefinition(provider, "", provider.name);
    }
    const model = this.getModelsFor(provider.id).find(
      (m) => m.id === this.activeModel,
    );
    if (!model) {
      // Built-in providers don't carry a hard-coded catalogue (B1d).
      // If the active model id was set via CLI flag or seed but
      // discovery hasn't approved it yet, fall back to a synthetic
      // ModelDefinition so the rest of the runtime (client config,
      // compaction) keeps working. The user will get a real model
      // definition the next time they pick from the wizard.
      if (this.activeModel) {
        return syntheticModelDefinition(provider, this.activeModel);
      }
      throw new Error(
        `Active model "${this.activeModel}" not found in provider "${provider.id}"`,
      );
    }
    return model;
  }

  public getModel(
    providerId: string,
    modelId: string,
  ): ModelDefinition | undefined {
    const provider = this.providers.get(providerId);
    if (!provider) return undefined;
    const found = this.getModelsFor(providerId).find((m) => m.id === modelId);
    if (found) return found;
    // Built-in providers may have a model id that hasn't been
    // approved by discovery yet (e.g. user typed it on the CLI).
    // Return a synthetic ModelDefinition so /model, /model set, and
    // the TUI picker can work with arbitrary ids.
    if (modelId && (findBuiltinProvider(providerId) || !provider.models || provider.models.length === 0)) {
      return syntheticModelDefinition(provider, modelId);
    }
    return undefined;
  }

  /**
   * Resolve the model catalogue for a provider.
   *
   * B1e: the catalogue is **never persisted**. For built-in providers
   * we read it from the in-memory discovery cache (`discovery.ts`).
   * For custom providers it comes from `provider.models` (set by
   * `soba provider add` or `addProvider()`).
   *
   * Returns `[]` if discovery hasn't run yet for a built-in — the
   * caller is expected to trigger `discoverModels()` when the user
   * opens the picker.
   */
  public getModelsFor(providerId: string): ModelDefinition[] {
    const provider = this.providers.get(providerId);
    if (!provider) return [];
    const cached = getCachedModels(provider, this.resolveApiKey(providerId));
    const discovered = cached && cached.ok ? toModelDefinitions(cached, provider) : [];
    return resolveModelsForProvider(provider, discovered);
  }

  public getModelDiscoveryStatus(
    providerId: string,
  ):
    | { kind: "loaded" }
    | { kind: "pending" }
    | { kind: "failed"; message: string } {
    const provider = this.providers.get(providerId);
    if (!provider) return { kind: "failed", message: "Unknown provider" };
    if (provider.models && provider.models.length > 0 && resolveMetadataProfile(provider) === "none") {
      return { kind: "loaded" };
    }
    if (resolveMetadataProfile(provider) === "none") {
      return { kind: "loaded" };
    }
    const cached = getCachedModels(provider, this.resolveApiKey(providerId));
    if (!cached) return { kind: "pending" };
    if (cached.ok) return { kind: "loaded" };
    return { kind: "failed", message: cached.message };
  }

  /**
   * B1e: no-op for built-in providers (catalogue is discovered at
   * runtime; the user just needs to pick from the picker). Still
   * validates that the provider exists. Kept for back-compat with
   * the wizard code path that calls it after a successful discovery.
   */
  public selectModel(providerId: string, _model: ModelDefinition): void {
    if (!this.providers.has(providerId)) return;
    // No persistence side-effect: the model is already in the
    // discovery cache after `discoverModels()` returns. The active
    // selection is updated via `setActive()`.
  }

  /**
   * Trigger model catalogue discovery for every provider that enables it.
   * Called when the ModelSelector opens so the picker shows real
   * model entries instead of synthetic fallbacks.
   *
   * Non-blocking best-effort: failures leave the synthetic entries
   * in place so the UX is never broken.
   */
  public async refreshBuiltinModels(
    onProviderSettled?: (providerId: string) => void,
  ): Promise<void> {
    const promises = this.getAllProviders()
      .filter((provider) => resolveMetadataProfile(provider) !== "none")
      .map(async (p) => {
        const apiKey = this.resolveApiKey(p.id);
        try {
          const outcome = await discoverModels(p, apiKey, { timeoutMs: 8_000 });
          if (outcome.ok) {
            for (const model of toModelDefinitions(outcome, p)) {
              // A cached client may still contain synthetic or stale limits.
              // Rebuild it lazily so compaction and UI use the refreshed data.
              this.invalidateClient(p.id, model.id);
            }
          }
        } catch {
          // Discovery failure is non-fatal — synthetic entries stay visible.
        } finally {
          onProviderSettled?.(p.id);
        }
      });
    await Promise.allSettled(promises);
  }

  // ─── Active selection ───

  public setActive(providerId: string, modelId: string): boolean {
    if (!this.providers.has(providerId)) return false;
    const provider = this.providers.get(providerId);
    if (!provider) return false;
    if (!this.getModelsFor(providerId).some((m) => m.id === modelId)) {
      // Model not in the (currently known) catalogue.
      //
      // B1e: for built-in providers the catalogue is discovered at
      // runtime, so the in-memory cache may be cold when the user
      // types an id on the CLI / via env var. We accept any non-empty
      // id and the wizard will trigger discovery on next use.
      //
      // For custom providers the catalogue is hard-coded (added via
      // `soba provider add --model ...`). Unknown ids are rejected
      // because the user has no way to recover from a typo — the
      // /model set UX will surface the available list.
      // Built-in providers don't carry a hard-coded catalogue;
      // empty model ids are allowed — discovery fills them later.
      if (findBuiltinProvider(providerId) || !provider.models || provider.models.length === 0) {
        this.activeProvider = providerId;
        this.activeModel = modelId;
        this.clientCache.delete(this.clientCacheKey(providerId, modelId));
        this.emitChange();
        return true;
      }
      return false;
    }
    this.activeProvider = providerId;
    this.activeModel = modelId;
    // Invalidate cached client — caller will request a new one.
    this.clientCache.delete(this.clientCacheKey(providerId, modelId));
    this.emitChange();
    return true;
  }

  // ─── Secrets ───

  /**
   * Resolve an API key for the given provider, in this order:
   *   1. Explicit override passed to this call.
   *   2. Persisted secret in providerSecrets[providerId].apiKey.
   *   3. Environment variable (provider.apiKeyEnv).
   *   4. null (keyless providers like Ollama).
   */
  public resolveApiKey(providerId: string, override?: string): string | null {
    if (override !== undefined && override !== "") return override;
    const secret = this.providerSecrets[providerId]?.apiKey;
    if (secret) return secret;
    const provider = this.providers.get(providerId);
    if (!provider || !provider.apiKeyEnv) return null;
    return process.env[provider.apiKeyEnv] ?? null;
  }

  /** Persist an API key for a built-in provider. */
  public setApiKey(providerId: string, apiKey: string): void {
    const existing = this.providerSecrets[providerId] ?? { apiKey: "" };
    this.providerSecrets[providerId] = { ...existing, apiKey };
    this.emitChange();
  }

  /** Persist a baseUrl override for a provider. */
  public setBaseUrl(providerId: string, baseUrl: string): void {
    const existing = this.providerSecrets[providerId] ?? { apiKey: "" };
    this.providerSecrets[providerId] = { ...existing, baseUrl };
    this.emitChange();
  }

  /** Runtime preferences shared by all per-model clients, including future ones. */
  public updateClientDefaults(
    partial: Partial<Pick<OpenResponsesClientConfig, "maxCompletionTokens" | "temperature" | "reasoning">>,
  ): void {
    if (partial.maxCompletionTokens !== undefined) {
      this.clientDefaults.maxCompletionTokens = partial.maxCompletionTokens;
    }
    if (partial.temperature !== undefined) {
      this.clientDefaults.temperature = partial.temperature;
    }
    if (partial.reasoning !== undefined) {
      this.clientDefaults.reasoning = structuredClone(partial.reasoning);
    }
    for (const client of this.clientCache.values()) client.updateConfig(partial);
  }

  // ─── Custom providers ───

  public addProvider(provider: ProviderDefinition): void {
    if (!provider.id || !provider.name) {
      throw new Error("Custom provider must have id and name");
    }
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider "${provider.id}" already exists`);
    }
    // Custom providers added via `soba provider add --model ...` always
    // supply a hard-coded `models` array, so the defaultModel check
    // still applies. Custom providers that only declare baseUrl +
    // apiKeyEnv (i.e. `soba provider add --from-file` with a JSON that
    // omits `models`) skip this check — they'll be discovered on first
    // use just like built-ins.
    if (provider.models && provider.models.length > 0) {
      if (!provider.defaultModel) {
        throw new Error(
          `Custom provider "${provider.id}" has models but no defaultModel`,
        );
      }
      if (!provider.models.some((m) => m.id === provider.defaultModel)) {
        throw new Error(
          `Default model "${provider.defaultModel}" not in provider.models`,
        );
      }
    }
    const def: ProviderDefinition = { ...provider, custom: true };
    this.providers.set(def.id, def);
    this.customProviders.set(def.id, def);
    this.emitChange();
  }

  public removeProvider(id: string): boolean {
    if (findBuiltinProvider(id)) {
      // Built-in providers cannot be removed — they can only be deactivated
      // by switching away. The /model UX relies on built-ins always being
      // available even with no API key set.
      return false;
    }
    const removed = this.customProviders.delete(id);
    if (removed) {
      this.providers.delete(id);
      // If the active selection pointed at the removed provider, reset.
      if (this.activeProvider === id) {
        const fallback = BUILTIN_PROVIDERS[0]!;
        this.activeProvider = fallback.id;
        this.activeModel = fallback.defaultModel ?? "";
      }
      this.emitChange();
    }
    return removed;
  }

  // ─── Client provisioning ───

  private clientCacheKey(providerId: string, modelId: string): string {
    return `${providerId}::${modelId}`;
  }

  /**
   * Get (or create) a client for the given provider/model. The provider
   * must already be known to the registry; the model id must be in its list.
   *
   * The returned client is cached by (provider, model). Cached clients are
   * invalidated when the active selection changes or when the user updates
   * a secret — call `invalidateClient(providerId, modelId)` to force refresh.
   */
  public getClient(providerId: string, modelId: string): OpenResponsesClient {
    const cacheKey = this.clientCacheKey(providerId, modelId);
    const cached = this.clientCache.get(cacheKey);
    if (cached) return cached;

    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Unknown provider "${providerId}"`);
    }
    const model =
      this.getModelsFor(providerId).find((m) => m.id === modelId) ??
      this.getModel(providerId, modelId);
    if (!model) {
      throw new Error(
        `Model "${modelId}" not found in provider "${providerId}"`,
      );
    }

    const overrideBase = this.providerSecrets[providerId]?.baseUrl;
    const baseUrl = overrideBase ?? provider.baseUrl;
    const apiKey = this.resolveApiKey(providerId) ?? "";
    const reasoningTransport = model.reasoningTransport ?? provider.reasoningTransport;

    const sobaConfig: SobaConfig = {
      baseUrl,
      apiKey,
      model: model.id,
      modelCompatibility: model.compatibility ? [...model.compatibility] : undefined,
      modelReasoning: reasoningTransport && reasoningTransport !== "none"
        ? model.reasoning ?? (model.supportsThinking ? { control: "toggle" as const } : undefined)
        : undefined,
      modelReasoningTransport: reasoningTransport,
      maxOutputTokens: model.maxOutput,
      maxCompletionTokens: this.clientDefaults.maxCompletionTokens,
      reasoning: structuredClone(this.clientDefaults.reasoning),
      contextWindow: model.contextWindow,
      temperature: this.clientDefaults.temperature,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      bashMaxTimeoutSeconds: 300,
      sessionDir: "",
      lang: "en",
      theme: "graphite",
    };

    let adapter: ProviderAdapter;
    try {
      adapter = createAdapterFor(provider.adapter);
    } catch (err) {
      // Re-throw with provider context.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Provider "${providerId}": ${message}`);
    }

    const client = createOpenResponsesClient(sobaConfig, adapter);
    this.clientCache.set(cacheKey, client);
    return client;
  }

  /**
   * Switch the active model and return a fresh client for it.
   * Returns null if the provider/model pair is unknown.
   */
  public switchModel(
    providerId: string,
    modelId: string,
  ): OpenResponsesClient | null {
    if (!this.setActive(providerId, modelId)) return null;
    if (!modelId) return null;
    try {
      return this.getClient(providerId, modelId);
    } catch {
      return null;
    }
  }

  /** Invalidate a cached client so the next getClient() rebuilds it. */
  public invalidateClient(providerId: string, modelId: string): void {
    this.clientCache.delete(this.clientCacheKey(providerId, modelId));
  }

  // ─── Connection test ───

  /**
   * Issue a tiny ping to the given provider/model and report success/failure.
   *
   * Implementation: a non-streaming request built by the active adapter with
   * a one-token cap and a minimal user message. We only care about the HTTP
   * status and a JSON response body.
   *
   * For unsupported adapters (e.g. Anthropic today) this returns
   * `{ ok: false, error: "..." }` synchronously.
   */
  public async testConnection(
    providerId: string,
    modelId: string,
    options: { signal?: AbortSignal; apiKey?: string; baseUrl?: string } = {},
  ): Promise<TestResult> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return { ok: false, error: `Unknown provider "${providerId}"` };
    }
    const model =
      this.getModelsFor(providerId).find((m) => m.id === modelId) ??
      this.getModel(providerId, modelId);
    if (!model) {
      return {
        ok: false,
        error: `Unknown model "${modelId}" for provider "${providerId}"`,
      };
    }

    const baseUrl =
      options.baseUrl ??
      this.providerSecrets[providerId]?.baseUrl ??
      provider.baseUrl;
    const apiKey = this.resolveApiKey(providerId, options.apiKey) ?? "";

    if (provider.apiKeyEnv && !apiKey) {
      return {
        ok: false,
        error: `Missing API key — set ${provider.apiKeyEnv} or configure it in the registry`,
      };
    }

    let adapter: ProviderAdapter;
    try {
      // Validate adapter availability up-front so unsupported providers
      // (e.g. anthropic in Phase 2.5) report a clear "not implemented"
      // error instead of a confusing wire failure.
      adapter = createAdapterFor(provider.adapter);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }

    const start = Date.now();
    const url = `${baseUrl.replace(/\/$/, "")}${adapter.getCreatePath?.() ?? "/chat/completions"}`;
    const request = adapter.convertRequest({
      model: model.id,
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "ping" }],
      }],
      max_output_tokens: 1,
      stream: false,
    }, {
      baseUrl,
      apiKey,
      model: model.id,
      compatibility: model.compatibility,
      reasoningCapabilities: model.reasoning,
      reasoningTransport: model.reasoningTransport ?? provider.reasoningTransport,
    });
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(request),
        signal: options.signal ?? AbortSignal.timeout(15000),
      });
      const latencyMs = Date.now() - start;
      if (!response.ok) {
        const text = await response.text().catch(() => "Unknown error");
        return {
          ok: false,
          error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
          statusCode: response.status,
          latencyMs,
        };
      }
      // Make sure the response is JSON before declaring success — some
      // proxies return 200 + HTML error pages.
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        return {
          ok: false,
          error: `Unexpected content-type: ${contentType}`,
          statusCode: response.status,
          latencyMs,
        };
      }
      // Drain the body to free the socket.
      await response.text();
      return { ok: true, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message, latencyMs };
    }
  }

  // ─── Persistence ───

  /**
   * Flush the current registry state to disk. The file lives at
   * `~/.soba/config.json` by default; the same file is used by
   * `loadConfigFromFile` in src/core/config/config-loader.ts.
   *
   * The persisted shape is *intersected* with the existing JSON: any keys
   * outside the registry block are preserved.
   */
  public async persistConfig(): Promise<void> {
    const path = this.configPath;
    const dir = join(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let existing: Record<string, unknown> = {};
    try {
      const raw = await Bun.file(path).text();
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // File missing or invalid JSON — start fresh.
    }

    const next = { ...existing, registry: this.snapshotState() };
    await Bun.write(path, JSON.stringify(next, null, 2));
  }

  /**
   * Load registry state from disk (the same file written by persistConfig).
   * Returns a fresh state object — apply via the constructor `initialState`.
   */
  public static async loadFromFile(
    path: string = getProviderRegistryConfigPath(),
  ): Promise<ProviderRegistryState | null> {
    try {
      const raw = await Bun.file(path).text();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const block = parsed.registry;
      if (!block || typeof block !== "object") return null;
      return parseRegistryState(block);
    } catch {
      return null;
    }
  }

  /**
   * Build a SobaConfig (used by AgentLoop startup) reflecting the active
   * provider/model + persisted secrets. The returned config is the same
   * shape produced by config-loader.loadConfig() but with provider metadata
   * overlaid. If no persisted registry exists, returns a SobaConfig
   * derived from built-in defaults.
   */
  public toSobaConfig(fallback: SobaConfig): SobaConfig {
    const provider = this.getActiveProvider();
    const model = this.getActiveModel();
    const baseUrl =
      this.providerSecrets[provider.id]?.baseUrl ?? provider.baseUrl;
    const apiKey = this.resolveApiKey(provider.id) ?? fallback.apiKey;
    return {
      ...fallback,
      baseUrl,
      apiKey,
      model: model.id,
      modelCompatibility: model.compatibility
        ? [...model.compatibility]
        : undefined,
      modelReasoning: model.reasoning,
      modelReasoningTransport: model.reasoningTransport ?? provider.reasoningTransport,
      maxCompletionTokens: this.clientDefaults.maxCompletionTokens,
      temperature: this.clientDefaults.temperature,
      reasoning: structuredClone(this.clientDefaults.reasoning),
      maxOutputTokens: model.maxOutput,
      contextWindow: model.contextWindow,
    };
  }

  /** Effective OpenResponsesClientConfig used by the current active client. */
  public getActiveClientConfig(): OpenResponsesClientConfig {
    return this.getClient(this.activeProvider, this.activeModel).getConfig();
  }
}

function syntheticModelDefinition(
  provider: ProviderDefinition,
  modelId: string,
  name = modelId,
): ModelDefinition {
  const reasoning = provider.reasoningProfiles?.[modelId] ?? provider.reasoning;
  return {
    id: modelId,
    name,
    contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
    maxOutput: DEFAULT_SYNTHETIC_MAX_OUTPUT,
    supportsStreaming: true,
    supportsThinking: Boolean(reasoning && reasoning.control !== "none"),
    limits: {
      contextWindow: {
        value: DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
        source: "fallback",
        scope: "assumed",
      },
      maxOutput: {
        value: DEFAULT_SYNTHETIC_MAX_OUTPUT,
        source: "fallback",
        scope: "assumed",
      },
    },
    ...(reasoning ? { reasoning: structuredClone(reasoning) } : {}),
    ...(provider.reasoningTransport ? { reasoningTransport: provider.reasoningTransport } : {}),
  };
}

/**
 * Tolerant parser for the `registry` block in config.json. Unknown keys are
 * ignored; missing keys fall back to defaults. This is intentionally
 * permissive so old config files keep working after upgrades.
 */
export function parseRegistryState(raw: unknown): ProviderRegistryState {
  if (typeof raw !== "object" || raw === null) {
    return emptyRegistryState();
  }
  const obj = raw as Record<string, unknown>;
  const providers: ProviderConfigMap = {};
  if (obj.providers && typeof obj.providers === "object") {
    for (const [id, value] of Object.entries(
      obj.providers as Record<string, unknown>,
    )) {
      if (typeof value === "object" && value !== null) {
        const v = value as Record<string, unknown>;
        const apiKey = typeof v.apiKey === "string" ? v.apiKey : "";
        const baseUrl = typeof v.baseUrl === "string" ? v.baseUrl : undefined;
        if (apiKey || baseUrl) {
          providers[id] =
            baseUrl !== undefined ? { apiKey, baseUrl } : { apiKey };
        }
      }
    }
  }
  const customProviders: CustomProviderMap = {};
  if (obj.customProviders && typeof obj.customProviders === "object") {
    for (const [id, value] of Object.entries(
      obj.customProviders as Record<string, unknown>,
    )) {
      const def = parseCustomProviderDefinition(value);
      if (def) customProviders[id] = def;
    }
  }
  const fallback = BUILTIN_PROVIDERS[0]!;
  // Read new `defaultProvider`/`defaultModel` keys first, fall back to
  // old `activeProvider`/`activeModel` for backward compat.
  const defaultProvider =
    typeof obj.defaultProvider === "string" && obj.defaultProvider.length > 0
      ? obj.defaultProvider
      : typeof obj.activeProvider === "string" &&
          (obj.activeProvider as string).length > 0
        ? (obj.activeProvider as string)
        : fallback.id;
  const defaultModel =
    typeof obj.defaultModel === "string" && obj.defaultModel.length > 0
      ? obj.defaultModel
      : typeof obj.activeModel === "string" &&
          (obj.activeModel as string).length > 0
        ? (obj.activeModel as string)
        : (fallback.defaultModel ?? "");
  return { defaultProvider, defaultModel, providers, customProviders };
}

function parseCustomProviderDefinition(value: unknown): ProviderDefinition | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.name !== "string" ||
    typeof raw.baseUrl !== "string" ||
    (raw.adapter !== "openai" && raw.adapter !== "openai-responses" && raw.adapter !== "anthropic")
  ) {
    return null;
  }
  if (raw.models !== undefined && !Array.isArray(raw.models)) return null;
  const models = Array.isArray(raw.models)
    ? raw.models.filter(
      (model): model is ConfiguredModelDefinition =>
        typeof model === "object" && model !== null && typeof (model as { id?: unknown }).id === "string",
    )
    : undefined;
  const metadataProfile = MODEL_METADATA_PROFILES.includes(raw.metadataProfile as never)
    ? raw.metadataProfile as ProviderDefinition["metadataProfile"]
    : "auto";
  return {
    ...(raw as unknown as ProviderDefinition),
    apiKeyEnv: typeof raw.apiKeyEnv === "string" ? raw.apiKeyEnv : null,
    metadataProfile,
    ...(models ? { models } : {}),
    custom: true,
  };
}

function emptyRegistryState(): ProviderRegistryState {
  const fallback = BUILTIN_PROVIDERS[0]!;
  return {
    defaultProvider: fallback.id,
    defaultModel: fallback.defaultModel ?? "",
    providers: {},
    customProviders: {},
  };
}
