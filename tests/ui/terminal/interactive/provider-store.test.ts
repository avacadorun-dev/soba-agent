import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenResponsesClientProxy } from "../../../../src/infrastructure/llm/providers/client-proxy";
import { ProviderRegistry } from "../../../../src/infrastructure/llm/providers/registry";
import { I18n } from "../../../../src/shared/i18n/i18n";
import { ProviderStore } from "../../../../src/ui/terminal/interactive/model/provider-store";

let configPath: string;

beforeAll(() => {
  configPath = join(mkdtempSync(join(tmpdir(), "soba-store-")), "config.json");
});

afterAll(() => {
  // Remove the parent temp directory.
  rmSync(configPath.replace(/\/config\.json$/, ""), { recursive: true, force: true });
});

function makeRegistry() {
  const reg = new ProviderRegistry(undefined, { configPath });
  // Tests reference providers that aren't part of the slim BUILTIN list
  // (ollama, openai, anthropic, groq). Add them as custom keyless/keyed
  // providers so the store tests can exercise them without depending on
  // the built-in catalogue.
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
  reg.addProvider({
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    adapter: "openai",
    defaultModel: "llama3-70b",
    models: [
      { id: "llama3-70b", name: "Llama 3 70B", contextWindow: 8192, maxOutput: 4096, supportsStreaming: true, supportsThinking: false },
    ],
  });
  return reg;
}

function makeStore(registry = makeRegistry()) {
  const proxy = new OpenResponsesClientProxy(registry);
  const store = new ProviderStore({ registry, proxy, i18n: new I18n("en") });
  return { registry, proxy, store };
}

describe("ProviderStore", () => {
  let cleanup: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanup) fn();
    cleanup = [];
  });

  test("seeds active selection from the registry", () => {
    const { store } = makeStore();
    const active = store.registry.getActiveProvider();
    expect(store.activeProviderId()).toBe(active.id);
    // Built-in providers have no defaultModel — model is empty until discovery.
    expect(store.activeModelId()).toBe("");
    expect(store.isOpen()).toBe(false);
  });

  test("filteredGroups returns all providers when query is empty", () => {
    const { store } = makeStore();
    const groups = store.filteredGroups();
    expect(groups.length).toBeGreaterThan(1);
    for (const group of groups) {
      expect(group.models!.length).toBeGreaterThan(0);
    }
  });

  test("built-in providers without discovered models stay visible as disabled placeholders", () => {
    const { store } = makeStore();
    const deepseek = store.filteredGroups().find((group) => group.provider.id === "deepseek");

    expect(deepseek).toBeDefined();
    expect(deepseek?.models).toHaveLength(1);
    expect(deepseek?.models[0]).toMatchObject({
      id: "",
      selectable: false,
    });
  });

  test("setSearch filters by model id substring (case-insensitive)", () => {
    const { store } = makeStore();
    store.setSearch("GPT");
    const groups = store.filteredGroups();
    const total = groups.reduce((acc, g) => acc + (g.models?.length ?? 0), 0);
    expect(total).toBeGreaterThan(0);
    for (const group of groups) {
      for (const model of group.models ?? []) {
        const haystack = `${model.id} ${model.name}`.toLowerCase();
        expect(haystack).toContain("gpt");
      }
    }
  });

  test("setSearch filters by provider name and keeps provider models", () => {
    const { store } = makeStore();
    store.setSearch("Anthropic");
    const groups = store.filteredGroups();
    expect(groups.map((group) => group.provider.id)).toEqual(["anthropic"]);
    expect(groups[0]?.models.map((model) => model.id)).toEqual(["claude-sonnet-4"]);
  });

  test("setSearch resets highlightedIndex to 0", () => {
    const { store } = makeStore();
    store.setHighlight(5);
    store.setSearch("claude");
    expect(store.highlightedIndex()).toBe(0);
  });

  test("flatEntries matches the cross-product of filtered groups", () => {
    const { store } = makeStore();
    const groups = store.filteredGroups();
    const expected = groups.flatMap((g) =>
      (g.models ?? []).map((m) => ({ providerId: g.provider.id, modelId: m.id })),
    );
    const actual = store.flatEntries().map((e) => ({ providerId: e.providerId, modelId: e.modelId }));
    expect(actual).toEqual(expected);
  });

  test("moveHighlight wraps around the list", () => {
    const { store } = makeStore();
    const length = store.flatEntries().length;
    expect(length).toBeGreaterThan(1);

    store.moveHighlight(1);
    expect(store.highlightedIndex()).toBe(1);

    store.moveHighlight(-1);
    expect(store.highlightedIndex()).toBe(0);

    // Wrap to last.
    store.moveHighlight(-1);
    expect(store.highlightedIndex()).toBe(length - 1);

    // Wrap back to first.
    store.moveHighlight(1);
    expect(store.highlightedIndex()).toBe(0);
  });

  test("open() clears the search and shows the overlay", () => {
    const { store } = makeStore();
    store.setSearch("abc");
    store.open();
    expect(store.isOpen()).toBe(true);
    expect(store.searchQuery()).toBe("");
    expect(store.highlightedIndex()).toBe(0);
  });

  test("close() hides the overlay but keeps the active selection intact", () => {
    const { store } = makeStore();
    const providerId = store.activeProviderId();
    const modelId = store.activeModelId();
    store.open();
    store.close();
    expect(store.isOpen()).toBe(false);
    expect(store.activeProviderId()).toBe(providerId);
    expect(store.activeModelId()).toBe(modelId);
  });

  test("toggle() flips the open state", () => {
    const { store } = makeStore();
    expect(store.isOpen()).toBe(false);
    store.toggle();
    expect(store.isOpen()).toBe(true);
    store.toggle();
    expect(store.isOpen()).toBe(false);
  });

  test("select() with explicit ids switches provider/model and closes overlay", () => {
    const { store, registry } = makeStore();
    const deepseek = registry.getProvider("deepseek");
    if (!deepseek) throw new Error("deepseek missing from built-ins");
    // Built-in providers have no hard-coded model catalogue.
    // Any valid-looking model id is accepted as a synthetic entry.
    const status = store.select("deepseek", "deepseek-chat");
    expect(status.kind).toBe("switched");
    expect(store.activeProviderId()).toBe("deepseek");
    expect(store.activeModelId()).toBe("deepseek-chat");
    expect(store.isOpen()).toBe(false);
  });

  test("select() on a disabled discovery placeholder is a no-op", () => {
    const { store } = makeStore();
    store.open();

    const status = store.select();

    expect(status.kind).toBe("idle");
    expect(store.activeProviderId()).toBe("deepseek");
    expect(store.activeModelId()).toBe("");
    expect(store.isOpen()).toBe(true);
  });

  test("select() with explicit ids switches and returns switched status", () => {
    const { store, registry } = makeStore();
    const groq = registry.getProvider("groq");
    if (!groq) throw new Error("groq missing from built-ins");
    const target = groq.models![0];
    const status = store.select("groq", target.id);
    expect(status.kind).toBe("switched");
    expect(store.activeProviderId()).toBe("groq");
    expect(store.activeModelId()).toBe(target.id);
  });

  test("select() with unknown provider returns a failed status and leaves state untouched", () => {
    const { store } = makeStore();
    const before = { providerId: store.activeProviderId(), modelId: store.activeModelId() };
    const status = store.select("nope-provider", "nope-model");
    expect(status.kind).toBe("failed");
    if (status.kind === "failed") {
      expect(status.message.toLowerCase()).toContain("unknown");
    }
    expect(store.activeProviderId()).toBe(before.providerId);
    expect(store.activeModelId()).toBe(before.modelId);
  });

  test("select() with known provider but unknown model returns failed", () => {
    const { store } = makeStore();
    const before = store.activeModelId();
    const status = store.select("openai", "gpt-9000");
    expect(status.kind).toBe("failed");
    expect(store.activeModelId()).toBe(before);
  });

  test("select() does NOT auto-persist config (persist is the wizard's job)", async () => {
    const { store, registry } = makeStore();
    const target = registry.getProvider("ollama");
    if (!target) throw new Error("ollama missing");
    store.select("ollama", target.defaultModel);
    // select() updates in-memory state but does NOT call persistConfig().
    // Persistence is handled by firstTimeSetup only (per Issue 3/5 fix).
    await new Promise((resolve) => setTimeout(resolve, 50));
    const onDisk = await ProviderRegistry.loadFromFile(configPath);
    // Disk should NOT have changed because select() does not persist.
    expect(onDisk).toBeNull();
  });

  test("proxy.onChange is forwarded to the store signals", () => {
    const { store, proxy, registry } = makeStore();
    const ok = registry.setActive("ollama", "llama3");
    expect(ok).toBe(true);
    const fired = proxy.notifyChange();
    expect(fired).toBe(true);
    expect(store.activeProviderId()).toBe("ollama");
    expect(store.activeModelId()).toBe("llama3");
  });

  test("dispose() unsubscribes from proxy.onChange", () => {
    const { store, proxy, registry } = makeStore();
    const beforeDispose = store.activeProviderId();
    store.dispose();
    const ok = registry.setActive("ollama", "llama3");
    expect(ok).toBe(true);
    proxy.notifyChange();
    // After dispose, signals should not be updated by proxy changes.
    // (activeProviderId still holds whatever it was before dispose.)
    expect(store.activeProviderId()).toBe(beforeDispose);
  });

  test("activeLabel reflects the active provider/model name", () => {
    const { store, registry } = makeStore();
    const provider = registry.getProvider("ollama");
    if (!provider) throw new Error("ollama missing");
    store.select("ollama", provider.defaultModel);
    const model = registry.getModel("ollama", provider.defaultModel!);
    if (!model) throw new Error("ollama default model missing");
    expect(store.activeLabel()).toBe(`${provider.name} / ${model.name}`);
  });

  test("activeEntry exposes model metadata for the selector header", () => {
    const { store, registry } = makeStore();
    const provider = registry.getProvider("ollama");
    if (!provider) throw new Error("ollama missing");

    store.select("ollama", "llama3");

    expect(store.activeEntry()).toMatchObject({
      providerId: "ollama",
      modelId: "llama3",
      providerName: "Ollama (local)",
      modelName: "Llama 3",
      contextWindow: 8192,
      maxOutput: 4096,
      supportsStreaming: true,
      supportsThinking: false,
    });
  });

  test("t() returns a translated string for known keys", () => {
    const { store } = makeStore();
    const title = store.t("tui.modelSelector.title");
    expect(title.length).toBeGreaterThan(0);
    expect(title).not.toContain("{");
  });

  test("i18n defaults to English when no instance is provided", () => {
    const registry = new ProviderRegistry(undefined, { configPath });
    const proxy = new OpenResponsesClientProxy(registry);
    const store = new ProviderStore({ registry, proxy });
    expect(store.t("tui.modelSelector.title")).toContain("Select");
  });

  // ─── Custom provider coverage (B1c) ───────────────────────────────────

  test("custom providers appear in filteredGroups()", () => {
    const { store, registry } = makeStore();
    registry.addProvider({
      id: "corp-llm",
      name: "Corp LLM",
      baseUrl: "https://corp.example.com/v1",
      apiKeyEnv: "CORP_KEY",
      adapter: "openai",
      defaultModel: "corp-7b",
      models: [
        { id: "corp-7b", name: "Corp 7B", contextWindow: 16_000, maxOutput: 4_000, supportsStreaming: true, supportsThinking: false },
      ],
    });
    const groups = store.filteredGroups();
    const corp = groups.find((g) => g.provider.id === "corp-llm");
    expect(corp).toBeDefined();
    expect(corp?.provider?.custom).toBe(true);
    expect(corp?.models?.length).toBe(1);
  });

  test("custom providers are reachable via select() and activeLabel updates", () => {
    const { store, registry } = makeStore();
    registry.addProvider({
      id: "corp-llm",
      name: "Corp LLM",
      baseUrl: "https://corp.example.com/v1",
      apiKeyEnv: "CORP_KEY",
      adapter: "openai",
      defaultModel: "corp-7b",
      models: [
        { id: "corp-7b", name: "Corp 7B", contextWindow: 16_000, maxOutput: 4_000, supportsStreaming: true, supportsThinking: false },
      ],
    });
    const status = store.select("corp-llm", "corp-7b");
    expect(status.kind).toBe("switched");
    expect(store.activeProviderId()).toBe("corp-llm");
    expect(store.activeModelId()).toBe("corp-7b");
    expect(store.activeLabel()).toBe("Corp LLM / Corp 7B");
  });

  test("removeProvider() drops a custom provider from filteredGroups()", () => {
    const { store, registry } = makeStore();
    registry.addProvider({
      id: "transient",
      name: "Transient",
      baseUrl: "https://t.example.com/v1",
      apiKeyEnv: "T_KEY",
      adapter: "openai",
      defaultModel: "t-1",
      models: [
        { id: "t-1", name: "T-1", contextWindow: 8_000, maxOutput: 4_000, supportsStreaming: true, supportsThinking: false },
      ],
    });
    expect(store.filteredGroups().some((g) => g.provider.id === "transient")).toBe(true);
    expect(registry.removeProvider("transient")).toBe(true);
    expect(store.filteredGroups().some((g) => g.provider.id === "transient")).toBe(false);
  });

  test("search by custom provider name finds its models", () => {
    const { store, registry } = makeStore();
    registry.addProvider({
      id: "corp-llm",
      name: "Corp LLM",
      baseUrl: "https://corp.example.com/v1",
      apiKeyEnv: "CORP_KEY",
      adapter: "openai",
      defaultModel: "corp-7b",
      models: [
        { id: "corp-7b", name: "Corp 7B", contextWindow: 16_000, maxOutput: 4_000, supportsStreaming: true, supportsThinking: false },
      ],
    });
    store.setSearch("Corp");
    const groups = store.filteredGroups();
    expect(groups.length).toBe(1);
    expect(groups[0]?.provider.id).toBe("corp-llm");
  });
});
