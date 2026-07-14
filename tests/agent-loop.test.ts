/**
 * Agent Loop tests.
 *
 * Tests cover:
 * - Simple turn without tools
 * - Turn with one tool call
 * - Turn with multiple tool calls
 * - Tool error handling
 * - API error handling
 * - Max iterations limit
 * - Event emission
 * - Budget tracking
 * - createUserItem helper
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyEvidenceProof } from "../src/application/commands/verify";
import { AgentLoop, createUserItem } from "../src/engine/turn/agent-loop";
import type { AgentEvent } from "../src/engine/turn/types";
import type { OpenResponsesClient } from "../src/infrastructure/llm/openresponses/openresponses-client";
import { FilesystemEvidenceProofStorage } from "../src/infrastructure/persistence/evidence/proof-storage";
import { SessionManager } from "../src/infrastructure/persistence/sessions/session-manager";
import type {
  CreateResponseParams,
  ResponseResource,
} from "../src/kernel/model/openresponses-types";
import { ToolRegistry } from "../src/kernel/tools/tool-registry";
import type { ToolDefinition } from "../src/kernel/tools/types";

// ─── Helpers ───

function makeDummyTool(
  name: string,
  executor?: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError: boolean;
  }>,
): ToolDefinition {
  return {
    name,
    label: name,
    description: `Tool ${name}`,
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "Input" },
      },
    },
    toolType: "function",
    async execute(args) {
      if (executor) return executor(args);
      return {
        content: [{ type: "text", text: `Executed ${name}` }],
        isError: false,
      };
    },
  };
}

function makeTextResponse(
  text: string,
  phase: "commentary" | "final_answer" = "final_answer",
): ResponseResource {
  return {
    id: "resp_test123",
    object: "response",
    created_at: 1,
    completed_at: 2,
    status: "completed",
    incomplete_details: null,
    model: "gpt-4o",
    previous_response_id: null,
    instructions: null,
    output: [
      {
        type: "message",
        id: "msg_1",
        status: "completed",
        role: "assistant",
        phase,
        content: [{ type: "output_text", text, annotations: [] }],
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
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
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

function makeUnphasedTextResponse(text: string): ResponseResource {
  const response = makeTextResponse(text);
  const message = response.output[0];
  if (message?.type === "message") {
    delete message.phase;
  }
  return response;
}

function makeUnphasedTextResponseWithReasoning(
  text: string,
  reasoningContent: string,
): ResponseResource {
  const response = makeUnphasedTextResponse(text);
  const message = response.output[0];
  if (message?.type === "message") {
    message.reasoning_content = reasoningContent;
  }
  return response;
}

function makeFinishResponse(
  summary: string,
  criteria: string[] = ["Requested work is verified"],
  acknowledgedErrorIds: string[] = [],
  status: "completed" | "completed_with_unverified_changes" = "completed",
): ResponseResource {
  return makeToolCallResponse(
    "finish",
    JSON.stringify({
      summary,
      status,
      criteria: criteria.map((criterion) => ({ criterion })),
      acknowledged_error_ids: acknowledgedErrorIds,
    }),
  );
}

function makeBlockedFinishResponse(summary: string): ResponseResource {
  return makeToolCallResponse(
    "finish",
    JSON.stringify({ summary, status: "blocked", criteria: [] }),
  );
}

function makeLegacyFinishResponseWithoutCriteria(
  summary: string,
  status: "completed" | "completed_with_unverified_changes" = "completed",
): ResponseResource {
  return makeToolCallResponse("finish", JSON.stringify({ summary, status }));
}

function makeToolCallResponse(
  toolName: string,
  args: string,
  callId = "call_1",
): ResponseResource {
  return {
    id: "resp_tool_1",
    object: "response",
    created_at: 1,
    completed_at: 2,
    status: "completed",
    incomplete_details: null,
    model: "gpt-4o",
    previous_response_id: null,
    instructions: null,
    output: [
      {
        type: "function_call",
        id: `fc_${callId}`,
        call_id: callId,
        name: toolName,
        arguments: args,
        status: "completed",
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
      input_tokens: 100,
      output_tokens: 30,
      total_tokens: 130,
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

function makeToolThenTextResponse(
  toolName: string,
  args: string,
  text: string,
): ResponseResource {
  return {
    ...makeToolCallResponse(toolName, args),
    output: [
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: toolName,
        arguments: args,
        status: "completed",
      },
      {
        type: "message",
        id: "msg_1",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
  };
}

function makeClient(responses: ResponseResource[]): OpenResponsesClient {
  let idx = 0;
  return {
    getConfig: () => ({
      baseUrl: "",
      apiKey: "test",
      model: "gpt-4o",
      maxOutputTokens: 16384,
      maxCompletionTokens: 0,
      contextWindow: 128000,
      temperature: 0.7,
    }),
    updateConfig: () => {},
    create: mock(async (_params) => {
      const resp = responses[idx];
      idx = Math.min(idx + 1, responses.length - 1);
      return resp;
    }),
    createStream: mock(async function* () {
      // Not tested in these unit tests
    }),
    compact: mock(async () => ({
      id: "comp_1",
      object: "response.compaction" as const,
      output: [],
      created_at: 1,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    })),
    getProviderIdentity: () => ({
      adapterId: "openai",
      endpointOrigin: "https://api.openai.com/v1",
      model: "gpt-4o",
    }),
    getProviderCapabilities: () => ({
      nativeCompaction: false,
      structuredOutput: true,
      developerMessages: false,
    }),
    classifyError: () => "unknown" as const,
    compactNative: mock(async () => {
      throw new Error("compactNative not implemented");
    }),
  };
}

// ─── Tests ───

describe("AgentLoop", () => {
  afterEach(() => {
    mock.restore();
  });

  // ── Simple turn without tools ──

  test("простой ход без инструментов — возвращает ответ ассистента", async () => {
    const client = makeClient([makeTextResponse("Hello! How can I help?")]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    const loop = new AgentLoop(client, session, tools, "/test");

    const result = await loop.runTurn("Hi!");

    expect(result.errors.length).toBe(0);
    expect(result.items.length).toBe(2); // user + assistant
    expect(result.response.status).toBe("completed");

    // Check session has the items
    const branch = session.getBranch();
    expect(branch.length).toBe(2);
  });

  test("собирает usage из ответа", async () => {
    const client = makeClient([makeTextResponse("OK")]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    const loop = new AgentLoop(client, session, tools, "/test");

    await loop.runTurn("Hi");

    const usage = loop.getUsage();
    expect(usage.total_tokens).toBe(150);
    expect(usage.input_tokens).toBe(100);
    expect(usage.output_tokens).toBe(50);
  });

  test("turnCount увеличивается с каждым ходом", async () => {
    const client = makeClient([
      makeTextResponse("Response 1"),
      makeTextResponse("Response 2"),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    const loop = new AgentLoop(client, session, tools, "/test");

    expect(loop.getTurnCount()).toBe(0);
    await loop.runTurn("First");
    expect(loop.getTurnCount()).toBe(1);
    await loop.runTurn("Second");
    expect(loop.getTurnCount()).toBe(2);
  });

  test("передаёт max output tokens и автоматически продолжает обрезанный ответ", async () => {
    const requests: CreateResponseParams[] = [];
    const incompleteResponse: ResponseResource = {
      ...makeTextResponse("Partial answer"),
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    };
    const responses = [
      incompleteResponse,
      makeTextResponse("Final continuation"),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const session = SessionManager.inMemory("/test");
    const loop = new AgentLoop(client, session, new ToolRegistry(), "/test");

    const result = await loop.runTurn("Complete a long task");

    expect(requests).toHaveLength(2);
    expect(requests[0].max_output_tokens).toBe(16384);
    expect(requests[0].temperature).toBe(0.7);
    expect(result.errors).toHaveLength(0);
    expect(result.items.map((item) => item.type)).toEqual([
      "message",
      "message",
      "message",
      "message",
    ]);
    const continuation = result.items[2];
    expect(continuation.type).toBe("message");
    if (continuation.type === "message" && continuation.role === "user") {
      const content = continuation.content[0];
      expect(content?.type).toBe("input_text");
      if (content?.type === "input_text") {
        expect(content.text).toContain("Continue exactly");
      }
    }
  });

  test("не исполняет tool call из обрезанного max_output_tokens ответа", async () => {
    const requests: CreateResponseParams[] = [];
    const executed: string[] = [];
    const incompleteToolResponse: ResponseResource = {
      ...makeToolCallResponse("write", ""),
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    };
    const responses = [
      incompleteToolResponse,
      makeToolCallResponse("write", '{"path":"index.html","content":"ok"}', "write_ok"),
      makeToolCallResponse("bash", '{"command":"bun test"}', "verify_ok"),
      makeFinishResponse("Готово."),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("write", async (args) => {
      executed.push(JSON.stringify(args));
      return {
        content: [{ type: "text", text: "written" }],
        isError: false,
      };
    }));
    tools.register(makeDummyTool("bash"));
    const loop = new AgentLoop(client, SessionManager.inMemory("/test"), tools, "/test");

    const result = await loop.runTurn("Write a file");

    expect(requests).toHaveLength(4);
    expect(executed).toEqual(['{"path":"index.html","content":"ok"}']);
    expect(
      result.items.some(
        (item) => item.type === "function_call" && item.name === "write" && item.arguments === "",
      ),
    ).toBe(false);
    expect(
      result.items.some(
        (item) =>
          item.type === "message" &&
          item.role === "user" &&
          item.content.some(
            (content) =>
              content.type === "input_text" &&
              content.text.includes("Discard the incomplete tool call"),
          ),
      ),
    ).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // ── Turn with tool calls ──

  test("ход с одним tool call — выполняет инструмент и продолжает", async () => {
    const client = makeClient([
      makeToolCallResponse("test-tool", '{"input":"data"}'),
      makeTextResponse("I executed the tool."),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("test-tool"));
    const loop = new AgentLoop(client, session, tools, "/test");

    const result = await loop.runTurn("Run the tool");

    expect(result.errors.length).toBe(0);
    // user + function_call + function_call_output + final assistant response
    expect(result.items.length).toBe(4);

    // Check session has all items
    const branch = session.getBranch();
    expect(branch.length).toBe(4);
  });

  test("автономно продолжает после edit, если модель остановилась до проверки", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("edit", '{"input":"change"}'),
      makeTextResponse("Проверим, что warning исчез:", "commentary"),
      makeToolCallResponse("bash", '{"input":"bun test"}'),
      makeFinishResponse("Изменение проверено, тесты проходят.", ["call_1"]),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("edit"));
    tools.register(makeDummyTool("bash"));
    const loop = new AgentLoop(client, session, tools, "/test");

    const result = await loop.runTurn("Исправь warning");

    // edit → promised verification → auto-continue → bash → final text
    expect(requests).toHaveLength(4);
    expect(result.errors).toHaveLength(0);
    const autonomousPrompt = result.items.find(
      (item) =>
        item.type === "message" &&
        item.role === "user" &&
        item.content.some(
          (content) =>
            content.type === "input_text" &&
            content.text.includes("Do not output commentary"),
        ),
    );
    expect(autonomousPrompt).toBeDefined();
  });

  test("accepts repeated commentary after edit as final when no active errors (Qwen-style no-finish model)", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("edit", '{"input":"change"}'),
      makeTextResponse("Проверим результат.", "commentary"),
      makeTextResponse("Сейчас проверю.", "commentary"),
      makeTextResponse("Теперь проверим ещё раз.", "commentary"),
      makeTextResponse("Готово.", "commentary"),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("edit"));
    const loop = new AgentLoop(client, session, tools, "/test", {
      emitEvents: true,
    });
    const events: Array<{ type: string }> = [];
    loop.onEvent((event) => events.push(event));

    const result = await loop.runTurn("Исправь и проверь");

    // edit + 3 follow-ups + 1 final commentary (exhausted, no active errors) → accepted as final
    expect(requests).toHaveLength(5);
    expect(result.errors).toHaveLength(0);
    expect(events.some((event) => event.type === "turn_error")).toBe(false);
  });

  test("stops with loop-guard when commentary follows edit AND there are active errors", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("edit", '{"input":"change"}'),
      makeTextResponse("Проверим результат.", "commentary"),
      makeTextResponse("Сейчас проверю.", "commentary"),
      makeTextResponse("Теперь проверим ещё раз.", "commentary"),
      makeTextResponse("Готово.", "commentary"),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register({
      name: "edit",
      label: "edit",
      description: "Edit file",
      parameters: {
        type: "object",
        properties: { input: { type: "string", description: "" } },
      },
      toolType: "function" as const,
      execute: async () => ({
        content: [{ type: "text", text: "Edit failed: permission denied" }],
        isError: true,
      }),
    });
    const loop = new AgentLoop(client, session, tools, "/test", {
      emitEvents: true,
      maxAutonomousFollowUps: 3,
    });
    const events: Array<{ type: string }> = [];
    loop.onEvent((event) => events.push(event));

    const result = await loop.runTurn("Исправь");

    // edit (error) + 3 follow-ups + 1 final commentary (exhausted, active errors remain) → loop-guard stop
    expect(requests).toHaveLength(5);
    expect(
      result.errors.some(
        (error) =>
          error.type === "timeout" && error.message.includes("Active errors"),
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "turn_error")).toBe(true);
  });

  test("final_answer после edit проходит completion gate только после проверки", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("edit", '{"input":"change"}'),
      makeTextResponse("Изменение готово."),
      makeToolCallResponse("bash", '{"input":"bun test"}'),
      makeFinishResponse("Изменение проверено.", ["call_1"]),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("edit"));
    tools.register(makeDummyTool("bash"));
    const loop = new AgentLoop(client, session, tools, "/test");

    const result = await loop.runTurn("Измени интеграцию");

    expect(requests).toHaveLength(4);
    expect(result.errors).toHaveLength(0);
  });

  test("после проверенной tool-assisted работы принимает final prose без supersede и повторного finish", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("edit", '{"input":"change"}', "edit_1"),
      makeToolCallResponse("bash", '{"input":"bun test"}', "verify_1"),
      makeTextResponse("Готово, проверки прошли.", "final_answer"),
      makeFinishResponse("Готово, проверки прошли."),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("edit"));
    tools.register(makeDummyTool("bash"));
    const loop = new AgentLoop(client, session, tools, "/test", {
      emitEvents: true,
    });
    const events: AgentEvent[] = [];
    loop.onEvent((event) => events.push(event));

    const result = await loop.runTurn("Измени интеграцию");

    expect(result.errors).toHaveLength(0);
    expect(requests).toHaveLength(3);
    expect(events.some((event) => event.type === "assistant_message_superseded")).toBe(false);
    const assistantTexts = result.items
      .filter((item) => item.type === "message" && item.role === "assistant")
      .flatMap((item) =>
        item.content
          .filter((content) => content.type === "output_text")
          .map((content) => content.text),
      );
    expect(assistantTexts).toHaveLength(1);
    expect(assistantTexts[0]).toContain("Готово, проверки прошли.");
  });

  test("опасная bash-команда запрашивает подтверждение и блокируется при отказе", async () => {
    let executed = false;
    const client = makeClient([
      makeToolCallResponse("bash", '{"command":"rm -rf node_modules"}'),
      makeTextResponse("Dangerous command was denied."),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(
      makeDummyTool("bash", async () => {
        executed = true;
        return {
          content: [{ type: "text", text: "should not run" }],
          isError: false,
        };
      }),
    );
    const loop = new AgentLoop(client, session, tools, "/test");

    // Listen for dangerous confirmation and deny it
    loop.onEvent((event) => {
      if (event.type === "dangerous_confirmation") {
        event.resolve("deny"); // User denies the operation
      }
    });

    const result = await loop.runTurn("Remove dependencies");

    expect(executed).toBe(false);
    expect(
      result.errors.some((error) => error.message.includes("Denied")),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.message.includes("trust_confirmation_denied") &&
          error.message.includes("ask the user for explicit confirmation"),
      ),
    ).toBe(true);
  });

  test("опасная bash-команда выполняется после подтверждения", async () => {
    let executed = false;
    const client = makeClient([
      makeToolCallResponse("bash", '{"command":"rm -rf node_modules"}'),
      makeTextResponse("Dangerous command was allowed and executed."),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(
      makeDummyTool("bash", async () => {
        executed = true;
        return {
          content: [{ type: "text", text: "executed" }],
          isError: false,
        };
      }),
    );
    const loop = new AgentLoop(client, session, tools, "/test");

    // Listen for dangerous confirmation and allow it
    loop.onEvent((event) => {
      if (event.type === "dangerous_confirmation") {
        event.resolve("once"); // User allows the operation
      }
    });

    const result = await loop.runTurn("Remove dependencies");

    expect(executed).toBe(true);
    expect(
      result.errors.filter((error) => error.type !== "api_error"),
    ).toHaveLength(0);
  });

  test("repo permission mode skips confirmation for absolute cwd command inside repo", async () => {
    let executed = false;
    let confirmations = 0;
    const command = "cd /tmp/soba-test-repo && printf 'q' | script -q /tmp/atop_final.txt ./atop";
    const client = makeClient([
      makeToolCallResponse("bash", JSON.stringify({ command })),
      makeTextResponse("Repo command was executed."),
    ]);
    const session = SessionManager.inMemory("/tmp/soba-test-repo");
    const tools = new ToolRegistry();
    tools.register(
      makeDummyTool("bash", async () => {
        executed = true;
        return {
          content: [{ type: "text", text: "executed" }],
          isError: false,
        };
      }),
    );
    const loop = new AgentLoop(client, session, tools, "/tmp/soba-test-repo");
    loop.getTrustManager().setPermissionMode("repo");
    loop.onEvent((event) => {
      if (event.type === "dangerous_confirmation") {
        confirmations += 1;
        event.resolve("deny");
      }
    });

    const result = await loop.runTurn("Run local TUI smoke test");

    expect(executed).toBe(true);
    expect(confirmations).toBe(0);
    expect(result.errors.filter((error) => error.type !== "api_error")).toHaveLength(0);
  });

  test("ошибка prepareArgs закрывает tool call результатом", async () => {
    const client = makeClient([
      makeToolCallResponse("strict-tool", '{"input":"invalid"}'),
      makeBlockedFinishResponse("Tool arguments were invalid."),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register({
      ...makeDummyTool("strict-tool"),
      prepareArgs() {
        throw new Error("Invalid arguments");
      },
    });
    const loop = new AgentLoop(client, session, tools, "/test");

    const result = await loop.runTurn("Run strict tool");

    expect(result.items.map((item) => item.type)).toEqual([
      "message",
      "function_call",
      "function_call_output",
      "message",
      "message",
    ]);
    expect(
      result.items.some(
        (item) =>
          item.type === "message" &&
          item.role === "user" &&
          item.content.some(
            (content) =>
              content.type === "input_text" &&
              content.text.includes("tool_invalid_arguments"),
          ),
      ),
    ).toBe(true);
    expect(
      result.errors.some((error) =>
        error.message.includes("Invalid arguments"),
      ),
    ).toBe(true);
  });

  test("ход с несколькими tool calls — выполняет оба", async () => {
    const client = makeClient([
      {
        ...makeToolCallResponse("tool-a", '{"input":"a"}'),
        output: [
          {
            type: "function_call",
            id: "fc_a",
            call_id: "call_a",
            name: "tool-a",
            arguments: '{"input":"a"}',
            status: "completed",
          },
          {
            type: "function_call",
            id: "fc_b",
            call_id: "call_b",
            name: "tool-b",
            arguments: '{"input":"b"}',
            status: "completed",
          },
        ],
      },
      makeTextResponse("Both tools executed."),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("tool-a"));
    tools.register(makeDummyTool("tool-b"));
    const loop = new AgentLoop(client, session, tools, "/test");

    const result = await loop.runTurn("Run both");

    expect(result.errors.length).toBe(0);
    // user + fc_a + fc_b + fc_a_output + fc_b_output + final assistant response
    expect(result.items.length).toBe(6);
  });

  test("read-only tool batches execute concurrently while preserving session output order", async () => {
    const client = makeClient([
      {
        ...makeToolCallResponse("read", '{"path":"a.ts"}', "call_read"),
        output: [
          {
            type: "function_call",
            id: "fc_read",
            call_id: "call_read",
            name: "read",
            arguments: '{"path":"a.ts"}',
            status: "completed",
          },
          {
            type: "function_call",
            id: "fc_inspect",
            call_id: "call_inspect",
            name: "inspect_file",
            arguments: '{"path":"b.ts","startLine":1,"endLine":1}',
            status: "completed",
          },
        ],
      },
      makeTextResponse("Read-only tools executed."),
    ]);
    const events: string[] = [];
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("read", async () => {
      events.push("read:start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("read:end");
      return { content: [{ type: "text", text: "read result" }], isError: false };
    }));
    tools.register(makeDummyTool("inspect_file", async () => {
      events.push("inspect:start");
      events.push("inspect:end");
      return { content: [{ type: "text", text: "inspect result" }], isError: false };
    }));
    const loop = new AgentLoop(client, session, tools, "/test");

    const result = await loop.runTurn("Inspect both files");

    expect(events.indexOf("inspect:start")).toBeLessThan(events.indexOf("read:end"));
    expect(
      result.items
        .filter((item) => item.type === "function_call_output")
        .map((item) => item.call_id),
    ).toEqual(["call_read", "call_inspect"]);
  });

  test("сохраняет параллельные DeepSeek tool calls одной группой с reasoning_content", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      {
        ...makeToolCallResponse("tool-a", '{"input":"a"}'),
        output: [
          {
            type: "function_call" as const,
            id: "fc_a",
            call_id: "call_a",
            name: "tool-a",
            arguments: '{"input":"a"}',
            status: "completed",
            reasoning_content: "Нужно вызвать оба инструмента.",
          },
          {
            type: "function_call" as const,
            id: "fc_b",
            call_id: "call_b",
            name: "tool-b",
            arguments: '{"input":"b"}',
            status: "completed",
          },
        ],
      },
      makeTextResponse("Both tools executed."),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("tool-a"));
    tools.register(makeDummyTool("tool-b"));
    const loop = new AgentLoop(client, session, tools, "/test");

    const result = await loop.runTurn("Run both");

    expect(result.errors.length).toBe(0);
    expect(requests.length).toBe(2);
    const secondInput = requests[1].input;
    expect(Array.isArray(secondInput)).toBe(true);
    if (!Array.isArray(secondInput))
      throw new Error("Expected item array input");
    expect(secondInput.map((item) => item.type)).toEqual([
      "message",
      "function_call",
      "function_call",
      "function_call_output",
      "function_call_output",
    ]);
    const firstCall = secondInput[1];
    expect(firstCall?.type).toBe("function_call");
    if (firstCall?.type === "function_call") {
      expect(firstCall.reasoning_content).toBe(
        "Нужно вызвать оба инструмента.",
      );
    }
  });

  test("ход где tool call и assistant message в одном ответе", async () => {
    const client = makeClient([
      makeToolThenTextResponse("fetch", '{"url":"test"}', "Done!"),
      makeTextResponse("All tasks complete."),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("fetch"));
    const loop = new AgentLoop(client, session, tools, "/test");

    const result = await loop.runTurn("Fetch data");

    expect(result.errors.length).toBe(0);
    expect(result.items.length).toBeGreaterThan(3);
  });

  // ── Tool error handling ──

  test("tool которого нет в реестре — ошибка и продолжение", async () => {
    const client = makeClient([
      makeToolCallResponse("unknown-tool", "{}"),
      makeTextResponse("I'll try a different approach."),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    const loop = new AgentLoop(client, session, tools, "/test");

    const result = await loop.runTurn("Use unknown tool");

    // Should have tool error but not crash
    expect(result.errors.some((e) => e.type === "tool_error")).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
  });

  test("tool возвращает ошибку — записывается в errors", async () => {
    const client = makeClient([
      makeToolCallResponse("fail-tool", '{"input":"x"}'),
      makeTextResponse("Tool failed, I'll adjust."),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(
      makeDummyTool("fail-tool", async () => ({
        content: [{ type: "text", text: "Something went wrong!" }],
        isError: true,
      })),
    );
    const loop = new AgentLoop(client, session, tools, "/test");

    const result = await loop.runTurn("Use failing tool");

    expect(result.errors.some((e) => e.type === "tool_error")).toBe(true);
    expect(result.items.length).toBeGreaterThan(2);
  });

  // ── API error handling ──

  test("API возвращает статус failed", async () => {
    const client = makeClient([
      {
        ...makeTextResponse(""),
        status: "failed",
        error: {
          code: "server_error",
          message: "Internal server error",
          type: "server_error",
        },
      },
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    const loop = new AgentLoop(client, session, tools, "/test");

    const result = await loop.runTurn("Trigger error");

    expect(result.errors.some((e) => e.type === "api_error")).toBe(true);
    expect(result.response.status).toBe("failed");
  });

  test("API выбрасывает исключение (network error)", async () => {
    const client: OpenResponsesClient = {
      getConfig: () => ({
        baseUrl: "",
        apiKey: "test",
        model: "gpt-4o",
        maxOutputTokens: 16384,
        maxCompletionTokens: 0,
        contextWindow: 128000,
        temperature: 0.7,
      }),
      updateConfig: () => {},
      create: mock(async () => {
        throw new Error("Network error");
      }),
      createStream: mock(async function* () {}),
      compact: mock(async () => ({
        id: "",
        object: "response.compaction" as const,
        output: [],
        created_at: 0,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      })),
      getProviderIdentity: () => ({
        adapterId: "openai",
        endpointOrigin: "https://api.openai.com/v1",
        model: "gpt-4o",
      }),
      getProviderCapabilities: () => ({
        nativeCompaction: false,
        structuredOutput: true,
        developerMessages: false,
      }),
      classifyError: () => "unknown" as const,
      compactNative: mock(async () => {
        throw new Error("compactNative not implemented");
      }),
    };
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    const loop = new AgentLoop(client, session, tools, "/test", { emitEvents: true });
    const thinkingStates: boolean[] = [];
    loop.onEvent((event) => {
      if (event.type === "thinking") thinkingStates.push(event.active);
    });

    const result = await loop.runTurn("Anything");

    expect(result.errors.some((e) => e.type === "api_error")).toBe(true);
    expect(result.errors[0].message).toContain("Network error");
    expect(thinkingStates).toEqual([true, false]);
  });

  test("пользовательская отмена во время модельного запроса не становится api_error", async () => {
    let started!: () => void;
    let signalWasPassed = false;
    const modelRequestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const client: OpenResponsesClient = {
      ...makeClient([makeTextResponse("unused")]),
      create: mock(async (_params, options) => {
        started();
        signalWasPassed = options?.signal instanceof AbortSignal;
        if (!options?.signal) throw new Error("missing abort signal");
        await new Promise<void>((resolve) => {
          options.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new Error("The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()");
      }),
    };
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    const loop = new AgentLoop(client, session, tools, "/test", { emitEvents: true });
    const events: AgentEvent[] = [];
    loop.onEvent((event) => events.push(event));

    const activeTurn = loop.runTurn("Cancel this request");
    await modelRequestStarted;
    loop.abort();
    const result = await activeTurn;

    expect(signalWasPassed).toBe(true);
    expect(result.errors.some((error) => error.type === "api_error")).toBe(false);
    expect(result.errors.some((error) => error.type === "cancelled")).toBe(true);
    expect(events.some((event) => event.type === "turn_error")).toBe(false);
    expect(events.some((event) => event.type === "turn_stop_reason" && event.reason === "api-error")).toBe(false);
    expect(events.some((event) => event.type === "turn_stop_reason" && event.reason === "aborted")).toBe(true);
  });

  test("transient socket error during streaming model turn is retried", async () => {
    const finalResponse = makeTextResponse("Recovered");
    const client = {
      ...makeClient([finalResponse]),
      classifyError: mock((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return message.includes("socket") ? "transient" : "unknown";
      }),
      createStream: mock(async function* () {
        yield {
          type: "response.created" as const,
          response: { ...finalResponse, output: [], status: "in_progress" },
        };

        if (client.createStream.mock.calls.length === 1) {
          yield {
            type: "response.output_item.added" as const,
            output_index: 0,
            item: {
              type: "message" as const,
              id: "msg_partial",
              status: "in_progress",
              role: "assistant",
              content: [],
            },
          };
          yield {
            type: "response.output_text.delta" as const,
            item_id: "msg_partial",
            output_index: 0,
            content_index: 0,
            delta: "Part",
          };
          throw new Error("The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()");
        }

        yield {
          type: "response.output_item.added" as const,
          output_index: 0,
          item: {
            type: "message" as const,
            id: "msg_recovered",
            status: "in_progress",
            role: "assistant",
            content: [],
          },
        };
        yield {
          type: "response.output_text.delta" as const,
          item_id: "msg_recovered",
          output_index: 0,
          content_index: 0,
          delta: "Recovered",
        };
        yield {
          type: "response.output_item.done" as const,
          output_index: 0,
          item: finalResponse.output[0],
        };
        yield { type: "response.completed" as const, response: finalResponse };
      }),
    };
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    const loop = new AgentLoop(client, session, tools, "/test", { emitEvents: true, stream: true });
    const events: AgentEvent[] = [];
    loop.onEvent((event) => events.push(event));

    const result = await loop.runTurn("Recover from stream drop");

    expect(client.createStream).toHaveBeenCalledTimes(2);
    expect(result.errors.some((error) => error.type === "api_error")).toBe(false);
    expect(result.response.status).toBe("completed");
    expect(events.some((event) => event.type === "turn_stop_reason" && event.reason === "api-error")).toBe(false);
  });

  // ── Adaptive loop guard ──

  test("аварийный maxAgentIterations останавливает цикл", async () => {
    // Create a client that always returns tool calls (infinite loop)
    const responses: ResponseResource[] = [];
    for (let i = 0; i < 30; i++) {
      responses.push(makeToolCallResponse("loop-tool", `{"n":${i}}`));
    }

    const client = makeClient(responses);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("loop-tool"));
    const loop = new AgentLoop(client, session, tools, "/test", {
      maxAgentIterations: 3,
    });

    const result = await loop.runTurn("Loop forever");

    expect(
      result.errors.some((e) => e.message.includes("emergency agent limit")),
    ).toBe(true);
  });

  test("не останавливает полезную задачу после 25 уникальных итераций", async () => {
    const responses: ResponseResource[] = [];
    for (let i = 0; i < 30; i++) {
      responses.push(makeToolCallResponse("progress-tool", `{"step":${i}}`));
    }
    responses.push(makeTextResponse("All 30 steps complete."));

    const client = makeClient(responses);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("progress-tool"));
    const loop = new AgentLoop(client, session, tools, "/test");

    const result = await loop.runTurn("Complete a long task");

    expect(result.errors).toHaveLength(0);
    expect(
      result.items.filter((item) => item.type === "function_call"),
    ).toHaveLength(30);
    expect(result.response.output.some((item) => item.type === "message")).toBe(
      true,
    );
  });

  test("обнаруживает зацикливание, просит сменить стратегию и продолжает работу", async () => {
    const requests: CreateResponseParams[] = [];
    const repeated = makeToolCallResponse("read", '{"path":"same.ts"}');
    const responses = [
      repeated,
      repeated,
      repeated,
      makeToolCallResponse("bash", '{"command":"bun test"}'),
      makeTextResponse("Done"),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("read"));
    tools.register(makeDummyTool("bash"));
    const loop = new AgentLoop(client, session, tools, "/test", {
      maxStalledIterations: 2,
      maxStallRecoveryAttempts: 1,
      emitEvents: true,
    });
    const events: Array<{ type: string; action?: string }> = [];
    loop.onEvent((event) => events.push(event));

    const result = await loop.runTurn("Solve without looping");

    expect(result.errors).toHaveLength(0);
    expect(requests).toHaveLength(5);
    expect(
      events.some(
        (event) => event.type === "loop_guard" && event.action === "recover",
      ),
    ).toBe(true);
    expect(
      result.items.some(
        (item) =>
          item.type === "message" &&
          item.role === "user" &&
          item.content.some(
            (content) =>
              content.type === "input_text" &&
              content.text.includes("change strategy"),
          ),
      ),
    ).toBe(true);
  });

  // ── Events ──

  test("эмитит события при emitEvents: true", async () => {
    const client = makeClient([makeTextResponse("Hello!")]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    const loop = new AgentLoop(client, session, tools, "/test", {
      emitEvents: true,
    });

    const events: Array<{ type: string }> = [];
    loop.onEvent((e) => events.push(e));

    await loop.runTurn("Hi");

    expect(events.some((e) => e.type === "turn_start")).toBe(true);
    expect(events.some((e) => e.type === "thinking")).toBe(true);
    expect(events.some((e) => e.type === "assistant_message")).toBe(true);
    expect(events.some((e) => e.type === "turn_end")).toBe(true);
  });

  test("эмитит reasoning delta из streaming response", async () => {
    const finalResponse = makeTextResponse("Готово");
    const message = finalResponse.output[0];
    if (message?.type === "message") {
      message.id = "msg_stream";
      message.reasoning_content = "Думаю вслух.";
    }

    const client = {
      ...makeClient([finalResponse]),
      createStream: mock(async function* () {
        yield {
          type: "response.created" as const,
          response: { ...finalResponse, output: [], status: "in_progress" },
        };
        yield {
          type: "response.output_item.added" as const,
          output_index: 0,
          item: {
            type: "message" as const,
            id: "msg_stream",
            status: "in_progress",
            role: "assistant",
            content: [],
          },
        };
        yield {
          type: "response.reasoning.delta" as const,
          item_id: "msg_stream",
          output_index: 0,
          content_index: 0,
          delta: "Думаю ",
        };
        yield {
          type: "response.reasoning.delta" as const,
          item_id: "msg_stream",
          output_index: 0,
          content_index: 0,
          delta: "вслух.",
        };
        yield {
          type: "response.output_text.delta" as const,
          item_id: "msg_stream",
          output_index: 0,
          content_index: 0,
          delta: "Готово",
        };
        yield {
          type: "response.output_item.done" as const,
          output_index: 0,
          item: finalResponse.output[0],
        };
        yield { type: "response.completed" as const, response: finalResponse };
      }),
    };
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    const loop = new AgentLoop(client, session, tools, "/test", {
      emitEvents: true,
      stream: true,
    });

    const reasoningDeltas: string[] = [];
    loop.onEvent((e) => {
      if (e.type === "assistant_reasoning_delta") reasoningDeltas.push(e.delta);
    });

    await loop.runTurn("Hi");

    expect(reasoningDeltas.join("")).toBe("Думаю вслух.");
  });

  test("эмитит tool_call события при использовании инструментов", async () => {
    const client = makeClient([
      makeToolCallResponse("event-tool", '{"input":"x"}'),
      makeTextResponse("Done"),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("event-tool"));
    const loop = new AgentLoop(client, session, tools, "/test", {
      emitEvents: true,
    });

    const events: Array<{ type: string }> = [];
    loop.onEvent((e) => events.push(e));

    await loop.runTurn("Use tool");

    expect(events.some((e) => e.type === "tool_call_start")).toBe(true);
    expect(events.some((e) => e.type === "tool_call_result")).toBe(true);
    expect(events.some((e) => e.type === "tool_call_end")).toBe(true);
  });

  test("flight recorder persists redacted turn artifacts even when event emission is disabled", async () => {
    const client = makeClient([
      makeToolCallResponse("event-tool", '{"input":"x","apiKey":"sk-secret"}'),
      makeFinishResponse("Done"),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("event-tool"));
    const loop = new AgentLoop(client, session, tools, "/test", {
      emitEvents: false,
    });

    await loop.runTurn("Use tool");

    const records = session.getFlightRecords();
    const kinds = records.map((record) => record.data.kind);
    expect(kinds).toContain("prompt_snapshot");
    expect(kinds).toContain("runtime_event");
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_result");
    expect(kinds).toContain("evidence_bundle");
    expect(kinds).toContain("completion_decision");
    expect(JSON.stringify(records)).not.toContain("sk-secret");
    expect(JSON.stringify(records)).toContain("[REDACTED]");
  });

  test("persists accepted finish evidence through the configured proof sink", async () => {
    const client = makeClient([
      makeToolCallResponse("event-tool", '{"input":"x"}'),
      makeFinishResponse("Done"),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("event-tool"));
    const savedBundles: unknown[] = [];
    const proofSink = {
      saveEvidenceBundle: mock(async (bundle: unknown) => {
        savedBundles.push(bundle);
        return {
          path: "/test/.soba/evidence/proof.soba-proof.json",
          proofId: "proof_aaaaaaaaaaaaaaaaaaaaaaaa",
          runId: "run_bbbbbbbbbbbbbbbbbbbbbbbb",
          digest: `sha256:${"c".repeat(64)}`,
        };
      }),
    };
    const loop = new AgentLoop(
      client,
      session,
      tools,
      "/test",
      { emitEvents: false },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      proofSink,
    );

    const result = await loop.runTurn("Use tool");

    expect(proofSink.saveEvidenceBundle).toHaveBeenCalledTimes(1);
    expect(savedBundles).toHaveLength(1);
    expect(savedBundles[0]).toMatchObject({
      version: 1,
      sessionId: session.getSessionId(),
      turnId: "turn_1",
      summary: "Done",
      approvals: [
        {
          toolCallId: "call_1",
          toolName: "event-tool",
          decision: "auto",
          approved: true,
          trustLevel: "normal",
          approvalKind: "tool",
          approvalValue: "event-tool",
        },
      ],
    });
    const evidenceRecord = session
      .getFlightRecords()
      .find((record) => record.data.kind === "evidence_bundle");
    expect(evidenceRecord?.data.payload).toMatchObject({
      proofPath: "/test/.soba/evidence/proof.soba-proof.json",
      proofId: "proof_aaaaaaaaaaaaaaaaaaaaaaaa",
      runId: "run_bbbbbbbbbbbbbbbbbbbbbbbb",
      digest: `sha256:${"c".repeat(64)}`,
    });
    const finalMessage = result.items.at(-1);
    expect(JSON.stringify(finalMessage)).toContain(`Integrity: sealed sha256:${"c".repeat(64)}`);
  });

  test("persists an accepted finish as a sealed proof that the policy validator accepts", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "soba-agent-proof-e2e-"));
    const client = makeClient([
      makeToolCallResponse("event-tool", '{"input":"x"}'),
      makeToolCallResponse("finish", JSON.stringify({
        summary: "Inspected the requested state.",
        status: "completed",
        criteria: [{
          criterion: "Requested state was inspected",
          evidenceIds: ["ev_inspect_call_1"],
        }],
        acknowledged_error_ids: [],
      })),
    ]);
    const session = SessionManager.inMemory(projectRoot);
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("event-tool"));
    const storage = new FilesystemEvidenceProofStorage({ projectRoot });
    const loop = new AgentLoop(
      client,
      session,
      tools,
      projectRoot,
      { emitEvents: false },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      storage,
    );

    await loop.runTurn("Inspect state");

    const persisted = storage.readLatestEvidenceBundle();
    expect(persisted).not.toBeNull();
    const verification = verifyEvidenceProof(persisted!);
    expect(verification.valid).toBe(true);
    expect(verification.accepted).toBe(true);
    expect(verification.outcome).toBe("verified");
    expect(verification.exitCode).toBe(0);
  });

  test("keeps evidence-free finish criteria declared and unlinked", async () => {
    const client = makeClient([
      makeToolCallResponse("edit", '{"path":"src/app.ts","oldText":"a","newText":"b"}', "edit_1"),
      makeToolCallResponse("bash", '{"input":"bun test"}', "bash_1"),
      makeToolCallResponse("finish", JSON.stringify({
        summary: "Changed and tested the file.",
        status: "completed",
        criteria: [{ criterion: "The requested change passes tests" }],
        acknowledged_error_ids: [],
      }), "finish_1"),
    ]);
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("edit"));
    tools.register(makeDummyTool("bash"));
    const savedBundles: Array<Record<string, unknown>> = [];
    const loop = new AgentLoop(
      client,
      SessionManager.inMemory("/test"),
      tools,
      "/test",
      { emitEvents: false },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        saveEvidenceBundle: async (bundle) => {
          savedBundles.push(bundle as unknown as Record<string, unknown>);
          return { path: "/test/proof.json" };
        },
      },
    );

    await loop.runTurn("Change and test src/app.ts");

    expect(savedBundles).toHaveLength(1);
    expect(savedBundles[0]?.status).toBe("unverified");
    expect(savedBundles[0]?.claims).toEqual([
      {
        id: "claim_1",
        claim: "The requested change passes tests",
        status: "unverified",
        evidenceIds: [],
      },
    ]);
  });

  test("не эмитит события при emitEvents: false", async () => {
    const client = makeClient([makeTextResponse("Silent response")]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    const loop = new AgentLoop(client, session, tools, "/test", {
      emitEvents: false,
    });

    let eventCount = 0;
    loop.onEvent(() => eventCount++);

    await loop.runTurn("Hi");

    expect(eventCount).toBe(0);
  });

  test("debug mode сохраняет решения loop как sidecar entries", async () => {
    const client = makeClient([makeTextResponse("Done")]);
    const session = SessionManager.inMemory("/test");
    const loop = new AgentLoop(client, session, new ToolRegistry(), "/test", {
      debug: true,
    });

    await loop.runTurn("Answer");

    expect(session.getDebugEntries().map((entry) => entry.data.event)).toEqual([
      "loop/turn-start",
      "loop/iteration",
      "loop/response",
      "loop/stop",
      "loop/turn-end",
    ]);
    expect(session.getEntries()).toHaveLength(2);
  });

  test("commentary без tool call продолжает loop независимо от текста", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("bash", '{"input":"frontend build"}'),
      makeTextResponse("Промежуточный статус.", "commentary"),
      makeToolCallResponse("bash", '{"input":"backend check"}'),
      makeTextResponse("Фронтенд и бэкенд проверены."),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("bash"));
    const loop = new AgentLoop(
      client,
      SessionManager.inMemory("/test"),
      tools,
      "/test",
    );

    const result = await loop.runTurn("Проверь проект");

    expect(requests).toHaveLength(4);
    expect(result.errors).toHaveLength(0);
    expect(
      result.items.some(
        (item) =>
          item.type === "function_call" &&
          item.arguments.includes("backend check"),
      ),
    ).toBe(true);
  });

  test("unphased текст не завершает ход без явного finish signal", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("bash", '{"input":"docker compose ps"}'),
      makeUnphasedTextResponse("Всё работает. Проверю создание задачи:"),
      makeToolCallResponse("bash", '{"input":"curl -X POST"}'),
      makeFinishResponse("Создание задачи проверено, всё работает."),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("bash"));
    const loop = new AgentLoop(
      client,
      SessionManager.inMemory("/test"),
      tools,
      "/test",
    );

    const result = await loop.runTurn("Запусти и проверь проект");

    expect(requests).toHaveLength(4);
    expect(
      requests.every((request) =>
        request.tools?.some(
          (tool) => tool.type === "function" && tool.name === "finish",
        ),
      ),
    ).toBe(true);
    expect(result.errors).toHaveLength(0);
    const finalMessage = result.items.at(-1);
    expect(finalMessage?.type).toBe("message");
    if (finalMessage?.type === "message" && finalMessage.role === "assistant") {
      expect(finalMessage.phase).toBe("final_answer");
      expect(
        finalMessage.content[0]?.type === "output_text" &&
          finalMessage.content[0].text,
      ).toContain("Создание задачи проверено");
    }
  });

  test("принимает unphased финальный текст, если reasoning явно пытается вызвать finish", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("bash", '{"input":"bun test"}'),
      makeUnphasedTextResponseWithReasoning(
        "Проверка прошла: тесты зелёные, можно завершать.",
        "The user wants me to call finish. Let me do that.",
      ),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("bash"));
    const loop = new AgentLoop(
      client,
      SessionManager.inMemory("/test"),
      tools,
      "/test",
      { maxAutonomousFollowUps: 3 },
    );

    const result = await loop.runTurn("Проверь проект");

    expect(requests).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    const finalMessage = result.items.at(-1);
    expect(finalMessage?.type).toBe("message");
    if (finalMessage?.type === "message" && finalMessage.role === "assistant") {
      expect(
        finalMessage.content[0]?.type === "output_text" &&
          finalMessage.content[0].text,
      ).toContain("Проверка прошла");
    }
  });

  test("finish control tool не исполняется через ToolRegistry", async () => {
    const finishExecutor = mock(async () => ({
      content: [{ type: "text" as const, text: "must not execute" }],
      isError: false,
    }));
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("finish", finishExecutor));
    const requests: CreateResponseParams[] = [];
    const client = makeClient([makeFinishResponse("Готово.")]);
    client.create = mock(async (params: CreateResponseParams) => {
      requests.push(params);
      return makeFinishResponse("Готово.");
    });
    const loop = new AgentLoop(
      client,
      SessionManager.inMemory("/test"),
      tools,
      "/test",
    );

    const result = await loop.runTurn("Сделай задачу");

    expect(finishExecutor).not.toHaveBeenCalled();
    expect(
      requests[0]?.tools?.filter(
        (tool) => tool.type === "function" && tool.name === "finish",
      ),
    ).toHaveLength(1);
    expect(result.items).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  test("completion gate отклоняет finish с active error и принимает после успешного retry", async () => {
    let attempts = 0;
    const responses = [
      makeToolCallResponse("check", '{"input":"verify"}', "check_failed"),
      makeFinishResponse("Готово."),
      makeToolCallResponse("check", '{"input":"verify"}', "check_passed"),
      makeFinishResponse("Проверка успешно завершена."),
    ];
    const tools = new ToolRegistry();
    tools.register(
      makeDummyTool("check", async () => {
        attempts++;
        return attempts === 1
          ? { content: [{ type: "text", text: "check failed" }], isError: true }
          : {
              content: [{ type: "text", text: "check passed" }],
              isError: false,
            };
      }),
    );
    const loop = new AgentLoop(
      makeClient(responses),
      SessionManager.inMemory("/test"),
      tools,
      "/test",
      {
        debug: true,
      },
    );

    const result = await loop.runTurn("Проверь результат");

    expect(attempts).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.status).toBe("resolved");
    expect(result.errors[0]?.resolvedByToolCallId).toBe("check_passed");
    expect(result.activeErrors).toHaveLength(0);
  });

  test("tool_error auto-resolved by forward progress — any successful call after error", async () => {
    const responses = [
      makeToolCallResponse(
        "optional-check",
        '{"input":"git status"}',
        "git_missing",
      ),
      makeToolCallResponse("check", '{"input":"tests"}', "tests_passed"),
      makeFinishResponse("Готово.", ["Requested work is verified"]),
    ];
    const tools = new ToolRegistry();
    tools.register(
      makeDummyTool("optional-check", async () => ({
        content: [{ type: "text", text: "not a git repository" }],
        isError: true,
      })),
    );
    tools.register(makeDummyTool("check"));
    const loop = new AgentLoop(
      makeClient(responses),
      SessionManager.inMemory("/test"),
      tools,
      "/test",
    );

    const result = await loop.runTurn("Проверь результат");

    // Error auto-resolved by forward progress (check succeeded after optional-check failed)
    expect(result.errors[0]?.status).toBe("resolved");
    expect(result.errors[0]?.resolvedByToolCallId).toBe("tests_passed");
    expect(result.activeErrors).toHaveLength(0);
  });

  test("completion gate принимает явно acknowledged error когда успешный вызов был ДО ошибки (no forward progress after)", async () => {
    const responses = [
      makeToolCallResponse("check", '{"input":"tests"}', "tests_passed"),
      makeToolCallResponse(
        "optional-check",
        '{"input":"git status"}',
        "git_missing",
      ),
      makeFinishResponse(
        "Готово с известным ограничением.",
        ["Requested work is verified"],
        ["git_missing"],
      ),
    ];
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("check"));
    tools.register(
      makeDummyTool("optional-check", async () => ({
        content: [{ type: "text", text: "not a git repository" }],
        isError: true,
      })),
    );
    const loop = new AgentLoop(
      makeClient(responses),
      SessionManager.inMemory("/test"),
      tools,
      "/test",
    );

    const result = await loop.runTurn("Проверь результат");

    // Error was NOT auto-resolved (success happened before error, not after)
    // Model explicitly acknowledged it via finish tool
    const gitError = result.errors.find((e) => e.id === "git_missing");
    expect(gitError?.status).toBe("acknowledged");
    expect(result.activeErrors).toHaveLength(0);
  });

  test("completion gate требует verification evidence после последнего изменения", async () => {
    const responses = [
      makeToolCallResponse("edit", '{"input":"first change"}', "edit_1"),
      makeToolCallResponse("bash", '{"input":"test"}', "verify_1"),
      makeToolCallResponse("edit", '{"input":"second change"}', "edit_2"),
      makeFinishResponse("Готово."),
      makeToolCallResponse("bash", '{"input":"test"}', "verify_2"),
      makeFinishResponse("Последнее изменение проверено."),
    ];
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("edit"));
    tools.register(makeDummyTool("bash"));
    const session = SessionManager.inMemory("/test");
    const loop = new AgentLoop(makeClient(responses), session, tools, "/test", {
      debug: true,
    });

    const result = await loop.runTurn("Измени и проверь");

    expect(result.activeErrors).toHaveLength(0);
    expect(
      session
        .getDebugEntries()
        .some((entry) => entry.data.event === "loop/finish-rejected"),
    ).toBe(true);
    expect(
      session
        .getDebugEntries()
        .some((entry) => entry.data.event === "loop/explicit-finish"),
    ).toBe(true);
  });

  test("completed_with_unverified_changes visibly marks final answer when user allowed skipping verification", async () => {
    const responses = [
      makeToolCallResponse("edit", '{"input":"change"}', "edit_1"),
      makeFinishResponse(
        "Изменение внесено, проверки не запускались по разрешению пользователя.",
        ["Patch applied without verification"],
        [],
        "completed_with_unverified_changes",
      ),
    ];
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("edit"));
    const loop = new AgentLoop(
      makeClient(responses),
      SessionManager.inMemory("/test"),
      tools,
      "/test",
    );

    const result = await loop.runTurn("Измени файл, можно без проверок");

    const finalMessage = result.items.at(-1);
    expect(finalMessage?.type).toBe("message");
    if (finalMessage?.type === "message" && finalMessage.role === "assistant") {
      const text = finalMessage.content[0]?.type === "output_text" ? finalMessage.content[0].text : "";
      expect(text).toContain("Completed with unverified changes:");
      expect(text).toContain("**Verified handoff**");
      expect(text).toContain("producer status: unverified");
      expect(text).toContain("verification not run");
      expect(text).toContain("Some file mutations are not covered by passing verification evidence.");
    }
    expect(result.activeErrors).toHaveLength(0);
  });

  test("completion gate останавливает цикл после трёх отклонённых finish", async () => {
    const responses = [
      makeToolCallResponse("bash", '{"input":"test 1"}', "verify_1"),
      makeFinishResponse("Готово.", []),
      makeToolCallResponse("bash", '{"input":"test 2"}', "verify_2"),
      makeFinishResponse("Готово.", []),
      makeToolCallResponse("bash", '{"input":"test 3"}', "verify_3"),
      makeFinishResponse("Готово.", []),
      makeToolCallResponse("bash", '{"input":"must not run"}', "unexpected"),
    ];
    const tools = new ToolRegistry();
    const execute = mock(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      isError: false,
    }));
    tools.register(makeDummyTool("bash", execute));
    const session = SessionManager.inMemory("/test");
    const loop = new AgentLoop(makeClient(responses), session, tools, "/test", {
      debug: true,
    });

    const result = await loop.runTurn("Проверь результат");

    expect(execute).toHaveBeenCalledTimes(3);
    expect(
      result.activeErrors.some((error) =>
        error.message.includes("rejected 3 finish attempts"),
      ),
    ).toBe(true);
    expect(
      session
        .getDebugEntries()
        .filter((entry) => entry.data.event === "loop/finish-rejected"),
    ).toHaveLength(3);
  });

  test("legacy finish без criteria остаётся narrative claim без evidence link", async () => {
    const responses = [
      makeToolCallResponse("bash", '{"input":"test"}', "verify_1"),
      makeLegacyFinishResponseWithoutCriteria(
        "Verification passed and the requested work is complete.",
      ),
      makeToolCallResponse("bash", '{"input":"must not run"}', "unexpected"),
    ];
    const tools = new ToolRegistry();
    const execute = mock(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      isError: false,
    }));
    tools.register(makeDummyTool("bash", execute));
    const session = SessionManager.inMemory("/test");
    const loop = new AgentLoop(makeClient(responses), session, tools, "/test", {
      debug: true,
    });

    const result = await loop.runTurn("Проверь результат");

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.activeErrors).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(
      session
        .getDebugEntries()
        .some((entry) => entry.data.event === "loop/finish-rejected"),
    ).toBe(false);
    expect(
      session
        .getDebugEntries()
        .some((entry) => entry.data.event === "loop/explicit-finish"),
    ).toBe(true);
    const finalMessage = result.items.at(-1);
    expect(finalMessage?.type).toBe("message");
    if (finalMessage?.type === "message" && finalMessage.role === "assistant") {
      const text = finalMessage.content[0]?.type === "output_text" ? finalMessage.content[0].text : "";
      expect(text).toContain("Verification passed");
      expect(text).toContain("**Verified handoff**");
      expect(text).toContain("producer status: unverified");
      expect(text).toContain("unlinked, human review required");
    }
  });

  test("Fix-Until-Green stop возвращает управление модели для blocked finish без turn_error", async () => {
    const events: AgentEvent[] = [];
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("bash", '{"input":"bun test"}', "verify_1"),
      makeToolCallResponse("bash", '{"input":"bun test"}', "verify_2"),
      makeToolCallResponse("bash", '{"input":"bun test"}', "verify_3"),
      makeToolCallResponse("bash", '{"input":"bun test"}', "verify_4"),
      makeBlockedFinishResponse("Blocked: verification still fails after bounded recovery attempts."),
    ];
    let responseIndex = 0;
    let verificationAttempts = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const tools = new ToolRegistry();
    tools.register(
      makeDummyTool("bash", async () => {
        verificationAttempts++;
        return {
          content: [{ type: "text", text: `(fail) still red ${verificationAttempts}` }],
          isError: true,
        };
      }),
    );
    const session = SessionManager.inMemory("/test");
    const loop = new AgentLoop(client, session, tools, "/test", {
      debug: true,
      emitEvents: true,
    });
    loop.onEvent((event) => events.push(event));

    const result = await loop.runTurn("Почини тесты");

    expect(requests).toHaveLength(5);
    expect(events.some((event) => event.type === "turn_error")).toBe(false);
    expect(
      session
        .getDebugEntries()
        .some((entry) => entry.data.event === "loop/explicit-finish"),
    ).toBe(true);
    const recoveryInput = requests[4]?.input;
    expect(Array.isArray(recoveryInput)).toBe(true);
    if (Array.isArray(recoveryInput)) {
      const lastItem = recoveryInput.at(-1);
      expect(lastItem?.type).toBe("message");
      if (lastItem?.type === "message" && lastItem.role === "user") {
        const text = lastItem.content
          .filter((content) => content.type === "input_text")
          .map((content) => content.text)
          .join("");
        expect(text).toContain("Fix-Until-Green stopped after 3 recovery iterations");
        expect(text).toContain("call finish with status blocked");
      }
    }
    const finalMessage = result.items.at(-1);
    expect(finalMessage?.type).toBe("message");
    if (finalMessage?.type === "message" && finalMessage.role === "assistant") {
      const text = finalMessage.content[0]?.type === "output_text" ? finalMessage.content[0].text : "";
      expect(text).toContain("Blocked:");
      expect(text).toContain("**Verified handoff**");
      expect(text).toContain("producer status: blocked");
    }
  });

  test("принимает текстовый ответ без инструментов как финальный, без требования finish", async () => {
    const requests: CreateResponseParams[] = [];
    const client = {
      ...makeClient([
        makeTextResponse("Это консольный агент кодинга.", "commentary"),
      ]),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        return makeTextResponse(
          "Это консольный агент кодинга.",
          "commentary",
        );
      }),
    } as OpenResponsesClient;
    const session = SessionManager.inMemory("/test");
    const loop = new AgentLoop(client, session, new ToolRegistry(), "/test");

    const result = await loop.runTurn("Что это за проект?");

    expect(requests).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.items).toHaveLength(2);
    const assistant = result.items[1];
    expect(assistant?.type).toBe("message");
    if (assistant?.type === "message" && assistant.role === "assistant") {
      expect(
        assistant.content[0]?.type === "output_text" &&
          assistant.content[0].text,
      ).toBe("Это консольный агент кодинга.");
    }
  });

  test("read-only question после inspection tools не требует finish и не supersede-ит ответ", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("read", '{"path":"README.md"}'),
      makeTextResponse("Это консольный агент кодинга.", "commentary"),
      makeFinishResponse("Не должен вызываться"),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("read"));
    const loop = new AgentLoop(client, session, tools, "/test", {
      emitEvents: true,
    });
    const events: AgentEvent[] = [];
    loop.onEvent((event) => events.push(event));

    const result = await loop.runTurn("Что это за проект?");

    expect(requests).toHaveLength(2);
    expect(events.some((event) => event.type === "assistant_message_superseded")).toBe(false);
    expect(result.errors).toHaveLength(0);
    const syntheticNudges = session
      .buildInput()
      .items.filter(
        (item) =>
          item.type === "message" &&
          item.role === "user" &&
          item.content.some(
            (content) =>
              content.type === "input_text" &&
              content.text.includes("Tool-assisted turns must end through finish"),
          ),
      );
    expect(syntheticNudges).toHaveLength(0);
    const assistant = result.items.at(-1);
    expect(assistant?.type).toBe("message");
    if (assistant?.type === "message" && assistant.role === "assistant") {
      expect(
        assistant.content[0]?.type === "output_text" &&
          assistant.content[0].text,
      ).toBe("Это консольный агент кодинга.");
    }
  });

  test("plan mode: inspection tools + plan brief не требует finish auto-continue", async () => {
    const planText = [
      "## Implementation plan",
      "1. Inspect package.json and test layout",
      "2. Add route handler for invoice notes",
      "",
      "### Open questions",
      "- Should notes be versioned?",
      "",
      "### Risks",
      "- Auth middleware order",
      "",
      "### Verification",
      "- bun test",
    ].join("\n");
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("inspect_file", '{"path":"package.json"}'),
      makeTextResponse(planText, "commentary"),
      makeFinishResponse("Не должен вызываться"),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("inspect_file"));
    const loop = new AgentLoop(client, session, tools, "/test", {
      emitEvents: true,
    });
    loop.setWorkMode("plan");

    const result = await loop.runTurn(
      "Составь план реализации invoice notes API. Не меняй файлы.",
    );

    expect(requests).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    const syntheticNudges = session
      .buildInput()
      .items.filter(
        (item) =>
          item.type === "message" &&
          item.role === "user" &&
          item.content.some(
            (content) =>
              content.type === "input_text" &&
              content.text.includes("Tool-assisted turns must end through finish"),
          ),
      );
    expect(syntheticNudges).toHaveLength(0);
    const assistant = result.items.at(-1);
    expect(assistant?.type).toBe("message");
    if (assistant?.type === "message" && assistant.role === "assistant") {
      expect(
        assistant.content[0]?.type === "output_text" &&
          assistant.content[0].text,
      ).toBe(planText);
    }
  });

  test("agent mode: inspection tools + non-final plan-like text всё ещё auto-continue к finish", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("inspect_file", '{"path":"package.json"}'),
      makeTextResponse(
        "Inspected package.json and tests. Next I will implement the route.",
        "commentary",
      ),
      makeFinishResponse("Implementation plan ready."),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("inspect_file"));
    const loop = new AgentLoop(client, session, tools, "/test", {
      emitEvents: true,
      maxAutonomousFollowUps: 3,
    });

    const result = await loop.runTurn("Implement invoice notes API");

    expect(requests.length).toBeGreaterThanOrEqual(3);
    expect(result.errors).toHaveLength(0);
    const syntheticNudges = session
      .buildInput()
      .items.filter(
        (item) =>
          item.type === "message" &&
          item.role === "user" &&
          item.content.some(
            (content) =>
              content.type === "input_text" &&
              content.text.includes("Tool-assisted turns must end through finish"),
          ),
      );
    expect(syntheticNudges.length).toBeGreaterThan(0);
  });

  test("после инструментов без изменения файлов принимает повторяющийся commentary как финальный ответ", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("bash", '{"input":"check"}'),
      makeTextResponse("Проверим результат.", "commentary"),
      makeTextResponse("Сейчас проверю.", "commentary"),
      makeTextResponse("Теперь проверим ещё раз.", "commentary"),
      makeTextResponse("Проверка завершена.", "commentary"),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("bash"));
    const loop = new AgentLoop(client, session, tools, "/test", {
      maxAutonomousFollowUps: 3,
    });

    const result = await loop.runTurn("Проверь проект");

    expect(result.errors).toHaveLength(0);
    expect(
      result.items.some(
        (item) => item.type === "function_call" && item.name === "bash",
      ),
    ).toBe(true);
    const assistant = result.items.at(-1);
    expect(assistant?.type).toBe("message");
    if (assistant?.type === "message" && assistant.role === "assistant") {
      expect(
        assistant.content[0]?.type === "output_text" &&
          assistant.content[0].text,
      ).toContain("Проверка завершена");
    }
  });
  test("сохраняет phase assistant message в сессии", async () => {
    const session = SessionManager.inMemory("/test");
    const loop = new AgentLoop(
      makeClient([makeTextResponse("Финальный ответ", "final_answer")]),
      session,
      new ToolRegistry(),
      "/test",
    );

    await loop.runTurn("Ответь");

    const assistant = session
      .buildInput()
      .items.find(
        (item) => item.type === "message" && item.role === "assistant",
      );
    expect(assistant?.phase).toBe("final_answer");
  });

  // ── Budget tracking ──

  test("эмитит budget_update при tokenBudget > 0", async () => {
    const client = makeClient([makeTextResponse("OK")]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    const loop = new AgentLoop(client, session, tools, "/test", {
      emitEvents: true,
      tokenBudget: 1000,
    });

    const events: Array<{ type: string }> = [];
    loop.onEvent((e) => events.push(e));

    await loop.runTurn("Hi");

    const budgetEvents = events.filter((e) => e.type === "budget_update");
    expect(budgetEvents.length).toBeGreaterThan(0);
  });

  test("usage накапливается между ходами", async () => {
    const client = makeClient([
      makeTextResponse("Response 1"),
      makeTextResponse("Response 2"),
    ]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    const loop = new AgentLoop(client, session, tools, "/test");

    await loop.runTurn("Turn 1");
    const usage1 = loop.getUsage();
    expect(usage1.total_tokens).toBe(150);

    await loop.runTurn("Turn 2");
    const usage2 = loop.getUsage();
    expect(usage2.total_tokens).toBe(300);
  });

  // ── Concurrent protection ──

  test("выбрасывает ошибку при одновременном вызове runTurn", async () => {
    const client = makeClient([makeTextResponse("Slow response")]);
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    const loop = new AgentLoop(client, session, tools, "/test");

    // Don't await — just start it
    const promise = loop.runTurn("First");

    await expect(loop.runTurn("Second")).rejects.toThrow("already processing");
    await promise; // Clean up
  });

  // ── Empty text / thinking-only responses ──

  test("stops with loop-guard when model produces only thinking without visible text", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("bash", '{"input":"check"}'),
      makeTextResponse("", "commentary"),
      makeTextResponse("", "commentary"),
      makeTextResponse("", "commentary"),
      makeTextResponse("", "commentary"),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const session = SessionManager.inMemory("/test");
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("bash"));
    const loop = new AgentLoop(client, session, tools, "/test", {
      maxAutonomousFollowUps: 3,
    });

    const result = await loop.runTurn("Проверь проект");

    // bash → nudge (no nudge for 1st empty) → 3 follow-ups with nudges → loop-guard stop
    // First empty response triggers nudge via getAutonomousFollowUpReason (not counted as follow-up)
    // Then 3 follow-ups are exhausted, then the guard kicks in
    expect(requests.length).toBeGreaterThanOrEqual(4);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].type).toBe("timeout");
    expect(result.errors[0].message).toContain("No visible response");
  });

  test("повторяет reasoning-only ответ до первого tool call вместо преждевременной остановки", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeTextResponse("", "commentary"),
      makeToolCallResponse("bash", '{"input":"check"}'),
      makeFinishResponse("Проверка завершена."),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("bash"));
    const loop = new AgentLoop(client, SessionManager.inMemory("/test"), tools, "/test");

    const result = await loop.runTurn("Измени тему");

    expect(requests).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(
      result.items.some((item) => item.type === "function_call" && item.name === "bash"),
    ).toBe(true);
  });

  test("при active error recovery требует альтернативный tool call и не предлагает finish", async () => {
    const requests: CreateResponseParams[] = [];
    const responses = [
      makeToolCallResponse("bash", '{"input":"rg sun-theme"}', "rg_missing"),
      makeTextResponse("", "commentary"),
      makeToolCallResponse("bash", '{"input":"grep -R sun-theme ."}', "grep_ok"),
      makeFinishResponse("Готово."),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const tools = new ToolRegistry();
    tools.register(
      makeDummyTool("bash", async (args) => ({
        content: [
          {
            type: "text",
            text: String(args.input).startsWith("rg") ? "command not found" : "theme.ts",
          },
        ],
        isError: String(args.input).startsWith("rg"),
      })),
    );
    const loop = new AgentLoop(client, SessionManager.inMemory("/test"), tools, "/test");

    const result = await loop.runTurn("Найди тему");

    expect(result.activeErrors).toHaveLength(0);
    const recoveryInput = requests[2]?.input;
    expect(Array.isArray(recoveryInput)).toBe(true);
    if (Array.isArray(recoveryInput)) {
      const lastItem = recoveryInput.at(-1);
      expect(lastItem?.type).toBe("message");
      if (lastItem?.type === "message" && lastItem.role === "user") {
        const text = lastItem.content
          .filter((content) => content.type === "input_text")
          .map((content) => content.text)
          .join("");
        expect(text).toContain("different available tool or command");
        expect(text).toContain("Do not call finish");
      }
    }
  });

  test("не отправляет reasoning-only ответ обратно модели при восстановлении", async () => {
    const requests: CreateResponseParams[] = [];
    const reasoningOnlyResponse = makeTextResponse("");
    const reasoningMessage = reasoningOnlyResponse.output[0];
    if (reasoningMessage?.type === "message") {
      reasoningMessage.content = [];
      reasoningMessage.reasoning_content = "Сейчас сформулирую ответ.";
    }
    const responses = [
      makeToolCallResponse("bash", '{"input":"check"}'),
      reasoningOnlyResponse,
      makeFinishResponse("Проверка завершена."),
    ];
    let responseIndex = 0;
    const client = {
      ...makeClient(responses),
      create: mock(async (params: CreateResponseParams) => {
        requests.push(params);
        const response = responses[responseIndex];
        responseIndex = Math.min(responseIndex + 1, responses.length - 1);
        return response;
      }),
    } as OpenResponsesClient;
    const tools = new ToolRegistry();
    tools.register(makeDummyTool("bash"));
    const loop = new AgentLoop(client, SessionManager.inMemory("/test"), tools, "/test");

    const result = await loop.runTurn("Проверь проект");

    expect(result.errors).toHaveLength(0);
    expect(requests).toHaveLength(3);
    const recoveryInput = requests[2]?.input;
    expect(Array.isArray(recoveryInput)).toBe(true);
    if (Array.isArray(recoveryInput)) {
      expect(
        recoveryInput.some(
          (item) =>
            item.type === "message" &&
            item.role === "assistant" &&
            item.reasoning_content === "Сейчас сформулирую ответ.",
        ),
      ).toBe(false);
    }
  });

  test("direct shell испускает результат только для ! и останавливается через abortActiveTool", async () => {
    const tools = new ToolRegistry();
    let release: (() => void) | null = null;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    tools.register({
      ...makeDummyTool("bash"),
      async execute(_args, _context, signal) {
        await Promise.race([
          waiting,
          new Promise<void>((resolve) => {
            signal?.addEventListener("abort", () => resolve(), { once: true });
          }),
        ]);
        return {
          content: [{ type: "text", text: signal?.aborted ? "stopped" : "visible output" }],
          isError: Boolean(signal?.aborted),
        };
      },
    });
    const loop = new AgentLoop(makeClient([makeTextResponse("unused")]), SessionManager.inMemory("/test"), tools, "/test", {
      emitEvents: true,
    });
    const events: AgentEvent[] = [];
    loop.onEvent((event) => events.push(event));

    const active = loop.runShellCommand("sleep 10");
    expect(loop.hasActiveTool()).toBe(true);
    expect(loop.abortActiveTool()).toBe(true);
    await active;
    expect(events.map((event) => event.type)).toEqual(["tool_call_start", "tool_call_result", "tool_call_end"]);

    events.length = 0;
    release!();
    await loop.runShellCommand("echo hidden", true);
    expect(events.map((event) => event.type)).toEqual(["tool_call_start", "tool_call_end"]);
  });

  // ── createUserItem helper ──

  test("createUserItem создаёт корректный UserMessageItemParam", () => {
    const item = createUserItem("Hello, world!");

    expect(item.type).toBe("message");
    expect(item.role).toBe("user");
    expect(item.content).toHaveLength(1);
    expect(item.content[0].type).toBe("input_text");
    if (item.content[0].type === "input_text") {
      expect(item.content[0].text).toBe("Hello, world!");
    }
  });
});
