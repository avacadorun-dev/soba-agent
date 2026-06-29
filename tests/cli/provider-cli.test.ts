/**
 * Tests for `soba provider <subcommand>` — Phase 2.5 B1c.
 *
 * The CLI module is a pure-function layer over `ProviderRegistry` and
 * `I18n`, so each test runs in an isolated temp directory and uses
 * fresh instances of both. The shape we cover:
 *
 *   1. argv parser (positional vs flag vs `--key=value` vs boolean)
 *   2. `list` — built-ins + customs, active marker, keyless badge
 *   3. `add` — minimal flags, full flags, --from-file JSON, --set-active
 *   4. `add` validation — duplicate id, missing base-url, bad adapter,
 *      empty model list, defaultModel not in models, malformed JSON,
 *      missing file, keyless (api-key-env empty)
 *   5. `remove` — custom OK, built-in rejected, unknown id rejected
 *   6. `remove` — persist rollback restores the in-memory state
 *   7. `use` — switches active model, persists
 *   8. `show` — JSON dump
 *   9. `help` / unknown subcommand
 *  10. round-trip: add → persistConfig → loadFromFile → add/remove on
 *      a NEW registry sees the persisted definition
 *  11. exit codes: 0 / 1 / 2
 *  12. i18n: every error path renders in ru and zh
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "../../src/application/providers/types";
import { ProviderCliError, parseProviderCliArgs, runProviderCli } from "../../src/apps/cli/provider-cli";
import { ProviderRegistry } from "../../src/infrastructure/llm/providers/registry";
import { I18n } from "../../src/shared/i18n/i18n";
import type { Locale } from "../../src/shared/i18n/types";

// ─── Fixtures ───

let workDir: string;
let configPath: string;

function makeRegistry(): ProviderRegistry {
  const reg = new ProviderRegistry(undefined, { configPath });
  // Many CLI tests reference providers that aren't in the slim
  // BUILTIN list (OpenAI, Anthropic, Ollama). Add them as custom
  // providers with a small catalogue so `provider list` /
  // `provider remove openai` keep their original shape.
  reg.addProvider({
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    adapter: "openai",
    defaultModel: "gpt-4o",
    models: [
      { id: "gpt-4o", name: "GPT-4o", contextWindow: 128000, maxOutput: 16384, supportsStreaming: true, supportsThinking: false },
      { id: "gpt-4o-mini", name: "GPT-4o mini", contextWindow: 128000, maxOutput: 16384, supportsStreaming: true, supportsThinking: false },
    ],
  });
  reg.addProvider({
    id: "ollama",
    name: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    apiKeyEnv: null,
    adapter: "openai",
    defaultModel: "llama3",
    models: [
      { id: "llama3", name: "Llama 3", contextWindow: 8192, maxOutput: 4096, supportsStreaming: true, supportsThinking: false },
    ],
  });
  reg.addProvider({
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    adapter: "anthropic",
    defaultModel: "claude-sonnet-4",
    models: [
      { id: "claude-sonnet-4", name: "Claude Sonnet 4", contextWindow: 200000, maxOutput: 64000, supportsStreaming: true, supportsThinking: true },
    ],
  });
  return reg;
}

function makeI18n(locale: Locale = "en"): I18n {
  return new I18n(locale);
}

/** Minimal valid custom provider definition used by the round-trip tests. */
const sampleProvider: ProviderDefinition = {
  id: "my-llm",
  name: "My LLM",
  baseUrl: "https://api.example.com/v1",
  apiKeyEnv: "MY_LLM_KEY",
  adapter: "openai",
  defaultModel: "my-llm-7b",
  models: [
    { id: "my-llm-7b", name: "My LLM 7B", contextWindow: 16_000, maxOutput: 4_000, supportsStreaming: true, supportsThinking: false },
    { id: "my-llm-13b", name: "My LLM 13B", contextWindow: 16_000, maxOutput: 4_000, supportsStreaming: true, supportsThinking: false },
  ],
};

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "soba-provider-cli-"));
  configPath = join(workDir, "config.json");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// ─── argv parser ───

describe("parseProviderCliArgs", () => {
  test("captures positional arguments and stops at the first flag", () => {
    const opts = parseProviderCliArgs(["my-llm", "--base-url", "https://x"]);
    expect(opts.positional).toEqual(["my-llm"]);
    expect(opts.flags["base-url"]).toBe("https://x");
  });

  test("parses --key=value form", () => {
    const opts = parseProviderCliArgs(["add", "my-llm", "--base-url=https://x", "--set-active"]);
    expect(opts.positional).toEqual(["add", "my-llm"]);
    expect(opts.flags["base-url"]).toBe("https://x");
    expect(opts.flags["set-active"]).toBe(true);
  });

  test("boolean flag is true when no value follows", () => {
    const opts = parseProviderCliArgs(["add", "my-llm", "--set-active"]);
    expect(opts.flags["set-active"]).toBe(true);
  });

  test("repeated --model flag accumulates in declaration order", () => {
    const opts = parseProviderCliArgs([
      "add",
      "my-llm",
      "--model",
      "a,A,100,200",
      "--model",
      "b,B,200,300",
    ]);
    expect(opts.flags["model"]).toEqual(["a,A,100,200", "b,B,200,300"]);
  });

  test("empty argv yields empty options", () => {
    expect(parseProviderCliArgs([])).toEqual({ positional: [], flags: {} });
  });
});

// ─── list ───

describe("provider list", () => {
  test("prints built-ins with active marker and shows custom after add", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    reg.addProvider(sampleProvider);

    const result = await runProviderCli("list", { positional: [], flags: {} }, reg, i18n);
    expect(result.exitCode).toBe(0);
    expect(result.changed).toBe(false);
    expect(result.stdout.length).toBeGreaterThan(0);
    // Active marker shows the built-in DeepSeek (default first builtin).
    expect(result.stdout[0]).toMatch(/DeepSeek/);
    // OpenAI is a custom provider (added in makeRegistry) and must
    // appear in the list — somewhere in the body, not the header.
    expect(result.stdout.some((l) => l.includes("OpenAI"))).toBe(true);
    // The custom provider is included with the "custom" tag.
    expect(result.stdout.some((l) => l.includes("my-llm"))).toBe(true);
    expect(result.stdout.some((l) => l.includes("custom"))).toBe(true);
  });

  test("keyless providers render the (keyless) badge in their row", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    reg.addProvider({ ...sampleProvider, apiKeyEnv: null, id: "local", name: "Local LLM" });
    const result = await runProviderCli("list", { positional: [], flags: {} }, reg, i18n);
    expect(result.stdout.some((l) => l.includes("local") && l.includes("(keyless)"))).toBe(true);
  });
});

// ─── add ───

describe("provider add (flags)", () => {
  test("minimal flags succeed and the provider is reachable", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli(
      "add",
      {
        positional: ["my-llm"],
        flags: {
          "base-url": "https://api.example.com/v1",
          "api-key-env": "MY_LLM_KEY",
          "default-model": "my-llm-7b",
          model: "my-llm-7b,My LLM 7B,16384,4096",
        },
      },
      reg,
      i18n,
    );
    expect(result.exitCode).toBe(0);
    expect(result.changed).toBe(true);
    expect(reg.getProvider("my-llm")).toBeDefined();
    expect(reg.getProvider("my-llm")?.custom).toBe(true);
    expect(reg.getProvider("my-llm")?.defaultModel).toBe("my-llm-7b");
  });

  test("--set-active switches the active selection to the new default model", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli(
      "add",
      {
        positional: ["my-llm"],
        flags: {
          "base-url": "https://api.example.com/v1",
          "api-key-env": "MY_LLM_KEY",
          "default-model": "my-llm-7b",
          model: "my-llm-7b,My LLM 7B,16384,4096",
          "set-active": true,
        },
      },
      reg,
      i18n,
    );
    expect(result.exitCode).toBe(0);
    expect(reg.getActiveProvider().id).toBe("my-llm");
    expect(reg.getActiveModel().id).toBe("my-llm-7b");
  });

  test("empty --api-key-env is treated as a keyless provider", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli(
      "add",
      {
        positional: ["local-llm"],
        flags: {
          "base-url": "http://127.0.0.1:11434/v1",
          "api-key-env": "",
          "default-model": "llama3",
          model: "llama3,Llama 3,8192,4096",
        },
      },
      reg,
      i18n,
    );
    expect(result.exitCode).toBe(0);
    expect(reg.getProvider("local-llm")?.apiKeyEnv).toBeNull();
  });

  test("multiple --model flags register all models", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli(
      "add",
      {
        positional: ["corp"],
        flags: {
          "base-url": "https://corp.example.com/v1",
          "api-key-env": "CORP_KEY",
          "default-model": "corp-7b",
          // Two --model flags in sequence; the parser accumulates them into
          // a string[] and the handler reads every entry.
          model: ["corp-7b,Corp 7B,16384,4096", "corp-13b,Corp 13B,16384,4096"],
        },
      },
      reg,
      i18n,
    );
    expect((result as { exitCode: number }).exitCode).toBe(0);
    expect(reg.getProvider("corp")?.models?.length).toBe(2);
  });
});

// ─── add validation ───

describe("provider add validation", () => {
  const baseFlags = {
    positional: ["my-llm"] as string[],
    flags: {
      "base-url": "https://api.example.com/v1",
      "api-key-env": "MY_LLM_KEY",
      "default-model": "my-llm-7b",
      model: "my-llm-7b,My LLM 7B,16384,4096",
    },
  };

  test("missing id returns missing-args and does not mutate the registry", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli("add", { positional: [], flags: baseFlags.flags }, reg, i18n);
    expect(result.exitCode).toBe(1);
    expect(result.changed).toBe(false);
    expect(result.stderr.length).toBe(1);
    expect(reg.getAllProviders().every((p) => p.id !== "")).toBe(true);
  });

  test("missing --base-url is rejected with a clear message", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const { "base-url": _unused, ...flags } = baseFlags.flags;
    const result = await runProviderCli("add", { positional: ["my-llm"], flags }, reg, i18n);
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toContain("base-url");
    expect(reg.getProvider("my-llm")).toBeUndefined();
  });

  test("invalid --adapter is rejected (only openai | anthropic are supported)", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli(
      "add",
      { positional: ["my-llm"], flags: { ...baseFlags.flags, adapter: "magic" } },
      reg,
      i18n,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toMatch(/adapter/i);
  });

  test("no --model and no --from-file is rejected", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const { model: _m, "default-model": _d, ...flags } = baseFlags.flags;
    const result = await runProviderCli("add", { positional: ["my-llm"], flags }, reg, i18n);
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toMatch(/model/i);
  });

  test("--default-model not present in --model list is rejected", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli(
      "add",
      { positional: ["my-llm"], flags: { ...baseFlags.flags, "default-model": "unknown" } },
      reg,
      i18n,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toMatch(/default model/i);
  });

  test("duplicate id (built-in collision) is rejected with a clear code", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli(
      "add",
      { positional: ["openai"], flags: { ...baseFlags.flags } },
      reg,
      i18n,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toMatch(/openai/);
  });

  test("duplicates against an existing custom provider are also rejected", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    reg.addProvider(sampleProvider);
    const result = await runProviderCli(
      "add",
      { positional: ["my-llm"], flags: { ...baseFlags.flags } },
      reg,
      i18n,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toMatch(/already exists/i);
  });

  test("malformed JSON in --from-file is rejected with a parse error", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const file = join(workDir, "bad.json");
    writeFileSync(file, "{ this is not json");
    const result = await runProviderCli(
      "add",
      { positional: ["my-llm"], flags: { "from-file": file } },
      reg,
      i18n,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toMatch(/json|parse/i);
  });

  test("missing --from-file path is reported as an IO error", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli(
      "add",
      { positional: ["my-llm"], flags: { "from-file": join(workDir, "missing.json") } },
      reg,
      i18n,
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr[0]).toMatch(/read|cannot|no such/i);
  });

  test("--from-file JSON missing required fields is rejected with shape error", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const file = join(workDir, "partial.json");
    writeFileSync(file, JSON.stringify({ id: "x" }));
    const result = await runProviderCli(
      "add",
      { positional: ["x"], flags: { "from-file": file } },
      reg,
      i18n,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toMatch(/shape|valid/i);
  });
});

// ─── add round-trip via --from-file ───

describe("provider add --from-file round-trip", () => {
  test("loads a fully-formed definition and persists it", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const file = join(workDir, "corp.json");
    writeFileSync(file, JSON.stringify(sampleProvider, null, 2));
    const result = await runProviderCli(
      "add",
      { positional: [sampleProvider.id], flags: { "from-file": file } },
      reg,
      i18n,
    );
    expect(result.exitCode).toBe(0);
    expect(reg.getProvider(sampleProvider.id)).toBeDefined();
    // Persist: a NEW registry loading the same file should see the provider.
    const reloaded = await ProviderRegistry.loadFromFile(configPath);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.customProviders[sampleProvider.id]).toBeDefined();
    expect((reloaded!.customProviders[sampleProvider.id] as { models: unknown[] }).models.length).toBe(2);
  });
});

// ─── remove ───

describe("provider remove", () => {
  test("removes a custom provider and persists the change", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    reg.addProvider(sampleProvider);
    const result = await runProviderCli("remove", { positional: ["my-llm"], flags: {} }, reg, i18n);
    expect(result.exitCode).toBe(0);
    expect(result.changed).toBe(true);
    expect(reg.getProvider("my-llm")).toBeUndefined();
    const reloaded = await ProviderRegistry.loadFromFile(configPath);
    expect(reloaded?.customProviders["my-llm"]).toBeUndefined();
  });

  test("rejects removal of a built-in provider with code 'builtin-immutable'", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    // After B1d, OpenAI is registered as a custom provider in
    // makeRegistry, so we use a real built-in (DeepSeek) to test the
    // immutability guard.
    const result = await runProviderCli("remove", { positional: ["deepseek"], flags: {} }, reg, i18n);
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toMatch(/built-in|immutable|cannot be removed/i);
    expect(reg.getProvider("openai")).toBeDefined();
  });

  test("rejects unknown id with code 'unknown-id'", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli("remove", { positional: ["ghost"], flags: {} }, reg, i18n);
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toMatch(/not found/i);
  });

  test("missing id is a missing-args error", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli("remove", { positional: [], flags: {} }, reg, i18n);
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toMatch(/missing|usage/i);
  });
});

// ─── use ───

describe("provider use", () => {
  test("switches the active selection to a provider's default model and persists", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    reg.addProvider(sampleProvider);
    // Active is initially openai/gpt-4o.
    const result = await runProviderCli("use", { positional: ["my-llm"], flags: {} }, reg, i18n);
    expect(result.exitCode).toBe(0);
    expect(result.changed).toBe(true);
    expect(reg.getActiveProvider().id).toBe("my-llm");
    expect(reg.getActiveModel().id).toBe("my-llm-7b");
    const reloaded = await ProviderRegistry.loadFromFile(configPath);
    expect(reloaded?.defaultProvider).toBe("my-llm");
    expect(reloaded?.defaultModel).toBe("my-llm-7b");
  });

  test("unknown id in 'use' is rejected", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli("use", { positional: ["ghost"], flags: {} }, reg, i18n);
    expect(result.exitCode).toBe(1);
  });
});

// ─── show ───

describe("provider show", () => {
  test("prints a JSON definition for a known provider", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    reg.addProvider(sampleProvider);
    const result = await runProviderCli("show", { positional: ["my-llm"], flags: {} }, reg, i18n);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout[0]);
    expect(parsed.id).toBe("my-llm");
    expect(parsed.models.length).toBe(2);
  });

  test("unknown id in 'show' is rejected", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli("show", { positional: ["ghost"], flags: {} }, reg, i18n);
    expect(result.exitCode).toBe(1);
  });
});

// ─── help / unknown ───

describe("provider help and unknown subcommand", () => {
  test("help prints the subcommand summary", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli("help", { positional: [], flags: {} }, reg, i18n);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.join("\n")).toMatch(/list|add|remove/);
  });

  test("unknown subcommand returns exit code 1 with a translated message", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    const result = await runProviderCli("wat", { positional: [], flags: {} }, reg, i18n);
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toMatch(/wat/);
  });
});

// ─── i18n ───

describe("provider CLI i18n", () => {
  test("errors render in Russian", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n("ru");
    // deepseek is a real built-in; the Russian error should mention
    // built-in / immutable in Russian.
    const result = await runProviderCli("remove", { positional: ["deepseek"], flags: {} }, reg, i18n);
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toMatch(/встроен|не может/i);
  });

  test("errors render in Chinese", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n("zh");
    const result = await runProviderCli("remove", { positional: ["deepseek"], flags: {} }, reg, i18n);
    expect(result.exitCode).toBe(1);
    // Chinese error should mention built-in / immutable in Chinese.
    expect(result.stderr[0]).toMatch(/内置|无法删除/);
  });

  test("list output uses the active language's tag labels", async () => {
    const reg = makeRegistry();
    reg.addProvider(sampleProvider);
    const ru = await runProviderCli("list", { positional: [], flags: {} }, reg, makeI18n("ru"));
    expect(ru.stdout.some((l) => l.includes("пользов."))).toBe(true);
    const zh = await runProviderCli("list", { positional: [], flags: {} }, reg, makeI18n("zh"));
    expect(zh.stdout.some((l) => l.includes("自定义"))).toBe(true);
  });
});

// ─── ProviderCliError surface ───

describe("ProviderCliError", () => {
  test("exposes a stable code and message", () => {
    const e = new ProviderCliError("validation", "nope");
    expect(e.code).toBe("validation");
    expect(e.message).toBe("nope");
    expect(e.name).toBe("ProviderCliError");
  });
});

// ─── Persist rollback (defensive) ───

describe("provider CLI persist rollback", () => {
  test("if persistConfig fails after add, the in-memory state is rolled back", async () => {
    const reg = makeRegistry();
    const i18n = makeI18n();
    // Sabotage the registry by pointing its config path at a directory.
    // persistConfig() will try to mkdir the parent and fail.
    const dirAsFile = join(workDir, "iam-a-dir");
    require("node:fs").mkdirSync(dirAsFile);
    // Override the registry's path through reflection? Easier: replace
    // persistConfig with a throwing stub.
    const original = reg.persistConfig.bind(reg);
    reg.persistConfig = async () => {
      throw new Error("simulated disk full");
    };
    try {
      const result = await runProviderCli(
        "add",
        {
          positional: ["my-llm"],
          flags: {
            "base-url": "https://api.example.com/v1",
            "api-key-env": "MY_LLM_KEY",
            "default-model": "my-llm-7b",
            model: "my-llm-7b,My LLM 7B,16384,4096",
          },
        },
        reg,
        i18n,
      );
      expect(result.exitCode).toBe(2);
      expect(result.stderr[0]).toMatch(/persist|disk/i);
      // The in-memory addition was rolled back.
      expect(reg.getProvider("my-llm")).toBeUndefined();
    } finally {
      reg.persistConfig = original;
    }
    // Reference dirAsFile so eslint doesn't complain about unused var.
    expect(dirAsFile).toContain("iam-a-dir");
  });
});
