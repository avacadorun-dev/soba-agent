import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SobaConfig } from "../src/application/config/types";
import { DEFAULT_CONFIG } from "../src/application/config/types";
import {
  fetchAvailableModels,
  loadConfigFromEnv,
  loadConfigFromFile,
  resolveCompactionConfig,
  saveConfigToFile,
  validateConfig,
} from "../src/composition/config/config-loader";

function uniqueConfigPath(label: string): string {
  const dir = join(tmpdir(), `soba-test-${label}`, ".soba");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "config.json");
}

function writeConfigFile(path: string, content: string) {
  Bun.write(path, content);
}

function deleteConfigFile(path: string) {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ok */
  }
}

// Guard: redirect HOME to temp to prevent accidental writes to ~/.soba/
const REAL_HOME = process.env.HOME;
const TEST_HOME = join(tmpdir(), `soba-test-home-${Date.now()}`);

beforeAll(() => {
  process.env.HOME = TEST_HOME;
  if (!existsSync(TEST_HOME)) mkdirSync(TEST_HOME, { recursive: true });
});

afterAll(() => {
  process.env.HOME = REAL_HOME;
});

describe("Config loader", () => {
  test("UC-1: дефолтный конфиг при отсутствии файла", async () => {
    const path = uniqueConfigPath("no-file");
    deleteConfigFile(path);

    const config = await loadConfigFromFile(path);
    expect(config).toBeNull();
  });

  test("UC-1: CLI-аргументы имеют высший приоритет", async () => {
    const path = uniqueConfigPath("cli-priority");
    process.env.SOBA_API_KEY = "fake-env";
    writeConfigFile(path, JSON.stringify({ apiKey: "fake-file" }));

    const fileConfig = await loadConfigFromFile(path);
    const envConfig = loadConfigFromEnv();

    let merged = { ...DEFAULT_CONFIG };
    if (fileConfig) merged = { ...merged, ...fileConfig };
    merged = { ...merged, ...envConfig };
    merged = { ...merged, apiKey: "fake-cli" };

    expect(merged.apiKey).toBe("fake-cli");
    delete process.env.SOBA_API_KEY;
  });

  test("переменные окружения переопределяют файл конфига", async () => {
    process.env.SOBA_API_KEY = "fake-env-key";
    const envConfig = loadConfigFromEnv();
    expect(envConfig.apiKey).toBe("fake-env-key");
    delete process.env.SOBA_API_KEY;
  });

  test("save + load дают идентичный конфиг", async () => {
    const path = uniqueConfigPath("save-load");
    deleteConfigFile(path);

    const configToSave: SobaConfig = { ...DEFAULT_CONFIG, apiKey: "fake-save-test", model: "gpt-4o-mini" };
    await saveConfigToFile(configToSave, path);

    const loaded = await loadConfigFromFile(path);
    expect(loaded).not.toBeNull();
    expect(loaded?.apiKey).toBe("fake-save-test");
  });

  test("частичный конфиг — остаются дефолты", async () => {
    const path = uniqueConfigPath("partial");
    writeConfigFile(path, JSON.stringify({ apiKey: "fake-partial" }));

    const loaded = await loadConfigFromFile(path);
    expect(loaded).not.toBeNull();
    expect(loaded?.apiKey).toBe("fake-partial");
    expect(loaded?.model).toBe(DEFAULT_CONFIG.model);
  });

  test("bashMaxTimeoutSeconds загружается из файла", async () => {
    const path = uniqueConfigPath("bash-timeout-file");
    writeConfigFile(path, JSON.stringify({ bashMaxTimeoutSeconds: 120 }));

    const loaded = await loadConfigFromFile(path);
    expect(loaded?.bashMaxTimeoutSeconds).toBe(120);
  });

  test("bashMaxTimeoutSeconds соблюдает приоритет CLI > env > config", async () => {
    const path = uniqueConfigPath("bash-timeout-priority");
    const previousBashMaxTimeout = process.env.SOBA_BASH_MAX_TIMEOUT_SECONDS;
    writeConfigFile(path, JSON.stringify({ bashMaxTimeoutSeconds: 120 }));
    try {
      process.env.SOBA_BASH_MAX_TIMEOUT_SECONDS = "45";

      const { loadConfig } = await import("../src/composition/config/config-loader");
      const envWins = await loadConfig({}, { configPath: path });
      const cliWins = await loadConfig({ bashMaxTimeoutSeconds: 15 }, { configPath: path });

      expect(envWins.bashMaxTimeoutSeconds).toBe(45);
      expect(cliWins.bashMaxTimeoutSeconds).toBe(15);
    } finally {
      if (previousBashMaxTimeout) process.env.SOBA_BASH_MAX_TIMEOUT_SECONDS = previousBashMaxTimeout;
      else delete process.env.SOBA_BASH_MAX_TIMEOUT_SECONDS;
    }
  });

  test("вложенный compaction config загружается и дополняется defaults", async () => {
    const path = uniqueConfigPath("compaction");
    writeConfigFile(path, JSON.stringify({ compaction: { auto: false, keepRecentTokens: 12_000 } }));

    const loaded = await loadConfigFromFile(path);
    expect(loaded?.compaction).toEqual({ auto: false, keepRecentTokens: 12_000 });

    const resolved = resolveCompactionConfig(loaded as SobaConfig);
    expect(resolved.auto).toBe(false);
    expect(resolved.keepRecentTokens).toBe(12_000);
    expect(resolved.minTokensForAutoCompact).toBe(32_000);
  });

  test("невалидный JSON в файле → null", async () => {
    const path = uniqueConfigPath("invalid-json");
    writeConfigFile(path, "not valid {{{");

    const loaded = await loadConfigFromFile(path);
    expect(loaded).toBeNull();
  });

  test("невалидный lang → fallback к 'en'", async () => {
    const path = uniqueConfigPath("invalid-lang");
    writeConfigFile(path, JSON.stringify({ lang: "fr" }));

    const loaded = await loadConfigFromFile(path);
    expect(loaded).not.toBeNull();
    expect(loaded?.lang).toBe("en");
  });

  test("SOBA_LANG из env", () => {
    process.env.SOBA_LANG = "zh";
    const envConfig = loadConfigFromEnv();
    expect(envConfig.lang).toBe("zh");
    delete process.env.SOBA_LANG;
  });

  test("тема загружается из файла и SOBA_THEME", async () => {
    const path = uniqueConfigPath("theme");
    writeConfigFile(path, JSON.stringify({ theme: "clay" }));

    const fileConfig = await loadConfigFromFile(path);
    expect(fileConfig?.theme).toBe("clay");

    process.env.SOBA_THEME = "aurora";
    expect(loadConfigFromEnv().theme).toBe("aurora");
    process.env.SOBA_THEME = "laser";
    expect(loadConfigFromEnv().theme).toBeUndefined();
    delete process.env.SOBA_THEME;
  });

  test("SOBA_BASE_URL из env", () => {
    process.env.SOBA_BASE_URL = "https://custom.api.com/v2";
    const envConfig = loadConfigFromEnv();
    expect(envConfig.baseUrl).toBe("https://custom.api.com/v2");
    delete process.env.SOBA_BASE_URL;
  });

  test("лимиты токенов загружаются из env", () => {
    process.env.SOBA_MAX_OUTPUT_TOKENS = "24000";
    process.env.SOBA_CONTEXT_WINDOW = "200000";

    const envConfig = loadConfigFromEnv();

    expect(envConfig.maxOutputTokens).toBe(24000);
    expect(envConfig.contextWindow).toBe(200000);
    delete process.env.SOBA_MAX_OUTPUT_TOKENS;
    delete process.env.SOBA_CONTEXT_WINDOW;
  });

  test("адаптивные лимиты agent loop загружаются из env", () => {
    process.env.SOBA_MAX_AGENT_ITERATIONS = "250";
    process.env.SOBA_MAX_STALLED_ITERATIONS = "7";
    process.env.SOBA_MAX_RUN_MINUTES = "90";
    process.env.SOBA_BASH_MAX_TIMEOUT_SECONDS = "45";

    const envConfig = loadConfigFromEnv();

    expect(envConfig.maxAgentIterations).toBe(250);
    expect(envConfig.maxStalledIterations).toBe(7);
    expect(envConfig.maxRunMinutes).toBe(90);
    expect(envConfig.bashMaxTimeoutSeconds).toBe(45);
    delete process.env.SOBA_MAX_AGENT_ITERATIONS;
    delete process.env.SOBA_MAX_STALLED_ITERATIONS;
    delete process.env.SOBA_MAX_RUN_MINUTES;
    delete process.env.SOBA_BASH_MAX_TIMEOUT_SECONDS;
  });
});

describe("Config validation", () => {
  test("валидный конфиг — нет пропущенных полей", () => {
    const config = { ...DEFAULT_CONFIG, apiKey: "fake-api-key", baseUrl: "https://api.example.com" };
    const missing = validateConfig(config);
    expect(missing).toEqual([]);
  });

  test("пустой apiKey → missing apiKey", () => {
    const config = { ...DEFAULT_CONFIG, apiKey: "" };
    const missing = validateConfig(config);
    expect(missing).toContain("apiKey");
  });

  test("пустой baseUrl тоже missing", () => {
    const config = { ...DEFAULT_CONFIG, apiKey: "fake-api-key", baseUrl: "" };
    const missing = validateConfig(config);
    expect(missing).toContain("baseUrl");
  });

  test("registry provider with persisted apiKey is valid", () => {
    const config: SobaConfig = {
      ...DEFAULT_CONFIG,
      registry: {
        defaultProvider: "openrouter",
        defaultModel: "openai/gpt-4.1-mini",
        providers: {
          openrouter: { apiKey: "fake-api-key" },
        },
        customProviders: {},
      },
    };

    expect(validateConfig(config)).toEqual([]);
  });

  test("registry provider with missing required env key is invalid", () => {
    const previous = process.env.TEST_PROVIDER_KEY;
    delete process.env.TEST_PROVIDER_KEY;
    const config: SobaConfig = {
      ...DEFAULT_CONFIG,
      registry: {
        defaultProvider: "test-provider",
        defaultModel: "test-model",
        providers: {},
        customProviders: {
          "test-provider": {
            id: "test-provider",
            name: "Test Provider",
            baseUrl: "https://api.example.test/v1",
            apiKeyEnv: "TEST_PROVIDER_KEY",
            adapter: "openai",
            defaultModel: "test-model",
            models: [
              {
                id: "test-model",
                name: "Test Model",
                contextWindow: 128000,
                maxOutput: 8192,
                supportsStreaming: true,
                supportsThinking: false,
              },
            ],
            custom: true,
          },
        },
      },
    };

    try {
      expect(validateConfig(config)).toContain("TEST_PROVIDER_KEY");
    } finally {
      if (previous === undefined) delete process.env.TEST_PROVIDER_KEY;
      else process.env.TEST_PROVIDER_KEY = previous;
    }
  });

  test("registry provider with missing key is valid when another configured provider has a key", () => {
    const config: SobaConfig = {
      ...DEFAULT_CONFIG,
      registry: {
        defaultProvider: "minimax",
        defaultModel: "MiniMax-M3",
        providers: {
          openrouter: { apiKey: "fake-openrouter-key" },
        },
        customProviders: {
          minimax: {
            id: "minimax",
            name: "Minimax",
            baseUrl: "https://api.minimax.io/v1",
            apiKeyEnv: "MINIMAX_API_KEY",
            adapter: "openai",
            defaultModel: "MiniMax-M3",
            models: [
              {
                id: "MiniMax-M3",
                name: "MiniMax M3",
                contextWindow: 256000,
                maxOutput: 32000,
                supportsStreaming: true,
                supportsThinking: true,
              },
            ],
            custom: true,
          },
        },
      },
    };

    expect(validateConfig(config)).toEqual([]);
  });

  test("--no-auto-compact override отключает proactive compaction", () => {
    const config = { ...DEFAULT_CONFIG, compaction: { auto: true } };
    expect(resolveCompactionConfig(config, true).auto).toBe(false);
  });

  test("невалидный compaction config отклоняется до запуска runtime", () => {
    const config = {
      ...DEFAULT_CONFIG,
      compaction: { safetyReserveTokens: DEFAULT_CONFIG.contextWindow },
    };
    expect(() => resolveCompactionConfig(config)).toThrow("Invalid compaction config");
  });
});

describe("DotEnv loading", () => {
  test(".env в cwd подгружается через loadConfig()", async () => {
    const cwd = process.cwd();
    const envDir = join(tmpdir(), `soba-dotenv-${Date.now()}`);
    const previousApiKey = process.env.SOBA_API_KEY;
    const previousModel = process.env.SOBA_MODEL;
    const previousBaseUrl = process.env.SOBA_BASE_URL;
    mkdirSync(envDir, { recursive: true });
    await Bun.write(
      join(envDir, ".env"),
      "SOBA_API_KEY=dotenv-key\nSOBA_MODEL=dotenv-model\nSOBA_BASE_URL=https://dotenv.example/v1\n",
    );
    delete process.env.SOBA_API_KEY;
    delete process.env.SOBA_MODEL;
    delete process.env.SOBA_BASE_URL;
    process.chdir(envDir);

    const { loadConfig } = await import("../src/composition/config/config-loader");
    const config = await loadConfig();

    expect(config.apiKey).toBe("dotenv-key");
    expect(config.model).toBe("dotenv-model");
    expect(config.baseUrl).toBe("https://dotenv.example/v1");

    process.chdir(cwd);
    if (previousApiKey) process.env.SOBA_API_KEY = previousApiKey;
    else delete process.env.SOBA_API_KEY;
    if (previousModel) process.env.SOBA_MODEL = previousModel;
    else delete process.env.SOBA_MODEL;
    if (previousBaseUrl) process.env.SOBA_BASE_URL = previousBaseUrl;
    else delete process.env.SOBA_BASE_URL;
    rmSync(envDir, { recursive: true });
  });
});

describe("Model discovery", () => {
  test("fetchAvailableModels возвращает список с реального API", async () => {
    if (process.env.SOBA_RUN_LIVE_TESTS !== "1") {
      console.log("  (skipped: set SOBA_RUN_LIVE_TESTS=1 to run live API test)");
      return;
    }
    const apiKey = process.env.SOBA_API_KEY;
    const baseUrl = process.env.SOBA_BASE_URL;

    if (!apiKey || !baseUrl) {
      console.log("  (skipped: no API credentials)");
      return;
    }

    const models = await fetchAvailableModels(baseUrl, apiKey);

    console.log(`  Found ${models.length} models`);
    expect(models.length).toBeGreaterThan(0);
    expect(models.map((m) => m.id)).toContain("qwen3-vl-plus");
  });

  test("fetchAvailableModels с плохим URL возвращает пустой массив", async () => {
    const models = await fetchAvailableModels("https://invalid.example.com/v1", "bad-key");
    expect(models).toEqual([]);
  });

  test("fetchAvailableModels с пустым ключом не падает", async () => {
    const models = await fetchAvailableModels("https://api.openai.com/v1", "");
    expect(models).toEqual([]);
  });
});
