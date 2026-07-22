/**
 * ProviderRegistry tests — Phase 2.5 A1.
 *
 * Maps to UC-2.5.1 and the test-cases in internal-design-notes §12.2.
 *
 * Coverage:
 *   1. getAllProviders / getBuiltinProviders
 *   2. getActiveProvider / getActiveModel + defaults
 *   3. setActive / switchModel — success and error paths
 *   4. testConnection — success (mocked server), 401, network error, missing key
 *   5. addProvider / removeProvider — custom lifecycle, can't remove built-ins
 *   6. resolveApiKey — explicit override > persisted secret > env var > null
 *   7. getClient — caching, invalidation, unknown provider/model
 *   8. snapshotState / parseRegistryState — round-trip persistence
 *   9. persistConfig — writes to disk and preserves non-registry keys
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
  DEFAULT_SYNTHETIC_MAX_OUTPUT,
} from "../../../src/application/providers/model-defaults";
import { BUILTIN_PROVIDERS } from "../../../src/application/providers/providers";
import type { ProviderDefinition, ProviderRegistryState } from "../../../src/application/providers/types";
import { ProviderRegistry, parseRegistryState } from "../../../src/infrastructure/llm/providers/registry";

// ─── Helpers ───

let tmpDir: string;
let configPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "soba-registry-"));
  configPath = join(tmpDir, "config.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function newRegistry(initial?: Partial<ProviderRegistryState>): ProviderRegistry {
  return new ProviderRegistry(initial, { configPath });
}

// ─── Defaults ───

describe("ProviderRegistry defaults", () => {
  test("getAllProviders returns all built-in providers when no state is given", () => {
    const reg = newRegistry();
    expect(reg.getAllProviders().length).toBe(5);
    expect(reg.getBuiltinProviders().length).toBe(5);
    expect(reg.getCustomProviders().length).toBe(0);
  });

  test("active selection defaults to the first built-in provider (model is empty until discovery)", () => {
    const reg = newRegistry();
    const fallback = BUILTIN_PROVIDERS[0];
    expect(reg.getActiveProvider().id).toBe(fallback.id);
    // Built-in providers don't carry a hard-coded catalogue (B1d) —
    // the active model is empty until the wizard runs discovery.
    expect(reg.getActiveModel().id).toBe("");
  });

  test("initialState overrides the active selection", () => {
    const reg = newRegistry({
      defaultProvider: "deepseek",
      defaultModel: "deepseek-chat",
      providers: {},
      customProviders: {},
    });
    expect(reg.getActiveProvider().id).toBe("deepseek");
    expect(reg.getActiveModel().id).toBe("deepseek-chat");
  });

  test("unknown defaultProvider in initial state falls back to the first built-in", () => {
    const reg = newRegistry({
      defaultProvider: "no-such-provider",
      defaultModel: "irrelevant",
      providers: {},
      customProviders: {},
    });
    expect(reg.getActiveProvider().id).toBe(BUILTIN_PROVIDERS[0].id);
  });

  test("unknown defaultModel is preserved (B1e: catalogue is discovered at runtime)", () => {
    const reg = newRegistry({
      defaultProvider: "deepseek",
      defaultModel: "no-such-model",
      providers: {},
      customProviders: {},
    });
    // B1e: we no longer auto-fallback to the provider's default. The
    // model id is preserved as-is; `getActiveModel()` returns a
    // synthetic ModelDefinition with conservative defaults. The
    // wizard will trigger discovery and let the user pick a real one.
    expect(reg.getActiveProvider().id).toBe("deepseek");
    expect(reg.getActiveModel().id).toBe("no-such-model");
    expect(reg.getActiveModel().contextWindow).toBe(128000);
  });
});

// ─── Accessors ───

describe("ProviderRegistry accessors", () => {
  test("getProvider returns the matching built-in definition", () => {
    const reg = newRegistry();
    expect(reg.getProvider("deepseek")?.name).toBe("DeepSeek");
    expect(reg.getProvider("nope")).toBeUndefined();
  });

  test("getModel returns a synthetic ModelDefinition for any non-empty id on a built-in provider (B1d)", () => {
    const reg = newRegistry();
    const m = reg.getModel("deepseek", "deepseek-chat");
    expect(m?.contextWindow).toBe(128000);
    // Built-in providers don't carry a hard-coded catalogue; any
    // non-empty id produces a synthetic definition (used for CLI
    // flags and TUI input where the user types the id directly).
    expect(reg.getModel("deepseek", "missing")?.id).toBe("missing");
    // An unknown provider is still rejected.
    expect(reg.getModel("missing", "deepseek-chat")).toBeUndefined();
  });
});

// ─── setActive / switchModel ───

describe("ProviderRegistry.setActive", () => {
  test("returns true for a known provider/model pair", () => {
    const reg = newRegistry();
    expect(reg.setActive("kimi", "kimi-k2-0711-preview")).toBe(true);
    expect(reg.getActiveProvider().id).toBe("kimi");
    expect(reg.getActiveModel().id).toBe("kimi-k2-0711-preview");
  });

  test("returns false for an unknown provider", () => {
    const reg = newRegistry();
    expect(reg.setActive("nope", "x")).toBe(false);
  });

  test("accepts an unknown model id for a built-in provider (B1d / B1e)", () => {
    // Built-in providers don't carry a hard-coded catalogue, so any
    // non-empty model id is accepted. The id is preserved in
    // `activeModel`; the user can either keep it (the runtime uses a
    // synthetic ModelDefinition) or trigger discovery to populate
    // the picker with a real catalogue. The id is NOT injected into
    // `getModelsFor` — that comes from the in-memory discovery cache.
    const reg = newRegistry();
    expect(reg.setActive("deepseek", "no-such-model")).toBe(true);
    expect(reg.getActiveProvider().id).toBe("deepseek");
    expect(reg.getActiveModel().id).toBe("no-such-model");
    // getModelsFor returns whatever the discovery cache has (empty
    // if discovery hasn't run) — NOT the active model id.
    expect(reg.getModelsFor("deepseek").map((m) => m.id)).not.toContain("no-such-model");
  });

  test("returns false for an unknown custom-provider model id", () => {
    // Custom providers carry a hard-coded `models` array (added via
    // `soba provider add --model ...`), so unknown ids are rejected.
    const reg = newRegistry();
    reg.addProvider({
      id: "my-llm",
      name: "My LLM",
      baseUrl: "http://localhost:8080/v1",
      apiKeyEnv: "MY_LLM_API_KEY",
      adapter: "openai",
      defaultModel: "my-llm-v1",
      models: [{ id: "my-llm-v1", name: "My LLM v1", contextWindow: 32000, maxOutput: 4096, supportsStreaming: true, supportsThinking: false }],
    });
    expect(reg.setActive("my-llm", "no-such-model")).toBe(false);
  });
});

describe("ProviderRegistry.switchModel", () => {
  test("returns an OpenResponsesClient for a known pair", () => {
    const reg = newRegistry();
    const client = reg.switchModel("deepseek", "deepseek-chat");
    expect(client).not.toBeNull();
    expect(client?.getConfig().model).toBe("deepseek-chat");
  });

  test("auto-registers an unknown model id on a built-in provider and returns a client (B1d)", () => {
    const reg = newRegistry();
    const client = reg.switchModel("deepseek", "no-such-model");
    expect(client).not.toBeNull();
    expect(client?.getConfig().model).toBe("no-such-model");
  });

  test("returns null for an unknown pair on a custom provider", () => {
    const reg = newRegistry();
    reg.addProvider({
      id: "my-llm",
      name: "My LLM",
      baseUrl: "http://localhost:8080/v1",
      apiKeyEnv: "MY_LLM_API_KEY",
      adapter: "openai",
      defaultModel: "my-llm-v1",
      models: [{ id: "my-llm-v1", name: "My LLM v1", contextWindow: 32000, maxOutput: 4096, supportsStreaming: true, supportsThinking: false }],
    });
    expect(reg.switchModel("my-llm", "no-such-model")).toBeNull();
    expect(reg.switchModel("nope", "deepseek-chat")).toBeNull();
  });
});

// ─── API key resolution ───

describe("ProviderRegistry.resolveApiKey", () => {
  test("explicit override wins", () => {
    const reg = newRegistry();
    expect(reg.resolveApiKey("deepseek", "override-key")).toBe("override-key");
  });

  test("persisted secret is used when no override is given", () => {
    const reg = newRegistry({
      defaultProvider: "deepseek",
      defaultModel: "deepseek-chat",
      providers: { deepseek: { apiKey: "persisted-key" } },
      customProviders: {},
    });
    expect(reg.resolveApiKey("deepseek")).toBe("persisted-key");
  });

  test("falls back to env var when nothing else is configured", () => {
    const reg = newRegistry();
    process.env.DEEPSEEK_API_KEY = "env-key";
    try {
      expect(reg.resolveApiKey("deepseek")).toBe("env-key");
    } finally {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });

  test("returns null for a keyless provider (Ollama)", () => {
    const reg = newRegistry();
    expect(reg.resolveApiKey("ollama")).toBeNull();
  });
});

// ─── Custom providers ───

describe("ProviderRegistry custom providers", () => {
  const custom: ProviderDefinition = {
    id: "my-llm",
    name: "My LLM",
    baseUrl: "http://localhost:8080/v1",
    apiKeyEnv: "MY_LLM_API_KEY",
    adapter: "openai",
    defaultModel: "my-llm-v1",
    models: [
      {
        id: "my-llm-v1",
        name: "My LLM v1",
        contextWindow: 32000,
        maxOutput: 4096,
        supportsStreaming: true,
        supportsThinking: false,
        compatibility: ["single_system_message"],
      },
    ],
  };

  test("addProvider registers a new custom provider", () => {
    const reg = newRegistry();
    reg.addProvider(custom);
    expect(reg.getCustomProviders().map((p) => p.id)).toContain("my-llm");
    expect(reg.getAllProviders().length).toBe(6);
  });

  test("addProvider rejects a duplicate id", () => {
    const reg = newRegistry();
    expect(() => reg.addProvider(custom)).not.toThrow();
    expect(() => reg.addProvider(custom)).toThrow(/already exists/);
  });

  test("addProvider rejects a defaultModel not in models", () => {
    const reg = newRegistry();
    expect(() =>
      reg.addProvider({ ...custom, defaultModel: "not-in-models" }),
    ).toThrow(/Default model/);
  });

  test("removeProvider drops a custom provider", () => {
    const reg = newRegistry();
    reg.addProvider(custom);
    expect(reg.removeProvider("my-llm")).toBe(true);
    expect(reg.getCustomProviders().map((p) => p.id)).not.toContain("my-llm");
  });

  test("removeProvider refuses to remove a built-in", () => {
    const reg = newRegistry();
    expect(reg.removeProvider("deepseek")).toBe(false);
  });

  test("removing the active custom provider resets the active selection", () => {
    const reg = newRegistry();
    reg.addProvider(custom);
    reg.setActive("my-llm", "my-llm-v1");
    expect(reg.getActiveProvider().id).toBe("my-llm");
    reg.removeProvider("my-llm");
    expect(reg.getActiveProvider().id).toBe(BUILTIN_PROVIDERS[0].id);
  });
});

// ─── Client provisioning ───

describe("ProviderRegistry.getClient", () => {
  test("returns a client and caches it across calls", () => {
    const reg = newRegistry();
    const a = reg.getClient("deepseek", "deepseek-chat");
    const b = reg.getClient("deepseek", "deepseek-chat");
    expect(a).toBe(b);
  });

  test("different models yield different cached clients", () => {
    const reg = newRegistry();
    const a = reg.getClient("deepseek", "deepseek-chat");
    const b = reg.getClient("deepseek", "deepseek-reasoner");
    expect(a).not.toBe(b);
  });

  test("client config reflects the requested model and provider's base URL", () => {
    const reg = newRegistry();
    const c = reg.getClient("deepseek", "deepseek-chat");
    const cfg = c.getConfig();
    expect(cfg.model).toBe("deepseek-chat");
    expect(cfg.baseUrl).toBe("https://api.deepseek.com");
    // apiKey is empty when DEEPSEEK_API_KEY isn't set; the client
    // itself doesn't need a key at construction time.
    expect(typeof cfg.apiKey).toBe("string");
  });

  test("client config receives compatibility from a custom provider model", () => {
    const reg = newRegistry();
    reg.addProvider({
      id: "strict-provider",
      name: "Strict Provider",
      baseUrl: "http://localhost:8000/v1",
      apiKeyEnv: null,
      adapter: "openai",
      defaultModel: "strict-model",
      models: [
        {
          id: "strict-model",
          name: "Strict Model",
          contextWindow: 32_000,
          maxOutput: 4_096,
          supportsStreaming: true,
          supportsThinking: false,
          compatibility: ["single_system_message"],
        },
        {
          id: "permissive-model",
          name: "Permissive Model",
          contextWindow: 32_000,
          maxOutput: 4_096,
          supportsStreaming: true,
          supportsThinking: false,
        },
      ],
    });

    expect(reg.getClient("strict-provider", "strict-model").getConfig().modelCompatibility).toEqual([
      "single_system_message",
    ]);
    expect(reg.getClient("strict-provider", "permissive-model").getConfig().modelCompatibility).toBeUndefined();
  });

  test("client config uses a persisted baseUrl override when present", () => {
    const reg = newRegistry({
      defaultProvider: "deepseek",
      defaultModel: "deepseek-chat",
      providers: { deepseek: { apiKey: "k", baseUrl: "https://proxy.example/v1" } },
      customProviders: {},
    });
    const cfg = reg.getClient("deepseek", "deepseek-chat").getConfig();
    expect(cfg.baseUrl).toBe("https://proxy.example/v1");
    expect(cfg.apiKey).toBe("k");
  });

  test("invalidateClient forces the next getClient to rebuild", () => {
    const reg = newRegistry();
    const a = reg.getClient("deepseek", "deepseek-chat");
    reg.invalidateClient("deepseek", "deepseek-chat");
    const b = reg.getClient("deepseek", "deepseek-chat");
    expect(a).not.toBe(b);
  });

  test("getClient throws for an unknown provider", () => {
    const reg = newRegistry();
    expect(() => reg.getClient("nope", "x")).toThrow(/Unknown provider/);
  });

  test("getClient accepts an unknown model id for a built-in provider (B1d)", () => {
    // Built-in providers don't carry a hard-coded catalogue any more,
    // so any non-empty model id is acceptable and the client is built
    // with a synthetic ModelDefinition (128k ctx, 8k out).
    const reg = newRegistry();
    const c = reg.getClient("deepseek", "nope");
    expect(c.getConfig().model).toBe("nope");
  });

  test("getClient throws for an unknown model id on a custom provider", () => {
    const reg = newRegistry();
    reg.addProvider({
      id: "my-llm",
      name: "My LLM",
      baseUrl: "http://localhost:8080/v1",
      apiKeyEnv: "MY_LLM_API_KEY",
      adapter: "openai",
      defaultModel: "my-llm-v1",
      models: [{ id: "my-llm-v1", name: "My LLM v1", contextWindow: 32000, maxOutput: 4096, supportsStreaming: true, supportsThinking: false }],
    });
    expect(() => reg.getClient("my-llm", "nope")).toThrow(/not found/);
  });

  test("getClient throws a clear error for unsupported adapters (Anthropic)", () => {
    const reg = newRegistry();
    reg.addProvider({
      id: "claude-test",
      name: "Claude Test",
      baseUrl: "https://api.example.com",
      apiKeyEnv: null,
      adapter: "anthropic",
      defaultModel: "kimi-k2-0711-preview",
      models: [
        { id: "kimi-k2-0711-preview", name: "Claude Sonnet 4", contextWindow: 200000, maxOutput: 64000, supportsStreaming: true, supportsThinking: true },
      ],
    });
    expect(() => reg.getClient("claude-test", "kimi-k2-0711-preview")).toThrow(
      /Anthropic adapter is not yet implemented/,
    );
  });
});

// ─── testConnection ───

describe("ProviderRegistry.testConnection", () => {
  test("returns ok=false with a clear error for an unknown provider", async () => {
    const reg = newRegistry();
    const r = await reg.testConnection("nope", "x");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown provider/);
  });

  test("returns ok=false when API key is missing", async () => {
    const reg = newRegistry();
    const r = await reg.testConnection("deepseek", "deepseek-chat");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/DEEPSEEK_API_KEY/);
  });

  test("keyless custom providers can be tested without a key", async () => {
    // Built-in providers all require a key after B1d. Keyless is now
    // reachable only via `soba provider add` with --api-key-env ''.
    const reg = newRegistry();
    reg.addProvider({
      id: "local-ollama",
      name: "Local Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKeyEnv: null,
      adapter: "openai",
      defaultModel: "llama3",
      models: [
        { id: "llama3", name: "Llama 3", contextWindow: 8192, maxOutput: 4096, supportsStreaming: true, supportsThinking: false },
      ],
    });
    // Point at an unreachable local URL — we only care that no key
    // error is raised. The test will fail with a network error, not a
    // missing key.
    const r = await reg.testConnection("local-ollama", "llama3");
    expect(r.ok).toBe(false);
    expect(r.error).not.toMatch(/API key/);
  });

  test("returns ok=false for unsupported adapters (anthropic is reserved)", async () => {
    // The Phase 2.5 built-in set only ships OpenAI-compatible providers;
    // a custom anthropic adapter is rejected at lookup time.
    const reg = newRegistry();
    reg.addProvider({
      id: "claude-test",
      name: "Claude Test",
      baseUrl: "https://api.example.com",
      apiKeyEnv: null,
      adapter: "anthropic",
      defaultModel: "kimi-k2-0711-preview",
      models: [
        { id: "kimi-k2-0711-preview", name: "Claude Sonnet 4", contextWindow: 200000, maxOutput: 64000, supportsStreaming: true, supportsThinking: true },
      ],
    });
    const r = await reg.testConnection("claude-test", "kimi-k2-0711-preview", {
      apiKey: "fake",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Anthropic adapter is not yet implemented/);
  });

  test("reports HTTP error status when the server returns non-2xx", async () => {
    // Mock global fetch so this test is independent of any local server.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    try {
      const reg = newRegistry({
        defaultProvider: "deepseek",
        defaultModel: "deepseek-chat",
        providers: { deepseek: { apiKey: "k" } },
        customProviders: {},
      });
      const r = await reg.testConnection("deepseek", "deepseek-chat");
      expect(r.ok).toBe(false);
      expect(r.statusCode).toBe(401);
      expect(r.error).toMatch(/HTTP 401/);
      expect(typeof r.latencyMs).toBe("number");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns ok=true with latency when the server returns 2xx JSON", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "pong" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;
    try {
      const reg = newRegistry({
        defaultProvider: "deepseek",
        defaultModel: "deepseek-chat",
        providers: { deepseek: { apiKey: "k" } },
        customProviders: {},
      });
      const r = await reg.testConnection("deepseek", "deepseek-chat");
      expect(r.ok).toBe(true);
      expect(typeof r.latencyMs).toBe("number");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses the native Responses endpoint for the official OpenAI provider", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let requestedBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    try {
      const reg = newRegistry({
        defaultProvider: "openai-official",
        defaultModel: "gpt-5.6",
        providers: { "openai-official": { apiKey: "k" } },
        customProviders: {},
      });
      const result = await reg.testConnection("openai-official", "gpt-5.6");
      expect(result.ok).toBe(true);
      expect(requestedUrl).toBe("https://api.openai.com/v1/responses");
      expect(requestedBody.input).toBeArray();
      expect(requestedBody.messages).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns ok=false when fetch throws (network unreachable)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    }) as unknown as typeof fetch;
    try {
      const reg = newRegistry({
        defaultProvider: "deepseek",
        defaultModel: "deepseek-chat",
        providers: { deepseek: { apiKey: "k" } },
        customProviders: {},
      });
      const r = await reg.testConnection("deepseek", "deepseek-chat");
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/ECONNREFUSED/);
      expect(typeof r.latencyMs).toBe("number");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── Persistence ───

describe("ProviderRegistry persistence", () => {
  test("snapshotState produces a serialisable state object", () => {
    const reg = newRegistry();
    reg.setActive("deepseek", "deepseek-reasoner");
    reg.setApiKey("deepseek", "fake-api-key");
    const snap = reg.snapshotState();
    expect(snap.defaultProvider).toBe("deepseek");
    expect(snap.defaultModel).toBe("deepseek-reasoner");
    expect(snap.providers.deepseek?.apiKey).toBe("fake-api-key");
    // Round-trip through JSON without losing fields.
    const round = JSON.parse(JSON.stringify(snap)) as ProviderRegistryState;
    expect(round).toEqual(snap);
  });

  test("persistConfig writes to disk; loadFromFile reads it back", async () => {
    const reg = newRegistry();
    reg.setActive("deepseek", "deepseek-chat");
    reg.setApiKey("deepseek", "ds-test");
    await reg.persistConfig();

    const loaded = await ProviderRegistry.loadFromFile(configPath);
    expect(loaded).not.toBeNull();
    expect(loaded?.defaultProvider).toBe("deepseek");
    expect(loaded?.defaultModel).toBe("deepseek-chat");
    expect(loaded?.providers.deepseek?.apiKey).toBe("ds-test");

    // Re-constructing from the loaded state should reproduce the selection.
    const reg2 = new ProviderRegistry(loaded ?? undefined, { configPath });
    expect(reg2.getActiveProvider().id).toBe("deepseek");
    expect(reg2.getActiveModel().id).toBe("deepseek-chat");
  });

  test("persistConfig preserves non-registry keys in the same file", async () => {
    // Seed the file with an unrelated top-level key.
    await Bun.write(
      configPath,
      JSON.stringify({ lang: "ru", theme: "clay", unrelated: { x: 1 } }, null, 2),
    );
    const reg = newProviderRegistryAt(configPath);
    reg.setActive("deepseek", "deepseek-chat");
    await reg.persistConfig();

    const onDisk = JSON.parse(await Bun.file(configPath).text()) as Record<string, unknown>;
    expect(onDisk.lang).toBe("ru");
    expect(onDisk.theme).toBe("clay");
    expect((onDisk.unrelated as { x: number }).x).toBe(1);
    expect((onDisk.registry as ProviderRegistryState).defaultProvider).toBe("deepseek");
  });
});

// ─── parseRegistryState ───

describe("parseRegistryState", () => {
  test("returns an empty default for non-object input", () => {
    expect(parseRegistryState(null).providers).toEqual({});
    expect(parseRegistryState("nope").providers).toEqual({});
  });

  test("ignores unknown / malformed entries", () => {
    const state = parseRegistryState({
      defaultProvider: "deepseek",
      defaultModel: "deepseek-chat",
      providers: {
        openai: { apiKey: "k" },
        bad: { apiKey: 123 }, // not a string
        empty: { apiKey: "" }, // ignored
      },
      customProviders: {
        ok: {
          id: "ok",
          name: "OK",
          baseUrl: "http://x",
          apiKeyEnv: null,
          adapter: "openai",
          defaultModel: "m",
          models: [{ id: "m", name: "M", contextWindow: 1, maxOutput: 1, supportsStreaming: true, supportsThinking: false }],
        },
        bad: { id: "bad" }, // missing required fields
      },
    });
    expect(state.providers.openai?.apiKey).toBe("k");
    expect(state.providers.bad).toBeUndefined();
    expect(state.customProviders.ok?.id).toBe("ok");
    expect(state.customProviders.bad).toBeUndefined();
  });

  test("preserves discovery-only custom providers and defaults their metadata profile", () => {
    const state = parseRegistryState({
      customProviders: {
        local: {
          id: "local",
          name: "Local runtime",
          baseUrl: "http://127.0.0.1:8000/v1",
          apiKeyEnv: null,
          adapter: "openai",
          defaultModel: "served-model",
        },
      },
    });

    expect(state.customProviders.local).toMatchObject({
      id: "local",
      defaultModel: "served-model",
      metadataProfile: "auto",
      custom: true,
    });
    expect(state.customProviders.local?.models).toBeUndefined();
  });
});

// ─── toSobaConfig ───

describe("ProviderRegistry.toSobaConfig", () => {
  test("overlays active provider/model onto a base SobaConfig", () => {
    // B1e: selectedModels is gone. The active model id is honoured
    // directly — getActiveModel() returns a synthetic ModelDefinition
    // when discovery hasn't run. The toSobaConfig overlay should
    // still use the configured id and pull contextWindow / maxOutput
    // from the active model.
    const reg = newRegistry({
      defaultProvider: "deepseek",
      defaultModel: "deepseek-reasoner",
      providers: { deepseek: { apiKey: "k" } },
      customProviders: {},
    });
    const base: Parameters<typeof reg.toSobaConfig>[0] = {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "deepseek-chat",
      maxOutputTokens: 4096,
      maxCompletionTokens: 0,
      contextWindow: 128000,
      temperature: 0.7,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      bashMaxTimeoutSeconds: 300,
      sessionDir: "",
      lang: "en",
      theme: "graphite",
    };
    const cfg = reg.toSobaConfig(base);
    expect(cfg.model).toBe("deepseek-reasoner");
    expect(cfg.apiKey).toBe("k");
    // Synthetic ModelDefinition defaults (no discovery cache):
    //   contextWindow: 128000, maxOutput: 32768.
    // The real values would come from the in-memory discovery cache
    // (see `discoverModels()`).
    expect(cfg.maxOutputTokens).toBe(DEFAULT_SYNTHETIC_MAX_OUTPUT);
    expect(cfg.contextWindow).toBe(DEFAULT_SYNTHETIC_CONTEXT_WINDOW);
  });

  test("includes compatibility from the active custom model", () => {
    const reg = newRegistry();
    reg.addProvider({
      id: "strict-provider",
      name: "Strict Provider",
      baseUrl: "http://localhost:8000/v1",
      apiKeyEnv: null,
      adapter: "openai",
      defaultModel: "strict-model",
      models: [{
        id: "strict-model",
        name: "Strict Model",
        contextWindow: 32_000,
        maxOutput: 4_096,
        supportsStreaming: true,
        supportsThinking: false,
        compatibility: ["single_system_message"],
      }],
    });
    reg.setActive("strict-provider", "strict-model");
    const cfg = reg.toSobaConfig({
      baseUrl: "",
      apiKey: "",
      model: "",
      maxOutputTokens: 4096,
      maxCompletionTokens: 0,
      contextWindow: 128000,
      temperature: 0.7,
      maxAgentIterations: 0,
      maxStalledIterations: 4,
      maxRunMinutes: 0,
      bashMaxTimeoutSeconds: 300,
      sessionDir: "",
      lang: "en",
      theme: "graphite",
    });

    expect(cfg.modelCompatibility).toEqual(["single_system_message"]);
  });
});

// ─── onChange ───

describe("ProviderRegistry onChange", () => {
  test("fires when the active selection changes", () => {
    const events: Array<{ providerId: string; modelId: string }> = [];
    const reg = new ProviderRegistry(undefined, {
      configPath,
      onChange: (s) => events.push({ providerId: s.defaultProvider, modelId: s.defaultModel }),
    });
    reg.setActive("deepseek", "deepseek-reasoner");
    expect(events.at(-1)).toEqual({ providerId: "deepseek", modelId: "deepseek-reasoner" });
  });
});

function newProviderRegistryAt(path: string): ProviderRegistry {
  return new ProviderRegistry(undefined, { configPath: path });
}

// ─── B1e: selectedModels removed, discovery is the source of truth ───

describe("ProviderRegistry B1e — selectedModels removed", () => {
  test("snapshotState does not include selectedModels", () => {
    const reg = newRegistry();
    reg.setActive("deepseek", "deepseek-chat");
    const snap = reg.snapshotState();
    expect("selectedModels" in snap).toBe(false);
  });

  test("parseRegistryState silently ignores selectedModels from a legacy file", () => {
    const state = parseRegistryState({
      defaultProvider: "openrouter",
      defaultModel: "x",
      providers: {},
      customProviders: {},
      // Legacy field that should be silently dropped.
      selectedModels: {
        openrouter: [
          { id: "x", name: "x", contextWindow: 1, maxOutput: 1 },
        ],
      },
    });
    expect("selectedModels" in state).toBe(false);
    expect(state.defaultProvider).toBe("openrouter");
  });

  test("getModelsFor returns empty for a built-in with no discovery cache", () => {
    const reg = newRegistry();
    // Without calling discoverModels() first, the in-memory cache is
    // empty. The registry must not invent models from anywhere else.
    expect(reg.getModelsFor("deepseek")).toEqual([]);
    expect(reg.getModelsFor("openrouter")).toEqual([]);
  });

  test("getModelsFor returns the hard-coded list for a custom provider", () => {
    const reg = newRegistry();
    reg.addProvider({
      id: "local-llm",
      name: "Local LLM",
      baseUrl: "http://localhost:8080/v1",
      apiKeyEnv: null,
      adapter: "openai",
      defaultModel: "llama-3-70b",
      models: [
        { id: "llama-3-70b", name: "Llama 3 70B", contextWindow: 8192, maxOutput: 4096, supportsStreaming: true, supportsThinking: false },
        { id: "qwen-72b", name: "Qwen 72B", contextWindow: 32768, maxOutput: 8192, supportsStreaming: true, supportsThinking: false },
      ],
    });
    const models = reg.getModelsFor("local-llm");
    expect(models.map((m) => m.id)).toEqual(["llama-3-70b", "qwen-72b"]);
  });

  test("persistConfig never writes selectedModels to disk", async () => {
    const reg = newRegistry();
    reg.setActive("deepseek", "deepseek-chat");
    await reg.persistConfig();
    const onDisk = JSON.parse(await Bun.file(configPath).text()) as Record<string, unknown>;
    const regBlock = onDisk.registry as Record<string, unknown>;
    expect("selectedModels" in regBlock).toBe(false);
  });
});
