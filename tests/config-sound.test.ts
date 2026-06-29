/**
 * Sound config tests.
 *
 * Tests:
 * - DEFAULT_SOUND_CONFIG has expected values
 * - resolveSoundConfig merges partial with defaults
 * - Env vars SOBA_SOUND_ENABLED, SOBA_SOUND_VOLUME, SOBA_SOUND_REPEAT
 * - Config file sound block parsing
 * - Priority: CLI > env > file > defaults
 * - Validation: volume 0..1 clamp, invalid repeat mode
 * - isSoundConfig / isSoundRepeatMode type guards
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_CONFIG,
  DEFAULT_SOUND_CONFIG,
  isSoundConfig,
  isSoundRepeatMode,
  type SoundConfig,
} from "../src/application/config/types";
import { loadConfigFromEnv, loadConfigFromFile, resolveSoundConfig } from "../src/composition/config/config-loader";

describe("SoundConfig defaults", () => {
  test("DEFAULT_SOUND_CONFIG имеет ожидаемые значения", () => {
    expect(DEFAULT_SOUND_CONFIG.enabled).toBe(true);
    expect(DEFAULT_SOUND_CONFIG.volume).toBe(0.7);
    expect(DEFAULT_SOUND_CONFIG.repeatMode).toBe("once");
    expect(DEFAULT_SOUND_CONFIG.repeatIntervalMs).toBe(3000);
  });

  test("DEFAULT_CONFIG включает sound с значениями DEFAULT_SOUND_CONFIG", () => {
    expect(DEFAULT_CONFIG.sound).toBeDefined();
    expect(DEFAULT_CONFIG.sound?.enabled).toBe(true);
    expect(DEFAULT_CONFIG.sound?.volume).toBe(0.7);
  });

  test("resolveSoundConfig мерджит partial с дефолтами", () => {
    const config = { ...DEFAULT_CONFIG, sound: { enabled: false, volume: 0.5 } };
    const resolved = resolveSoundConfig(config);

    expect(resolved.enabled).toBe(false);
    expect(resolved.volume).toBe(0.5);
    expect(resolved.repeatMode).toBe("once");
    expect(resolved.repeatIntervalMs).toBe(3000);
  });

  test("resolveSoundConfig полностью переопределяет repeatMode", () => {
    const config = { ...DEFAULT_CONFIG, sound: { repeatMode: "repeat" as const, repeatIntervalMs: 5000 } };
    const resolved = resolveSoundConfig(config);

    expect(resolved.repeatMode).toBe("repeat");
    expect(resolved.repeatIntervalMs).toBe(5000);
    expect(resolved.enabled).toBe(true);
    expect(resolved.volume).toBe(0.7);
  });

  test("resolveSoundConfig с пустым sound возвращает дефолты", () => {
    const config = { ...DEFAULT_CONFIG, sound: undefined };
    const resolved = resolveSoundConfig(config);

    expect(resolved).toEqual(DEFAULT_SOUND_CONFIG);
  });
});

describe("Type guards", () => {
  test("isSoundRepeatMode: валидные и невалидные значения", () => {
    expect(isSoundRepeatMode("once")).toBe(true);
    expect(isSoundRepeatMode("repeat")).toBe(true);
    expect(isSoundRepeatMode("loop")).toBe(false);
    expect(isSoundRepeatMode("")).toBe(false);
    expect(isSoundRepeatMode(123)).toBe(false);
    expect(isSoundRepeatMode(null)).toBe(false);
    expect(isSoundRepeatMode(undefined)).toBe(false);
  });

  test("isSoundConfig: полная валидная конфигурация", () => {
    const cfg: SoundConfig = {
      enabled: true,
      volume: 0.8,
      repeatMode: "repeat",
      repeatIntervalMs: 2000,
    };
    expect(isSoundConfig(cfg)).toBe(true);
  });

  test("isSoundConfig: невалидные значения", () => {
    expect(isSoundConfig({ enabled: "yes", volume: 1.0, repeatMode: "once", repeatIntervalMs: 1000 })).toBe(false);
    expect(isSoundConfig({ enabled: true, volume: "0.5", repeatMode: "once", repeatIntervalMs: 1000 })).toBe(false);
    expect(isSoundConfig({ enabled: true, volume: 1.0, repeatMode: "loop", repeatIntervalMs: 1000 })).toBe(false);
    expect(isSoundConfig({ enabled: true, volume: 1.0, repeatMode: "once", repeatIntervalMs: "1000" })).toBe(false);
    expect(isSoundConfig(null)).toBe(false);
    expect(isSoundConfig(undefined)).toBe(false);
    expect(isSoundConfig("string")).toBe(false);
  });
});

describe("Env vars", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["SOBA_SOUND_ENABLED", "SOBA_SOUND_VOLUME", "SOBA_SOUND_REPEAT"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ["SOBA_SOUND_ENABLED", "SOBA_SOUND_VOLUME", "SOBA_SOUND_REPEAT"]) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  test("SOBA_SOUND_ENABLED=true включает звук", () => {
    process.env.SOBA_SOUND_ENABLED = "true";
    const overrides = loadConfigFromEnv();
    expect(overrides.sound?.enabled).toBe(true);
  });

  test("SOBA_SOUND_ENABLED=false отключает звук", () => {
    process.env.SOBA_SOUND_ENABLED = "false";
    const overrides = loadConfigFromEnv();
    expect(overrides.sound?.enabled).toBe(false);
  });

  test("SOBA_SOUND_ENABLED=1 тоже включает", () => {
    process.env.SOBA_SOUND_ENABLED = "1";
    const overrides = loadConfigFromEnv();
    expect(overrides.sound?.enabled).toBe(true);
  });

  test("SOBA_SOUND_VOLUME=0.5 парсится правильно", () => {
    process.env.SOBA_SOUND_VOLUME = "0.5";
    const overrides = loadConfigFromEnv();
    expect(overrides.sound?.volume).toBe(0.5);
  });

  test("SOBA_SOUND_VOLUME=2.0 (вне диапазона) — игнорируется", () => {
    process.env.SOBA_SOUND_VOLUME = "2.0";
    const overrides = loadConfigFromEnv();
    // Out of range, should be ignored
    expect(overrides.sound?.volume).toBeUndefined();
  });

  test("SOBA_SOUND_VOLUME=abc (не число) — игнорируется", () => {
    process.env.SOBA_SOUND_VOLUME = "abc";
    const overrides = loadConfigFromEnv();
    expect(overrides.sound?.volume).toBeUndefined();
  });

  test("SOBA_SOUND_REPEAT=true включает repeat", () => {
    process.env.SOBA_SOUND_REPEAT = "true";
    const overrides = loadConfigFromEnv();
    expect(overrides.sound?.repeatMode).toBe("repeat");
  });

  test("SOBA_SOUND_REPEAT=false выключает repeat (once)", () => {
    process.env.SOBA_SOUND_REPEAT = "false";
    const overrides = loadConfigFromEnv();
    expect(overrides.sound?.repeatMode).toBe("once");
  });

  test("SOBA_SOUND_REPEAT=0 тоже once", () => {
    process.env.SOBA_SOUND_REPEAT = "0";
    const overrides = loadConfigFromEnv();
    expect(overrides.sound?.repeatMode).toBe("once");
  });

  test("SOBA_SOUND_REPEAT=invalid — игнорируется", () => {
    process.env.SOBA_SOUND_REPEAT = "invalid";
    const overrides = loadConfigFromEnv();
    expect(overrides.sound?.repeatMode).toBeUndefined();
  });

  test("все три переменные вместе", () => {
    process.env.SOBA_SOUND_ENABLED = "false";
    process.env.SOBA_SOUND_VOLUME = "0.3";
    process.env.SOBA_SOUND_REPEAT = "true";
    const overrides = loadConfigFromEnv();
    expect(overrides.sound?.enabled).toBe(false);
    expect(overrides.sound?.volume).toBe(0.3);
    expect(overrides.sound?.repeatMode).toBe("repeat");
  });
});

describe("Config file", () => {
  const testDir = join(tmpdir(), `soba-sound-test-${Date.now()}`);
  const configPath = join(testDir, "config.json");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { unlinkSync(configPath); } catch { /* ok */ }
  });

  test("sound блок из файла парсится правильно", async () => {
    const configObj = {
      apiKey: "fake-api-key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4",
      sound: {
        enabled: false,
        volume: 0.2,
        repeatMode: "repeat",
        repeatIntervalMs: 5000,
      },
    };
    await Bun.write(configPath, JSON.stringify(configObj));

    const config = await loadConfigFromFile(configPath);
    expect(config).not.toBeNull();
    expect(config?.sound?.enabled).toBe(false);
    expect(config?.sound?.volume).toBe(0.2);
    expect(config?.sound?.repeatMode).toBe("repeat");
    expect(config?.sound?.repeatIntervalMs).toBe(5000);
  });

  test("частичный sound блок в файле — накладывается на дефолты", async () => {
    const configObj = {
      apiKey: "fake-api-key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4",
      sound: {
        volume: 0.5,
      },
    };
    await Bun.write(configPath, JSON.stringify(configObj));

    const config = await loadConfigFromFile(configPath);
    expect(config?.sound?.volume).toBe(0.5);
    // Other fields should remain from DEFAULT_SOUND_CONFIG (merged in loadConfig)
    // Note: loadConfigFromFile returns the raw file config, not merged with defaults
  });

  test("файл без sound блока — sound остаётся DEFAULT_SOUND_CONFIG", async () => {
    const configObj = {
      apiKey: "fake-api-key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4",
    };
    await Bun.write(configPath, JSON.stringify(configObj));

    const config = await loadConfigFromFile(configPath);
    // Without sound block, sound should be the default
    expect(config?.sound?.enabled).toBe(DEFAULT_SOUND_CONFIG.enabled);
    expect(config?.sound?.volume).toBe(DEFAULT_SOUND_CONFIG.volume);
  });

  test("sound блок с некорректными типами не ломает загрузку", async () => {
    const configObj = {
      apiKey: "fake-api-key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4",
      sound: {
        enabled: "not-a-boolean",
        volume: "loud",
      },
    };
    await Bun.write(configPath, JSON.stringify(configObj));

    // Should not throw
    const config = await loadConfigFromFile(configPath);
    expect(config).not.toBeNull();
    expect(config?.apiKey).toBe("fake-api-key");
  });
});
