/**
 * Built-in provider definitions — Phase 2.5 B1d.
 *
 * Built-in providers no longer carry a hard-coded model catalogue
 * (it was always drifting out of date — DeepSeek rotates ids,
 * OpenRouter adds new ones weekly, Moonshot launched Kimi K2, etc).
 * The actual list of available models is discovered at runtime via
 * `GET <baseUrl>/models` — see `discovery.ts`.
 *
 * Adding a new built-in provider:
 *   1. Add a `ProviderDefinition` to `BUILTIN_PROVIDERS`.
 *   2. Leave `defaultModel` empty — the wizard discovers available
 *      models from the live endpoint and picks via heuristics.
 *   3. Add a test in `tests/core/provider/providers.test.ts`.
 */

import type { ProviderDefinition } from "./types";

/** DeepSeek — OpenAI-compatible. */
const DEEPSEEK: ProviderDefinition = {
  id: "deepseek",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  adapter: "openai",
};

/** Moonshot Kimi — OpenAI-compatible. Focus on coding models (Kimi K2). */
const KIMI: ProviderDefinition = {
  id: "kimi",
  name: "Moonshot Kimi (K2 for code)",
  baseUrl: "https://api.moonshot.cn/v1",
  apiKeyEnv: "MOONSHOT_API_KEY",
  adapter: "openai",
};

/** Alibaba (Singapore region) — Qwen, OpenAI-compatible. */
const ALIBABA: ProviderDefinition = {
  id: "alibaba",
  name: "Alibaba Qwen (Singapore)",
  baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  apiKeyEnv: "DASHSCOPE_API_KEY",
  adapter: "openai",
};

/** OpenRouter — meta-router for many models, OpenAI-compatible. */
const OPENROUTER: ProviderDefinition = {
  id: "openrouter",
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKeyEnv: "OPENROUTER_API_KEY",
  adapter: "openai",
};

/**
 * All built-in providers. Order matters: it defines the display order
 * in /model list and ModelSelector. Anything not on this list is
 * reachable via `soba provider add` and lives in
 * `~/.soba/config.json` under `customProviders`.
 */
export const BUILTIN_PROVIDERS: ProviderDefinition[] = [DEEPSEEK, KIMI, ALIBABA, OPENROUTER];

/** Lookup a built-in provider by id. */
export function findBuiltinProvider(id: string): ProviderDefinition | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === id);
}
