/**
 * Built-in provider definitions — Phase 2.5 A1 / B1d.
 *
 * Phase 2.5 B1d: built-in providers no longer carry a hard-coded
 * model catalogue (it was always drifting out of date). The wizard
 * discovers the live catalogue at runtime via `GET <baseUrl>/v1/models`.
 *
 * These tests assert the new contract:
 *   - id is a non-empty lowercase string
 *   - name is non-empty
 *   - baseUrl is a valid URL with no trailing slash
 *   - apiKeyEnv is null (keyless) or an UPPER_SNAKE_CASE env var name
 *   - models is OPTIONAL (when present, must be non-empty + defaultModel in it)
 *   - defaultModel is optional (empty for built-ins — discovery fills it)
 *   - BUILTIN_PROVIDERS contains the canonical 4 providers
 */

import { describe, expect, test } from "bun:test";
import { BUILTIN_PROVIDERS, findBuiltinProvider } from "../../../src/application/providers/providers";
import type { ProviderDefinition } from "../../../src/application/providers/types";

function assertWellFormed(p: ProviderDefinition): void {
  expect(p.id).toBeTruthy();
  expect(p.id).toMatch(/^[a-z][a-z0-9_-]*$/);
  expect(p.name).toBeTruthy();
  expect(p.baseUrl).toBeTruthy();
  expect(p.baseUrl.startsWith("http")).toBe(true);
  expect(p.baseUrl.endsWith("/")).toBe(false);
  if (p.apiKeyEnv !== null) {
    expect(p.apiKeyEnv).toMatch(/^[A-Z][A-Z0-9_]*$/);
  }
  // `models` is optional in B1d. When present, validate shape.
  if (p.models !== undefined) {
    expect(p.models.length).toBeGreaterThan(0);
    if (p.defaultModel) {
      expect(p.models.some((m) => m.id === p.defaultModel)).toBe(true);
    }
    for (const m of p.models) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.contextWindow).toBeGreaterThan(0);
      expect(m.maxOutput).toBeGreaterThan(0);
      expect(m.maxOutput).toBeLessThanOrEqual(m.contextWindow);
      expect(typeof m.supportsStreaming).toBe("boolean");
      expect(typeof m.supportsThinking).toBe("boolean");
    }
  }
  // defaultModel is optional: built-ins leave it empty,
  // the wizard discovers available models from the live endpoint.
}

describe("BUILTIN_PROVIDERS", () => {
  test("contains the canonical 4 providers (UC-2.5.1 + B1d)", () => {
    const ids = BUILTIN_PROVIDERS.map((p) => p.id).sort();
    expect(ids).toEqual(["alibaba", "deepseek", "kimi", "openrouter"].sort());
  });

  test("every built-in provider is well-formed", () => {
    for (const p of BUILTIN_PROVIDERS) {
      assertWellFormed(p);
    }
  });

  test("no built-in is keyless (use `soba provider add` for local Ollama)", () => {
    const keyless = BUILTIN_PROVIDERS.filter((p) => p.apiKeyEnv === null);
    expect(keyless).toEqual([]);
  });

  test("built-in providers have no hard-coded defaultModel (discovery picks it)", () => {
    for (const p of BUILTIN_PROVIDERS) {
      expect(p.defaultModel ?? "").toBe("");
    }
  });

  test("provider ids are unique", () => {
    const ids = BUILTIN_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("findBuiltinProvider", () => {
  test("returns the provider for a known id", () => {
    const p = findBuiltinProvider("deepseek");
    expect(p?.id).toBe("deepseek");
    expect(p?.name).toBeTruthy();
  });

  test("returns undefined for an unknown id", () => {
    expect(findBuiltinProvider("nope")).toBeUndefined();
  });
});

describe("Specific provider contracts", () => {
  test("DeepSeek points at api.deepseek.com", () => {
    const p = findBuiltinProvider("deepseek");
    expect(p?.baseUrl).toBe("https://api.deepseek.com");
    expect(p?.apiKeyEnv).toBe("DEEPSEEK_API_KEY");
  });

  test("Kimi points at api.moonshot.cn", () => {
    const p = findBuiltinProvider("kimi");
    expect(p?.baseUrl).toBe("https://api.moonshot.cn/v1");
    expect(p?.apiKeyEnv).toBe("MOONSHOT_API_KEY");
  });

  test("Alibaba points at the Singapore (international) endpoint", () => {
    const p = findBuiltinProvider("alibaba");
    expect(p?.baseUrl).toContain("aliyuncs.com");
    expect(p?.apiKeyEnv).toBe("DASHSCOPE_API_KEY");
  });

  test("OpenRouter points at openrouter.ai", () => {
    const p = findBuiltinProvider("openrouter");
    expect(p?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(p?.apiKeyEnv).toBe("OPENROUTER_API_KEY");
  });
});
