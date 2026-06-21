/**
 * Tests for config-loader — Phase 2 B1e.
 *
 * Covers use-cases UC-01, UC-05, UC-08 from
 * docs/phase-2-b1e-config-cleanup/use-cases.md.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _resetDeprecationWarningsForTests,
  loadConfig,
  loadConfigFromFile,
} from "../../../src/core/config/config-loader";
import {
  DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
  DEFAULT_SYNTHETIC_MAX_OUTPUT,
} from "../../../src/core/provider/model-defaults";

let tmpDir: string;
let configPath: string;
let savedMaxOutputTokens: string | undefined;
let savedContextWindow: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "soba-config-loader-"));
  configPath = join(tmpDir, "config.json");
  savedMaxOutputTokens = process.env.SOBA_MAX_OUTPUT_TOKENS;
  savedContextWindow = process.env.SOBA_CONTEXT_WINDOW;
  delete process.env.SOBA_MAX_OUTPUT_TOKENS;
  delete process.env.SOBA_CONTEXT_WINDOW;
  _resetDeprecationWarningsForTests();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
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
  _resetDeprecationWarningsForTests();
});

function writeConfig(json: object): void {
  writeFileSync(configPath, JSON.stringify(json, null, 2));
}

describe("loadConfigFromFile — B1e: maxTokens / contextWindow no longer read from disk", () => {
  test("ignores root maxTokens and contextWindow (returns DEFAULT_CONFIG placeholders)", async () => {
    writeConfig({
      baseUrl: "https://example.com/v1",
      apiKey: "k",
      model: "x",
      maxTokens: 99999,
      contextWindow: 999999,
    });
    const cfg = await loadConfigFromFile(configPath);
    expect(cfg).not.toBeNull();
    // The legacy fields are NOT applied to the returned SobaConfig.
    // (callers should use the active model's parameters instead)
    expect(cfg?.maxOutputTokens).not.toBe(99999);
    expect(cfg?.contextWindow).not.toBe(999999);
  });
});

describe("loadConfigFromFile — B1e: legacy selectedModels[*][*].apiKey migration", () => {
  test("lifts apiKey from selectedModels into providers[]", async () => {
    writeConfig({
      registry: {
        defaultProvider: "openrouter",
        defaultModel: "minimax/minimax-m3",
        providers: {},
        selectedModels: {
          openrouter: [
            {
              id: "minimax/minimax-m3",
              name: "minimax/minimax-m3",
              apiKey: "fake-legacy-123",
              contextWindow: 128000,
              maxOutput: 8192,
              supportsStreaming: true,
              supportsThinking: true,
            },
          ],
        },
      },
    });
    const cfg = await loadConfigFromFile(configPath);
    expect(cfg).not.toBeNull();
    const regProviders = cfg?.registry?.providers as
      | Record<string, { apiKey?: string }>
      | undefined;
    expect(regProviders?.openrouter?.apiKey).toBe("fake-legacy-123");
  });

  test("does not overwrite an existing providers[id].apiKey", async () => {
    writeConfig({
      registry: {
        defaultProvider: "openrouter",
        defaultModel: "x",
        providers: { openrouter: { apiKey: "k-existing" } },
        selectedModels: {
          openrouter: [
            { id: "x", name: "x", apiKey: "k-legacy", contextWindow: 1, maxOutput: 1 },
          ],
        },
      },
    });
    const cfg = await loadConfigFromFile(configPath);
    const regProviders = cfg?.registry?.providers as
      | Record<string, { apiKey?: string }>
      | undefined;
    expect(regProviders?.openrouter?.apiKey).toBe("k-existing");
  });

  test("ignores selectedModels entries that have no apiKey field", async () => {
    writeConfig({
      registry: {
        defaultProvider: "openrouter",
        defaultModel: "x",
        providers: {},
        selectedModels: {
          openrouter: [
            // No apiKey on this entry — common case after the bug fix.
            { id: "x", name: "x", contextWindow: 1, maxOutput: 1 },
          ],
        },
      },
    });
    const cfg = await loadConfigFromFile(configPath);
    const regProviders = cfg?.registry?.providers as
      | Record<string, { apiKey?: string }>
      | undefined;
    expect(regProviders?.openrouter).toBeUndefined();
  });
});

describe("loadConfig — B1e: derivation from active model", () => {
  test("derives contextWindow and maxOutputTokens from active model when registry is present", async () => {
    writeConfig({
      registry: {
        defaultProvider: "openrouter",
        defaultModel: "minimax/minimax-m3",
        providers: { openrouter: { apiKey: "k" } },
        customProviders: {},
        // selectedModels is gone — discovery is runtime-only.
      },
    });
    const cfg = await loadConfig({}, { configPath });
    // Without a discovery cache, getActiveModel() returns a synthetic
    // ModelDefinition with conservative defaults:
    //   contextWindow: 128000, maxOutput: 32768.
    expect(cfg.contextWindow).toBe(DEFAULT_SYNTHETIC_CONTEXT_WINDOW);
    expect(cfg.maxOutputTokens).toBe(DEFAULT_SYNTHETIC_MAX_OUTPUT);
  });

  test("CLI override --max-output-tokens beats the derived value", async () => {
    writeConfig({
      registry: {
        defaultProvider: "openrouter",
        defaultModel: "minimax/minimax-m3",
        providers: { openrouter: { apiKey: "k" } },
        customProviders: {},
      },
    });
    const cfg = await loadConfig({ maxOutputTokens: 4096 }, { configPath });
    expect(cfg.maxOutputTokens).toBe(4096);
  });

  test("CLI override --context-window beats the derived value", async () => {
    writeConfig({
      registry: {
        defaultProvider: "openrouter",
        defaultModel: "minimax/minimax-m3",
        providers: { openrouter: { apiKey: "k" } },
        customProviders: {},
      },
    });
    const cfg = await loadConfig({ contextWindow: 32000 }, { configPath });
    expect(cfg.contextWindow).toBe(32000);
  });
});

describe("loadConfig — B1e: legacy flat-only config (pre-2.5)", () => {
  test("uses flat contextWindow / maxOutputTokens with deprecation warning", async () => {
    writeConfig({
      baseUrl: "https://api.deepseek.com",
      apiKey: "k",
      model: "deepseek-chat",
      maxTokens: 16384,
      contextWindow: 128000,
    });
    // Capture stderr to silence the deprecation warning in test output.
    const origWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => warnings.push(msg);
    try {
      const cfg = await loadConfig({}, { configPath });
      // Pre-2.5 flat fields are honoured as a back-compat fallback.
      // (We rename maxTokens → maxOutputTokens in the file loader, so
      // the user must update the file at some point, but in the
      // meantime the runtime keeps working.)
      expect(cfg.maxOutputTokens).toBe(16384);
      expect(cfg.contextWindow).toBe(128000);
      // At least one deprecation warning was logged.
      expect(warnings.some((w) => w.includes("maxTokens") || w.includes("contextWindow"))).toBe(
        true,
      );
    } finally {
      console.warn = origWarn;
    }
  });
});
