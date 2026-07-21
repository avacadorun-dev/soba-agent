/**
 * OpenResponses Client tests.
 *
 * Tests cover:
 * - Client initialization from SobaConfig
 * - create() with mocked adapter
 * - compact() with mocked adapter
 * - Config updates
 * - Error handling and retries
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SobaConfig } from "../src/application/config/types";
import type { ProviderAdapter } from "../src/infrastructure/llm/openai/types";
import { createOpenResponsesClient, OpenResponsesClientImpl } from "../src/infrastructure/llm/openresponses/openresponses-client";
import type { CompactResponseParams, CreateResponseParams, ResponseResource, StreamingEvent } from "../src/kernel/model/openresponses-types";

// ─── Helpers ───

function makeTestConfig(): SobaConfig {
  return {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "fake-api-key-123",
    model: "gpt-4o",
    maxOutputTokens: 4096,
    contextWindow: 128000,
    temperature: 0.7,
    maxAgentIterations: 100,
    maxStalledIterations: 4,
    maxRunMinutes: 30,
    bashMaxTimeoutSeconds: 300,
    sessionDir: "",
    lang: "en",
    maxCompletionTokens: 0,
    theme: "graphite",
  };
}

function makeSampleResponseResource(): ResponseResource {
  return {
    id: "resp_test123",
    object: "response",
    created_at: 1717000000,
    completed_at: 1717000001,
    status: "completed",
    incomplete_details: null,
    model: "gpt-4o",
    previous_response_id: null,
    instructions: null,
    output: [
      {
        type: "message",
        id: "msg_test1",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Hello! How can I help you?",
            annotations: [],
          },
        ],
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
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
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

function makeMockAdapter(): ProviderAdapter {
  return {
    name: "mock",
    convertRequest: mock((_params, _config) => ({ mock: true })),
    convertResponse: mock((_raw, _config) => makeSampleResponseResource()),
    convertStreamChunk: mock((_raw) => []),
    isStreamComplete: mock((_event) => false),
    isStreamError: mock((_event) => ({ isError: false })),
    buildResponseFromStream: mock((_events, _config) => makeSampleResponseResource()),
    convertCompactRequest: mock((_params, _config) => ({ mockCompact: true })),
    convertCompactResponse: mock((_raw) => ({
      id: "compact_1",
      object: "response.compaction" as const,
      output: [{ type: "compaction" as const, id: "comp_1", encrypted_content: "summary" }],
      created_at: 1717000000,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    })),
    getIdentity: () => ({
      adapterId: "mock",
      endpointOrigin: "https://mock.example.com/v1",
      model: "mock-model",
    }),
    getCapabilities: () => ({
      nativeCompaction: false,
      structuredOutput: false,
      developerMessages: false,
    }),
    classifyError: () => "unknown" as const,
  };
}

function expectSobaAppHeaders(init: RequestInit | undefined): void {
  const headers = init?.headers as Record<string, string> | undefined;
  expect(headers).toMatchObject({
    "Content-Type": "application/json",
    Authorization: "Bearer fake-api-key-123",
    "HTTP-Referer": "https://github.com/avacadorun-dev/soba-agent",
    "X-Title": "soba-agent",
    "User-Agent": "soba-agent",
  });
}

function fetchInitAt(fetchMock: unknown, index: number): RequestInit | undefined {
  return (fetchMock as { mock: { calls: Array<[RequestInfo | URL, RequestInit?]> } }).mock.calls[index]?.[1];
}

// ─── Tests ───

describe("OpenResponsesClient", () => {
  afterEach(() => {
    mock.restore();
  });

  // ── Initialization ──

  test("createOpenResponsesClient создаёт клиент из SobaConfig", () => {
    const config = makeTestConfig();
    const client = createOpenResponsesClient(config);

    expect(client).toBeDefined();
    expect(client.getConfig().baseUrl).toBe(config.baseUrl);
    expect(client.getConfig().apiKey).toBe(config.apiKey);
    expect(client.getConfig().model).toBe(config.model);
    expect(client.getConfig().maxOutputTokens).toBe(config.maxOutputTokens);
    expect(client.getConfig().contextWindow).toBe(config.contextWindow);
  });

  test("OpenResponsesClientImpl с кастомным адаптером", () => {
    const config = makeTestConfig();
    const adapter = makeMockAdapter();
    const client = new OpenResponsesClientImpl(config, adapter);

    expect(client.getConfig().model).toBe("gpt-4o");
    expect(client.getConfig().baseUrl).toBe("https://api.openai.com/v1");
  });

  test("сохраняет model compatibility из SobaConfig", () => {
    const modelCompatibility: NonNullable<SobaConfig["modelCompatibility"]> = [
      "single_system_message",
    ];
    const client = createOpenResponsesClient({
      ...makeTestConfig(),
      modelCompatibility,
    });

    modelCompatibility.length = 0;
    const returnedCompatibility = client.getConfig().modelCompatibility;
    expect(returnedCompatibility).toEqual([
      "single_system_message",
    ]);
    returnedCompatibility?.splice(0);
    expect(client.getConfig().modelCompatibility).toEqual([
      "single_system_message",
    ]);
  });

  // ── getConfig / updateConfig ──

  test("getConfig возвращает текущую конфигурацию", () => {
    const client = createOpenResponsesClient(makeTestConfig());
    const cfg = client.getConfig();

    expect(cfg.baseUrl).toBe("https://api.openai.com/v1");
    expect(cfg.apiKey).toBe("fake-api-key-123");
    expect(cfg.model).toBe("gpt-4o");
  });

  test("updateConfig обновляет поля", () => {
    const client = createOpenResponsesClient(makeTestConfig());

    client.updateConfig({ model: "gpt-4o-mini", apiKey: "new-key" });

    expect(client.getConfig().model).toBe("gpt-4o-mini");
    expect(client.getConfig().apiKey).toBe("new-key");
    expect(client.getConfig().baseUrl).toBe("https://api.openai.com/v1");
  });

  test("updateConfig с пустым partial не меняет конфиг", () => {
    const client = createOpenResponsesClient(makeTestConfig());
    client.updateConfig({});
    expect(client.getConfig().model).toBe("gpt-4o");
  });

  test("updateConfig can clear model compatibility", () => {
    const client = createOpenResponsesClient({
      ...makeTestConfig(),
      modelCompatibility: ["single_system_message"],
    });

    client.updateConfig({ modelCompatibility: undefined });
    expect(client.getConfig().modelCompatibility).toBeUndefined();
  });

  // ── Adapter delegation ──

  test("create вызывает adapter.convertRequest и adapter.convertResponse", async () => {
    // Mock fetch to avoid real network call
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = makeMockAdapter();
    const client = new OpenResponsesClientImpl(
      {
        ...makeTestConfig(),
        modelCompatibility: ["single_system_message"],
      },
      adapter,
    );

    const params: CreateResponseParams = {
      model: "gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello" }],
        },
      ],
    };

    const response = await client.create(params);

    expect(response.status).toBe("completed");
    expect(adapter.convertRequest).toHaveBeenCalled();
    expect(adapter.convertResponse).toHaveBeenCalled();
    const createCall = (adapter.convertRequest as ReturnType<typeof mock>).mock.calls[0];
    expect(createCall?.[1]).toMatchObject({
      compatibility: ["single_system_message"],
    });
    expectSobaAppHeaders(fetchInitAt(mockFetch, 0));

    mockFetch.mockRestore();
  });

  test("create передаёт instructions в adapter.convertRequest", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = makeMockAdapter();
    const client = new OpenResponsesClientImpl(makeTestConfig(), adapter);

    await client.create({
      model: "gpt-4o",
      input: [],
      instructions: "You are a coding assistant.",
    });

    const callArgs = (adapter.convertRequest as ReturnType<typeof mock>).mock.calls[0] as [
      CreateResponseParams,
      unknown,
    ];
    expect(callArgs[0].instructions).toBe("You are a coding assistant.");

    mockFetch.mockRestore();
  });

  test("create передаёт tools в запрос", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = makeMockAdapter();
    const client = new OpenResponsesClientImpl(
      {
        ...makeTestConfig(),
        modelCompatibility: ["single_system_message"],
      },
      adapter,
    );

    const tools = [
      {
        type: "function" as const,
        name: "read",
        description: "Read a file",
      },
    ];

    await client.create({
      model: "gpt-4o",
      input: [],
      tools,
    });

    const callArgs = (adapter.convertRequest as ReturnType<typeof mock>).mock.calls[0] as [
      CreateResponseParams,
      unknown,
    ];
    expect(callArgs[0].tools).toEqual(tools);

    mockFetch.mockRestore();
  });

  // ── compact ──

  test("compact вызывает adapter.convertCompactRequest и convertCompactResponse", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = makeMockAdapter();
    const client = new OpenResponsesClientImpl(
      {
        ...makeTestConfig(),
        modelCompatibility: ["single_system_message"],
      },
      adapter,
    );

    const params: CompactResponseParams = {
      model: "gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello" }],
        },
      ],
    };

    const result = await client.compact(params);

    expect(result.object).toBe("response.compaction");
    expect(result.output[0].type).toBe("compaction");
    const compactCall = (adapter.convertCompactRequest as ReturnType<typeof mock>).mock.calls[0];
    expect(compactCall?.[1]).toMatchObject({
      compatibility: ["single_system_message"],
    });

    mockFetch.mockRestore();
  });

  test("compact выбрасывает ошибку если адаптер не поддерживает compaction", async () => {
    const adapter: ProviderAdapter = {
      name: "no-compact",
      convertRequest: mock((_params, _config) => ({})),
      convertResponse: mock((_raw, _config) => makeSampleResponseResource()),
      convertStreamChunk: mock((_raw) => []),
      isStreamComplete: mock((_event) => false),
      isStreamError: mock((_event) => ({ isError: false })),
      buildResponseFromStream: mock((_events, _config) => makeSampleResponseResource()),
      getIdentity: () => ({
        adapterId: "no-compact",
        endpointOrigin: "https://mock.example.com/v1",
        model: "mock-model",
      }),
      getCapabilities: () => ({
        nativeCompaction: false,
        structuredOutput: false,
        developerMessages: false,
      }),
      classifyError: () => "unknown" as const,
      // No convertCompactRequest — should throw
    };

    const client = new OpenResponsesClientImpl(makeTestConfig(), adapter);

    await expect(client.compact({ model: "gpt-4o" })).rejects.toThrow("does not support compaction");
  });

  // ── Error handling ──

  test("create обрабатывает HTTP ошибку — возвращает ResponseResource со status: failed", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const client = createOpenResponsesClient(makeTestConfig());

    const response = await client.create({
      model: "gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello" }],
        },
      ],
    });

    // The client returns a ResponseResource with status "failed"
    // (not throwing — errors are returned as response objects per OpenResponses spec)
    expect(response.status).toBe("failed");

    mockFetch.mockRestore();
  });

  test("createStream обрабатывает HTTP ошибку через streaming event", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response("Error", {
          status: 500,
        }),
      ),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const client = createOpenResponsesClient(makeTestConfig());
    const events: Array<{ type: string }> = [];

    for await (const event of client.createStream({
      model: "gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello" }],
        },
      ],
    })) {
      events.push(event);
    }

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("response.failed");
    expectSobaAppHeaders(fetchInitAt(mockFetch, 0));

    mockFetch.mockRestore();
  });

  test("createStream повторяет streaming fetch после закрытия socket до первого события", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    const streamChunk = JSON.stringify({
      id: "chatcmpl-stream-retry",
      object: "chat.completion.chunk",
      created: 1717000000,
      model: "gpt-4o",
      choices: [{ index: 0, delta: { content: "Recovered" }, finish_reason: "stop" }],
    });
    const mockFetch = mock(() => {
      calls++;
      if (calls === 1) {
        throw new Error("The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()");
      }

      return Promise.resolve(
        new Response(`data: ${streamChunk}\n\ndata: [DONE]\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const client = createOpenResponsesClient(makeTestConfig());
      const events: StreamingEvent[] = [];

      for await (const event of client.createStream({
        model: "gpt-4o",
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Hello" }],
          },
        ],
      })) {
        events.push(event);
      }

      expect(calls).toBe(2);
      expect(events.some((event) => event.type === "response.output_text.delta")).toBe(true);
      expect(events.some((event) => event.type === "response.completed")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      mockFetch.mockRestore();
    }
  });

  test("createStream флашит накопленный ответ если SSE завершился без [DONE]", async () => {
    const originalFetch = globalThis.fetch;
    const streamChunk = JSON.stringify({
      id: "chatcmpl-stream-eof",
      object: "chat.completion.chunk",
      created: 1717000000,
      model: "MiniMax-M3",
      choices: [{ index: 0, delta: { content: "Готово" }, finish_reason: "stop" }],
    });
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(`data: ${streamChunk}\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const client = createOpenResponsesClient({
        ...makeTestConfig(),
        baseUrl: "https://api.minimax.io/v1",
        model: "MiniMax-M3",
      });
      const events: StreamingEvent[] = [];

      for await (const event of client.createStream({
        model: "MiniMax-M3",
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Hello" }],
          },
        ],
      })) {
        events.push(event);
      }

      expect(events.some((event) => event.type === "response.output_item.done")).toBe(true);
      expect(events.some((event) => event.type === "response.completed")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      mockFetch.mockRestore();
    }
  });
});
