import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSobaRuntime } from "../../src/application/runtime-factory";
import type { ResponseResource, StreamingEvent } from "../../src/core/client/types";
import { DEFAULT_COMPACTION_CONFIG } from "../../src/core/compaction/trigger-policy";
import type { SobaConfig } from "../../src/core/config/types";
import { SessionManager } from "../../src/core/session/session-manager";

let testHome: string;
let projectRoot: string;
let previousHome: string | undefined;
let previousBundledSkillsPath: string | undefined;

function registryConfigPath(): string {
  return join(testHome, ".soba", "config.json");
}

function makeConfig(): SobaConfig {
  return {
    baseUrl: "https://api.example.test/v1",
    apiKey: "fake-api-key",
    model: "test-model",
    maxOutputTokens: 1024,
    contextWindow: 32_000,
    maxCompletionTokens: 0,
    temperature: 0.7,
    maxAgentIterations: 3,
    maxStalledIterations: 2,
    maxRunMinutes: 1,
    bashMaxTimeoutSeconds: 30,
    sessionDir: "",
    lang: "en",
    theme: "graphite",
    compaction: { ...DEFAULT_COMPACTION_CONFIG, auto: false },
  };
}

function makeTextResponse(text: string): ResponseResource {
  return {
    id: "resp_runtime_factory",
    object: "response",
    created_at: Date.now(),
    completed_at: Date.now(),
    status: "completed",
    incomplete_details: null,
    model: "test-model",
    previous_response_id: null,
    instructions: null,
    output: [
      {
        type: "message",
        id: "msg_runtime_factory",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
        phase: "final_answer",
      },
    ],
    error: null,
    tools: [],
    tool_choice: "auto",
    truncation: "disabled",
    parallel_tool_calls: true,
    text: {},
    top_p: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
    top_logprobs: 0,
    temperature: 1,
    reasoning: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    max_output_tokens: null,
    max_tool_calls: null,
    store: false,
    background: false,
    service_tier: "default",
    metadata: {},
    safety_identifier: null,
    prompt_cache_key: null,
  };
}

beforeEach(() => {
  testHome = join(tmpdir(), `soba-runtime-home-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  projectRoot = join(tmpdir(), `soba-runtime-project-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  previousHome = process.env.HOME;
  previousBundledSkillsPath = process.env.SOBA_BUNDLED_SKILLS_PATH;
  process.env.HOME = testHome;
  process.env.SOBA_BUNDLED_SKILLS_PATH = join(projectRoot, "missing-skills");
});

afterEach(() => {
  if (previousHome) process.env.HOME = previousHome;
  else delete process.env.HOME;
  if (previousBundledSkillsPath) process.env.SOBA_BUNDLED_SKILLS_PATH = previousBundledSkillsPath;
  else delete process.env.SOBA_BUNDLED_SKILLS_PATH;
  rmSync(testHome, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("createSobaRuntime", () => {
  test("builds one shared runtime composition over the legacy AgentLoop", async () => {
    const session = SessionManager.inMemory(projectRoot);
    const composition = await createSobaRuntime({
      cwd: projectRoot,
      session,
      config: makeConfig(),
      compactionConfig: { ...DEFAULT_COMPACTION_CONFIG, auto: false },
      interactive: false,
      modelExplicitlyPassed: true,
      noStream: true,
      stream: false,
      tokenBudget: 0,
      debug: false,
      providerRegistryConfigPath: registryConfigPath(),
    });

    const events: string[] = [];
    composition.runtime.onEvent((event) => events.push(event.type));
    composition.client.create = async () => makeTextResponse("runtime ok");
    const acpSession = await composition.runtime.createSession({ cwd: projectRoot });

    const result = await composition.runtime.runTurn({
      sessionId: acpSession.id,
      source: "acp",
      content: [{ type: "text", text: "hello" }],
    });

    expect(composition.agentLoop.getSessionManager()).not.toBe(session);
    expect(acpSession.id).not.toBe(session.getSessionId());
    expect(composition.agentLoop.getSessionManager().getSessionId()).toBe(acpSession.id);
    expect(composition.agentLoop.getSessionManager().getSessionFile()).toBeTruthy();
    expect(existsSync(composition.agentLoop.getSessionManager().getSessionFile() ?? "")).toBe(true);
    expect(composition.tools.getNames()).toContain("read");
    expect(composition.runtime.listCommands({ surface: "acp" }).map((command) => command.name)).toContain("/session");
    expect(result.response.id).toBe("resp_runtime_factory");
    expect(events).toContain("turn_start");
    expect(events).toContain("turn_end");
  });

  test("uses provider streaming for non-interactive ACP runtime turns when enabled", async () => {
    const session = SessionManager.inMemory(projectRoot);
    const composition = await createSobaRuntime({
      cwd: projectRoot,
      session,
      config: makeConfig(),
      compactionConfig: { ...DEFAULT_COMPACTION_CONFIG, auto: false },
      interactive: false,
      modelExplicitlyPassed: true,
      noStream: false,
      stream: true,
      tokenBudget: 0,
      debug: false,
      providerRegistryConfigPath: registryConfigPath(),
    });
    const finalResponse = makeTextResponse("hello");
    const finalMessage = finalResponse.output[0];
    if (!finalMessage || finalMessage.type !== "message") {
      throw new Error("Expected test response to contain an assistant message.");
    }
    const streamEvents: StreamingEvent[] = [
      { type: "response.created", response: { ...finalResponse, output: [], status: "in_progress" } },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          id: finalMessage.id,
          status: "in_progress",
          role: "assistant",
          content: [],
        },
      },
      { type: "response.output_text.delta", item_id: finalMessage.id, output_index: 0, content_index: 0, delta: "hel" },
      { type: "response.output_text.delta", item_id: finalMessage.id, output_index: 0, content_index: 0, delta: "lo" },
      { type: "response.output_item.done", output_index: 0, item: finalMessage },
      { type: "response.completed", response: finalResponse },
    ];
    let createCalled = false;
    let createStreamCalled = false;
    composition.client.create = async () => {
      createCalled = true;
      return finalResponse;
    };
    composition.client.createStream = async function* () {
      createStreamCalled = true;
      for (const event of streamEvents) yield event;
    };

    const textDeltas: string[] = [];
    composition.runtime.onEvent((event) => {
      if (event.type === "assistant_text_delta") textDeltas.push(event.delta);
    });
    const acpSession = await composition.runtime.createSession({ cwd: projectRoot });
    await composition.runtime.runTurn({
      sessionId: acpSession.id,
      source: "acp",
      content: [{ type: "text", text: "hello" }],
    });

    expect(createStreamCalled).toBe(true);
    expect(createCalled).toBe(false);
    expect(textDeltas).toEqual(["hel", "lo"]);
  });

  test("loads persisted ACP sessions into the active AgentLoop session", async () => {
    const firstComposition = await createSobaRuntime({
      cwd: projectRoot,
      session: SessionManager.inMemory(projectRoot),
      config: makeConfig(),
      compactionConfig: { ...DEFAULT_COMPACTION_CONFIG, auto: false },
      interactive: false,
      modelExplicitlyPassed: true,
      noStream: true,
      stream: false,
      tokenBudget: 0,
      debug: false,
      providerRegistryConfigPath: registryConfigPath(),
    });
    firstComposition.client.create = async () => makeTextResponse("persisted answer");
    const persistedSession = await firstComposition.runtime.createSession({ cwd: projectRoot });
    await firstComposition.runtime.runTurn({
      sessionId: persistedSession.id,
      source: "acp",
      content: [{ type: "text", text: "remember me" }],
    });

    const secondComposition = await createSobaRuntime({
      cwd: projectRoot,
      session: SessionManager.inMemory(projectRoot),
      config: makeConfig(),
      compactionConfig: { ...DEFAULT_COMPACTION_CONFIG, auto: false },
      interactive: false,
      modelExplicitlyPassed: true,
      noStream: true,
      stream: false,
      tokenBudget: 0,
      debug: false,
      providerRegistryConfigPath: registryConfigPath(),
    });
    secondComposition.client.create = async () => makeTextResponse("loaded answer");

    const snapshot = await secondComposition.runtime.loadSession({ sessionId: persistedSession.id });
    expect(snapshot.info.id).toBe(persistedSession.id);
    expect(snapshot.entries.length).toBeGreaterThan(0);
    expect(secondComposition.agentLoop.getSessionManager().getSessionId()).toBe(persistedSession.id);

    const result = await secondComposition.runtime.runTurn({
      sessionId: persistedSession.id,
      source: "acp",
      content: [{ type: "text", text: "continue" }],
    });
    expect(result.response.id).toBe("resp_runtime_factory");
  });

  test("passes flat config apiKey into the active provider client", async () => {
    const session = SessionManager.inMemory(projectRoot);
    const composition = await createSobaRuntime({
      cwd: projectRoot,
      session,
      config: makeConfig(),
      compactionConfig: { ...DEFAULT_COMPACTION_CONFIG, auto: false },
      interactive: false,
      modelExplicitlyPassed: true,
      noStream: true,
      stream: false,
      tokenBudget: 0,
      debug: false,
      providerRegistryConfigPath: registryConfigPath(),
    });

    expect(composition.client.getConfig().apiKey).toBe("fake-api-key");
  });

  test("falls back to a configured provider with credentials when the active provider has no key", async () => {
    const registry = {
      defaultProvider: "missing-key-provider",
      defaultModel: "missing-model",
      providers: {
        "usable-provider": { apiKey: "usable-api-key" },
      },
      customProviders: {
        "missing-key-provider": {
          id: "missing-key-provider",
          name: "Missing Key Provider",
          baseUrl: "https://missing.example.test/v1",
          apiKeyEnv: "MISSING_PROVIDER_KEY",
          adapter: "openai",
          defaultModel: "missing-model",
          models: [
            {
              id: "missing-model",
              name: "Missing Model",
              contextWindow: 128000,
              maxOutput: 8192,
              supportsStreaming: true,
              supportsThinking: false,
            },
          ],
          custom: true,
        },
        "usable-provider": {
          id: "usable-provider",
          name: "Usable Provider",
          baseUrl: "https://usable.example.test/v1",
          apiKeyEnv: "USABLE_PROVIDER_KEY",
          adapter: "openai",
          defaultModel: "usable-model",
          models: [
            {
              id: "usable-model",
              name: "Usable Model",
              contextWindow: 128000,
              maxOutput: 8192,
              supportsStreaming: true,
              supportsThinking: false,
            },
          ],
          custom: true,
        },
      },
    };
    mkdirSync(join(testHome, ".soba"), { recursive: true });
    await Bun.write(registryConfigPath(), JSON.stringify({ registry }, null, 2));

    const session = SessionManager.inMemory(projectRoot);
    const composition = await createSobaRuntime({
      cwd: projectRoot,
      session,
      config: {
        ...makeConfig(),
        apiKey: "",
        baseUrl: "https://missing.example.test/v1",
        model: "missing-model",
        registry,
      },
      compactionConfig: { ...DEFAULT_COMPACTION_CONFIG, auto: false },
      interactive: false,
      modelExplicitlyPassed: false,
      noStream: true,
      stream: false,
      tokenBudget: 0,
      debug: false,
      providerRegistryConfigPath: registryConfigPath(),
    });

    expect(composition.client.getActiveProviderId()).toBe("usable-provider");
    expect(composition.client.getConfig()).toMatchObject({
      apiKey: "usable-api-key",
      baseUrl: "https://usable.example.test/v1",
      model: "usable-model",
    });
  });

  test("does not let stale flat config override an active registry provider", async () => {
    const registry = {
      defaultProvider: "second-provider",
      defaultModel: "second-model",
      providers: {
        "first-provider": { apiKey: "{" },
        "second-provider": { apiKey: "second-key" },
      },
      customProviders: {
        "first-provider": {
          id: "first-provider",
          name: "First Provider",
          baseUrl: "https://first.example.test/v1",
          apiKeyEnv: "FIRST_PROVIDER_KEY",
          adapter: "openai",
          defaultModel: "first-model",
          models: [
            {
              id: "first-model",
              name: "First Model",
              contextWindow: 64000,
              maxOutput: 8192,
              supportsStreaming: true,
              supportsThinking: false,
            },
          ],
          custom: true,
        },
        "second-provider": {
          id: "second-provider",
          name: "Second Provider",
          baseUrl: "https://second.example.test/v1",
          apiKeyEnv: "SECOND_PROVIDER_KEY",
          adapter: "openai",
          defaultModel: "second-model",
          models: [
            {
              id: "second-model",
              name: "Second Model",
              contextWindow: 128000,
              maxOutput: 16000,
              supportsStreaming: true,
              supportsThinking: true,
            },
          ],
          custom: true,
        },
      },
    };
    const session = SessionManager.inMemory(projectRoot);
    const composition = await createSobaRuntime({
      cwd: projectRoot,
      session,
      config: {
        ...makeConfig(),
        apiKey: "{",
        baseUrl: "https://first.example.test/v1",
        model: "first-model",
        registry,
      },
      compactionConfig: { ...DEFAULT_COMPACTION_CONFIG, auto: false },
      interactive: false,
      modelExplicitlyPassed: false,
      noStream: true,
      stream: false,
      tokenBudget: 0,
      debug: false,
      providerRegistryConfigPath: registryConfigPath(),
    });

    expect(composition.client.getActiveProviderId()).toBe("second-provider");
    expect(composition.client.getConfig()).toMatchObject({
      apiKey: "second-key",
      baseUrl: "https://second.example.test/v1",
      model: "second-model",
      contextWindow: 128000,
    });
  });

  test("refreshes built-in provider models and avoids image models as chat defaults", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "google/gemini-3.1-flash-image", context_window: 32768, max_output_tokens: 8192 },
            { id: "minimax/minimax-m3", context_window: 200000, max_output_tokens: 16384 },
            { id: "moonshotai/kimi-k2.7-code", context_window: 256000, max_output_tokens: 32768 },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;
    try {
      const registry = {
        defaultProvider: "openrouter",
        defaultModel: "google/gemini-3.1-flash-image",
        providers: {
          openrouter: { apiKey: "refresh-test-key" },
        },
        customProviders: {},
      };
      const session = SessionManager.inMemory(projectRoot);
      const composition = await createSobaRuntime({
        cwd: projectRoot,
        session,
        config: {
          ...makeConfig(),
          apiKey: "",
          baseUrl: "https://openrouter.ai/api/v1",
          model: "google/gemini-3.1-flash-image",
          registry,
        },
        compactionConfig: { ...DEFAULT_COMPACTION_CONFIG, auto: false },
        interactive: false,
        modelExplicitlyPassed: false,
        noStream: true,
        stream: false,
        tokenBudget: 0,
        debug: false,
        providerRegistryConfigPath: registryConfigPath(),
      });
      const runtimeSession = await composition.runtime.createSession({ cwd: projectRoot });
      const options = await composition.runtime.listSessionConfigOptions?.(runtimeSession.id);
      const modelOption = options?.find((option) => option.id === "model");

      expect(composition.client.getActiveProviderId()).toBe("openrouter");
      expect(composition.client.getConfig().model).toBe("moonshotai/kimi-k2.7-code");
      expect(modelOption?.currentValue).toBe("moonshotai/kimi-k2.7-code");
      expect(modelOption?.options.map((option) => option.value)).toEqual([
        "google/gemini-3.1-flash-image",
        "minimax/minimax-m3",
        "moonshotai/kimi-k2.7-code",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("exposes and applies provider/model session config options", async () => {
    const registry = {
      defaultProvider: "first-provider",
      defaultModel: "first-model",
      providers: {
        "first-provider": { apiKey: "first-key" },
        "second-provider": { apiKey: "second-key" },
      },
      customProviders: {
        "first-provider": {
          id: "first-provider",
          name: "First Provider",
          baseUrl: "https://first.example.test/v1",
          apiKeyEnv: "FIRST_PROVIDER_KEY",
          adapter: "openai",
          defaultModel: "first-model",
          models: [
            {
              id: "first-model",
              name: "First Model",
              contextWindow: 64000,
              maxOutput: 8192,
              supportsStreaming: true,
              supportsThinking: false,
            },
          ],
          custom: true,
        },
        "second-provider": {
          id: "second-provider",
          name: "Second Provider",
          baseUrl: "https://second.example.test/v1",
          apiKeyEnv: "SECOND_PROVIDER_KEY",
          adapter: "openai",
          defaultModel: "second-model",
          models: [
            {
              id: "second-model",
              name: "Second Model",
              contextWindow: 128000,
              maxOutput: 16000,
              supportsStreaming: true,
              supportsThinking: true,
            },
          ],
          custom: true,
        },
      },
    };
    const session = SessionManager.inMemory(projectRoot);
    const composition = await createSobaRuntime({
      cwd: projectRoot,
      session,
      config: {
        ...makeConfig(),
        apiKey: "",
        baseUrl: "https://first.example.test/v1",
        model: "first-model",
        registry,
      },
      compactionConfig: { ...DEFAULT_COMPACTION_CONFIG, auto: false },
      interactive: false,
      modelExplicitlyPassed: false,
      noStream: true,
      stream: false,
      tokenBudget: 0,
      debug: false,
      providerRegistryConfigPath: registryConfigPath(),
    });
    const runtimeSession = await composition.runtime.createSession({ cwd: projectRoot });

    await expect(composition.runtime.listSessionConfigOptions?.(runtimeSession.id)).resolves.toMatchObject([
      { id: "provider", currentValue: "first-provider" },
      { id: "model", currentValue: "first-model" },
    ]);

    await composition.runtime.setSessionConfig({
      sessionId: runtimeSession.id,
      key: "provider",
      value: "second-provider",
    });

    expect(composition.client.getConfig()).toMatchObject({
      apiKey: "second-key",
      baseUrl: "https://second.example.test/v1",
      model: "second-model",
      contextWindow: 128000,
    });
  });

  test("ignores provider selection when the provider has no configured credentials", async () => {
    const registry = {
      defaultProvider: "first-provider",
      defaultModel: "first-model",
      providers: {
        "first-provider": { apiKey: "first-key" },
      },
      customProviders: {
        "first-provider": {
          id: "first-provider",
          name: "First Provider",
          baseUrl: "https://first.example.test/v1",
          apiKeyEnv: "FIRST_PROVIDER_KEY",
          adapter: "openai",
          defaultModel: "first-model",
          models: [
            {
              id: "first-model",
              name: "First Model",
              contextWindow: 64000,
              maxOutput: 8192,
              supportsStreaming: true,
              supportsThinking: false,
            },
          ],
          custom: true,
        },
        "missing-provider": {
          id: "missing-provider",
          name: "Missing Provider",
          baseUrl: "https://missing.example.test/v1",
          apiKeyEnv: "MISSING_PROVIDER_KEY",
          adapter: "openai",
          defaultModel: "missing-model",
          models: [
            {
              id: "missing-model",
              name: "Missing Model",
              contextWindow: 128000,
              maxOutput: 16000,
              supportsStreaming: true,
              supportsThinking: true,
            },
          ],
          custom: true,
        },
      },
    };
    const session = SessionManager.inMemory(projectRoot);
    const composition = await createSobaRuntime({
      cwd: projectRoot,
      session,
      config: {
        ...makeConfig(),
        apiKey: "",
        baseUrl: "https://first.example.test/v1",
        model: "first-model",
        registry,
      },
      compactionConfig: { ...DEFAULT_COMPACTION_CONFIG, auto: false },
      interactive: false,
      modelExplicitlyPassed: false,
      noStream: true,
      stream: false,
      tokenBudget: 0,
      debug: false,
      providerRegistryConfigPath: registryConfigPath(),
    });
    const runtimeSession = await composition.runtime.createSession({ cwd: projectRoot });

    await expect(composition.runtime.setSessionConfig({
      sessionId: runtimeSession.id,
      key: "provider",
      value: "missing-provider",
    })).resolves.toMatchObject({ id: runtimeSession.id });

    expect(composition.client.getActiveProviderId()).toBe("first-provider");
    expect(composition.client.getConfig().apiKey).toBe("first-key");
  });
});
