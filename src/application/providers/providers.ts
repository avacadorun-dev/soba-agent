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

/** OpenAI — native Responses API with exact-id reasoning profiles. */
const OPENAI: ProviderDefinition = {
  id: "openai-official",
  name: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  adapter: "openai-responses",
  metadataProfile: "generic_openai",
  reasoningTransport: "openai_responses",
  reasoningProfiles: {
    "gpt-5.6": {
      control: "effort",
      supportedEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
    },
  },
};

/** DeepSeek — OpenAI-compatible. */
const DEEPSEEK: ProviderDefinition = {
  id: "deepseek",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  adapter: "openai",
  metadataProfile: "generic_openai",
  reasoningTransport: "deepseek",
  reasoning: { control: "toggle", defaultEnabled: true },
};

/** Moonshot Kimi — OpenAI-compatible. Focus on coding models (Kimi K2). */
const KIMI: ProviderDefinition = {
  id: "kimi",
  name: "Moonshot Kimi (K2 for code)",
  baseUrl: "https://api.moonshot.cn/v1",
  apiKeyEnv: "MOONSHOT_API_KEY",
  adapter: "openai",
  metadataProfile: "generic_openai",
  reasoningTransport: "kimi",
  reasoning: { control: "toggle", defaultEnabled: true },
};

/** Alibaba (Singapore region) — Qwen, OpenAI-compatible. */
const ALIBABA: ProviderDefinition = {
  id: "alibaba",
  name: "Alibaba Qwen (Singapore)",
  baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  apiKeyEnv: "DASHSCOPE_API_KEY",
  adapter: "openai",
  metadataProfile: "generic_openai",
  reasoningTransport: "qwen",
  reasoning: { control: "toggle" },
};

/** OpenRouter — meta-router for many models, OpenAI-compatible. */
const OPENROUTER: ProviderDefinition = {
  id: "openrouter",
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKeyEnv: "OPENROUTER_API_KEY",
  adapter: "openai",
  metadataProfile: "openrouter",
  reasoningTransport: "openrouter",
};

/**
 * All built-in providers. Order matters: it defines the display order
 * in /model list and ModelSelector. Anything not on this list is
 * reachable via `soba provider add` and lives in
 * `~/.soba/config.json` under `customProviders`.
 */
export const BUILTIN_PROVIDERS: ProviderDefinition[] = [DEEPSEEK, KIMI, ALIBABA, OPENROUTER, OPENAI];

/** Lookup a built-in provider by id. */
export function findBuiltinProvider(id: string): ProviderDefinition | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === id);
}
