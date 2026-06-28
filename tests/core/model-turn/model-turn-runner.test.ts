import { describe, expect, test } from "bun:test";
import { ModelTurnRunner } from "../../../src/engine/model-turn/model-turn-runner";
import type { AgentEvent } from "../../../src/engine/turn/types";
import type { OpenResponsesClient } from "../../../src/infrastructure/llm/openresponses/openresponses-client";
import type {
  CreateResponseParams,
  FunctionCallField,
  MessageField,
  ResponseResource,
  StreamingEvent,
} from "../../../src/kernel/model/openresponses-types";

function message(id: string, text: string): MessageField {
  return {
    type: "message",
    id,
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
    phase: "final_answer",
  };
}

function functionCall(id: string, name: string, args: string): FunctionCallField {
  return {
    type: "function_call",
    id,
    call_id: id,
    name,
    arguments: args,
    status: "completed",
  };
}

function response(output: ResponseResource["output"]): ResponseResource {
  return {
    id: "resp_model_turn",
    object: "response",
    created_at: 1,
    completed_at: 2,
    status: "completed",
    incomplete_details: null,
    model: "test-model",
    previous_response_id: null,
    instructions: null,
    output,
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
    usage: null,
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

function clientFrom(input: {
  create?: (params: CreateResponseParams) => Promise<ResponseResource>;
  streamEvents?: StreamingEvent[];
}): OpenResponsesClient {
  return {
    create: input.create ?? (async () => response([])),
    createStream: async function* () {
      for (const event of input.streamEvents ?? []) {
        yield event;
      }
    },
  } as unknown as OpenResponsesClient;
}

describe("ModelTurnRunner", () => {
  test("normalizes non-streaming assistant messages and tool calls", async () => {
    const assistant = message("msg_1", "done");
    const call = functionCall("call_1", "read", '{"path":"README.md"}');
    const events: AgentEvent[] = [];
    const runner = new ModelTurnRunner(clientFrom({
      create: async () => response([assistant, call]),
    }), {
      stream: false,
      now: () => 123,
      emit: (event) => events.push(event),
    });

    const result = await runner.run({ model: "test-model", input: [] });

    expect(result.response.id).toBe("resp_model_turn");
    expect(result.assistantMessages).toEqual([assistant]);
    expect(result.toolCalls).toEqual([call]);
    expect(events).toEqual([
      {
        type: "assistant_message",
        timestamp: 123,
        messageId: "msg_1",
        text: "done",
        reasoningContent: undefined,
      },
    ]);
  });

  test("normalizes streaming deltas, final message content, and function calls", async () => {
    const addedMessage: MessageField = {
      type: "message",
      id: "msg_stream",
      status: "in_progress",
      role: "assistant",
      content: [],
    };
    const finalMessage = message("msg_stream", "hello");
    const finalCall = functionCall("call_stream", "write", '{"path":"x"}');
    const finalResponse = response([finalMessage, finalCall]);
    const events: AgentEvent[] = [];
    const runner = new ModelTurnRunner(clientFrom({
      streamEvents: [
        { type: "response.created", response: response([]) },
        { type: "response.output_item.added", output_index: 0, item: addedMessage },
        { type: "response.reasoning.delta", item_id: "msg_stream", output_index: 0, content_index: 0, delta: "thinking" },
        { type: "response.output_text.delta", item_id: "msg_stream", output_index: 0, content_index: 0, delta: "hel" },
        { type: "response.output_text.delta", item_id: "msg_stream", output_index: 0, content_index: 0, delta: "lo" },
        { type: "response.output_item.done", output_index: 0, item: finalMessage },
        { type: "response.output_item.added", output_index: 1, item: functionCall("call_stream", "write", "") },
        { type: "response.function_call_arguments.delta", item_id: "call_stream", output_index: 1, delta: '{"path":' },
        { type: "response.function_call_arguments.done", item_id: "call_stream", output_index: 1, arguments: '{"path":"x"}' },
        { type: "response.output_item.done", output_index: 1, item: finalCall },
        { type: "response.completed", response: finalResponse },
      ],
    }), {
      stream: true,
      now: () => 456,
      emit: (event) => events.push(event),
    });

    const result = await runner.run({ model: "test-model", input: [] });

    expect(result.response).toBe(finalResponse);
    expect(result.assistantMessages).toEqual([finalMessage]);
    expect(result.toolCalls).toEqual([finalCall]);
    expect(events.map((event) => event.type)).toEqual([
      "assistant_message_start",
      "assistant_reasoning_delta",
      "assistant_text_delta",
      "assistant_text_delta",
      "assistant_text_done",
      "function_call_delta",
      "function_call_done",
    ]);
  });

  test("throws when streaming completes without a final response", async () => {
    const runner = new ModelTurnRunner(clientFrom({ streamEvents: [] }), {
      stream: true,
    });

    await expect(runner.run({ model: "test-model", input: [] })).rejects.toThrow("Stream completed without a final response");
  });
});
