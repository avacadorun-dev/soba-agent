/**
 * End-to-end integration test for the B1e config-cleanup flow.
 *
 * Simulates a fresh-user wizard run (firstTimeSetup, but with all
 * I/O mocked) and verifies that:
 *
 *   1. The persisted config has no `selectedModels` field anywhere.
 *   2. The active model is set via `registry.defaultProvider` /
 *      `registry.defaultModel` — the on-disk file is consistent.
 *   3. The next `loadConfig()` reads the registry and derives
 *      `contextWindow` + `maxOutputTokens` from the active model
 *      (not from the file).
 *   4. The next `loadConfig()` with a flat-only pre-2.5 file
 *      (no registry) still honours the legacy `maxTokens` /
 *      `contextWindow` with a deprecation warning, and the
 *      `selectedModels` field is silently dropped.
 *   5. `loadConfig()` with no overrides and a valid registry never
 *      logs a deprecation warning.
 *
 * Maps to UC-01, UC-04, UC-05, UC-08, UC-09 in
 * docs/phase-2-b1e-config-cleanup/use-cases.md.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  _resetDeprecationWarningsForTests,
  loadConfig,
  loadConfigFromFile,
  saveConfigToFile,
} from "../src/application/config/config-loader";
import {
  DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
  DEFAULT_SYNTHETIC_MAX_OUTPUT,
} from "../src/application/providers/model-defaults";
import type { ModelDefinition } from "../src/application/providers/types";
import { ProviderRegistry } from "../src/infrastructure/llm/providers/registry";

let tmpDir: string;
let configPath: string;
let savedMaxOutputTokens: string | undefined;
let savedContextWindow: string | undefined;

beforeEach(async () => {
  _resetDeprecationWarningsForTests();
  tmpDir = await Bun.$`mktemp -d`.text();
  configPath = `${tmpDir.trim()}/config.json`;
  // Isolate from ambient env vars that override config values
  savedMaxOutputTokens = process.env.SOBA_MAX_OUTPUT_TOKENS;
  savedContextWindow = process.env.SOBA_CONTEXT_WINDOW;
  delete process.env.SOBA_MAX_OUTPUT_TOKENS;
  delete process.env.SOBA_CONTEXT_WINDOW;
});

afterEach(async () => {
  await Bun.$`rm -rf ${tmpDir}`.quiet();
  if (savedMaxOutputTokens !== undefined) {
    process.env.SOBA_MAX_OUTPUT_TOKENS = savedMaxOutputTokens;
  } else {
    delete process.env.SOBA_MAX_OUTPUT_TOKENS;
  }
  if (savedContextWindow !== undefined) {
    process.env.SOBA_CONTEXT_WINDOW = savedContextWindow;
  } else {
    delete process.env.SOBA_CONTEXT_WINDOW;
  }
});

describe("B1e end-to-end — fresh wizard run", () => {
  test("wizard-shaped config persists no selectedModels; loadConfig derives model params", async () => {
    // 1. Simulate the wizard's persistConfig + saveConfigToFile sequence.
    //    We use a *custom* provider so its hard-coded `models[]` is
    //    authoritative — no need to mock upstream discovery.
    const chosenModel: ModelDefinition = {
      id: "minimax/minimax-m3",
      name: "MiniMax M3",
      contextWindow: 200000,
      maxOutput: 16384,
      supportsStreaming: true,
      supportsThinking: false,
    };

    const reg = new ProviderRegistry(undefined, { configPath });
    reg.addProvider({
      id: "openrouter-mock",
      name: "OpenRouter (mock)",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      adapter: "openai",
      defaultModel: chosenModel.id,
      models: [chosenModel],
    });
    reg.setActive("openrouter-mock", chosenModel.id);
    await reg.persistConfig();

    // 2. Re-read the file — verify NO selectedModels anywhere.
    const onDisk = JSON.parse(await Bun.file(configPath).text()) as Record<string, unknown>;
    const regBlock = onDisk.registry as Record<string, unknown>;
    expect("selectedModels" in regBlock).toBe(false);
    expect(regBlock.defaultProvider).toBe("openrouter-mock");
    expect(regBlock.defaultModel).toBe(chosenModel.id);

    // 3. loadConfig() must derive contextWindow + maxOutputTokens
    //    from the active model. The file has no `maxTokens` /
    //    `contextWindow` fields and no `selectedModels`.
    const cfg = await loadConfig({}, { configPath });
    expect(cfg.contextWindow).toBe(chosenModel.contextWindow);
    expect(cfg.maxOutputTokens).toBe(chosenModel.maxOutput);
  });

  test("wizard flow with a user-supplied API key persists it into providers[id].apiKey", async () => {
    const reg = new ProviderRegistry(undefined, { configPath });
    reg.setActive("openrouter", "minimax/minimax-m3");
    reg.setApiKey("openrouter", "fake-wizard-key");
    await reg.persistConfig();

    const onDisk = JSON.parse(await Bun.file(configPath).text()) as Record<string, unknown>;
    const regBlock = onDisk.registry as Record<string, unknown>;
    expect("selectedModels" in regBlock).toBe(false);
    const providers = regBlock.providers as Record<string, { apiKey?: string }>;
    expect(providers.openrouter?.apiKey).toBe("fake-wizard-key");
  });

  test("legacy selectedModels[*][*].apiKey is migrated to providers[id].apiKey on read", async () => {
    // Hand-craft a pre-2.5 file with the buggy selectedModels shape.
    await saveConfigToFile(
      {
        // Pre-2.5 had no `registry` typed field on disk; we still
        // accept it as a side-channel. Construct a config that has
        // registry at the top level (since registry is allowed on
        // SobaConfig.registry).
        apiKey: "",
        model: "minimax/minimax-m3",
        temperature: 0.7,
        maxAgentIterations: 25,
        maxStalledIterations: 8,
        maxRunMinutes: 30,
        sessionDir: "/tmp",
        lang: "en",
        theme: "default",
        compaction: undefined,
        maxOutputTokens: 8192,
        contextWindow: 128000,
        noSession: false,
        noColor: false,
        noStream: false,
        stream: false,
        debug: false,
        noAutoCompact: false,
        help: false,
        version: false,
        providerSubcommand: undefined,
        providerSubArgs: [],
        registry: {
          defaultProvider: "openrouter",
          defaultModel: "minimax/minimax-m3",
          providers: {},
          customProviders: {},
          // The legacy field that the buggy wizard wrote.
          selectedModels: {
            openrouter: [
              {
                id: "minimax/minimax-m3",
                name: "MiniMax M3",
                apiKey: "fake-legacy",
                contextWindow: 128000,
                maxOutput: 8192,
                supportsStreaming: true,
                supportsThinking: false,
              },
            ],
          },
        },
      } as unknown as Parameters<typeof saveConfigToFile>[0],
      configPath,
    );

    // Read via loadConfigFromFile (it should drop selectedModels from
    // the returned SobaConfig and migrate apiKey).
    const fileCfg = await loadConfigFromFile(configPath);
    expect(fileCfg).not.toBeNull();
    // selectedModels is not on SobaConfig at all, so just check the
    // file is well-formed:
    expect(fileCfg?.registry).toBeDefined();
    // The migration wrote apiKey into providers.openrouter.
    const regBlock = fileCfg?.registry;
    expect(regBlock?.providers?.openrouter?.apiKey).toBe("fake-legacy");

    // loadConfig() can use that apiKey through the registry lifting
    // step (B1d behaviour). contextWindow / maxOutputTokens are
    // derived from the active model (which the wizard may not have
    // discovered yet, so the synthetic defaults apply).
    const cfg = await loadConfig({}, { configPath });
    expect(cfg.apiKey).toBe("fake-legacy");
    // Synthetic defaults from getActiveModel() for an unknown built-in id.
    expect(cfg.contextWindow).toBe(DEFAULT_SYNTHETIC_CONTEXT_WINDOW);
    expect(cfg.maxOutputTokens).toBe(DEFAULT_SYNTHETIC_MAX_OUTPUT);
  });

  test("pre-2.5 flat-only config (no registry) keeps working with deprecation warning", async () => {
    // File has NO registry block, but has flat maxTokens / contextWindow.
    await saveConfigToFile(
      {
        apiKey: "fake-flat",
        baseUrl: "https://api.example.com/v1",
        model: "llama-3-70b",
        // Legacy fields captured by readConfigFile.
        maxTokens: 16384,
        contextWindow: 128000,
        temperature: 0.7,
        maxAgentIterations: 25,
        maxStalledIterations: 8,
        maxRunMinutes: 30,
        sessionDir: "/tmp",
        lang: "en",
        theme: "default",
        compaction: undefined,
        maxOutputTokens: 8192, // default
        noSession: false,
        noColor: false,
        noStream: false,
        stream: false,
        debug: false,
        noAutoCompact: false,
        help: false,
        version: false,
        providerSubcommand: undefined,
        providerSubArgs: [],
      } as unknown as Parameters<typeof saveConfigToFile>[0],
      configPath,
    );

    // Capture the deprecation warning.
    const origWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => warnings.push(msg);
    try {
      const cfg = await loadConfig({}, { configPath });
      // Pre-2.5 fallback: maxTokens becomes maxOutputTokens,
      // contextWindow stays as is.
      expect(cfg.maxOutputTokens).toBe(16384);
      expect(cfg.contextWindow).toBe(128000);
      // At least one of the two deprecation warnings fired.
      const hit = warnings.some(
        (w) => w.includes("maxTokens") || w.includes("contextWindow"),
      );
      expect(hit).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  test("valid registry config does NOT log any deprecation warning on load", async () => {
    const reg = new ProviderRegistry(undefined, { configPath });
    reg.setActive("deepseek", "deepseek-chat");
    await reg.persistConfig();

    const origWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => warnings.push(msg);
    try {
      await loadConfig({}, { configPath });
      expect(warnings).toEqual([]);
    } finally {
      console.warn = origWarn;
    }
  });
});
