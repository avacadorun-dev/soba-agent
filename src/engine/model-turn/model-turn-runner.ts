import type { OpenResponsesClient } from "../../kernel/model/model-gateway";
import type {
  CreateResponseParams,
  FunctionCallField,
  MessageField,
  OutputTextContent,
  ResponseResource,
} from "../../kernel/model/openresponses-types";
import type { AgentEvent } from "../turn/types";

export interface ModelTurnRunnerOptions {
  stream: boolean;
  emit?: (event: AgentEvent) => void;
  now?: () => number;
}

export interface ModelTurnResult {
  response: ResponseResource;
  assistantMessages: MessageField[];
  toolCalls: FunctionCallField[];
}

export function extractTextFromOutput(item: MessageField): string {
  return item.content
    .filter((content): content is OutputTextContent => content.type === "output_text")
    .map((content) => content.text)
    .join("");
}

export class ModelTurnRunner {
  private readonly client: OpenResponsesClient;
  private readonly stream: boolean;
  private readonly emit?: (event: AgentEvent) => void;
  private readonly now: () => number;

  constructor(client: OpenResponsesClient, options: ModelTurnRunnerOptions) {
    this.client = client;
    this.stream = options.stream;
    this.emit = options.emit;
    this.now = options.now ?? Date.now;
  }

  async run(request: CreateResponseParams): Promise<ModelTurnResult> {
    const assistantMessages: MessageField[] = [];
    const toolCalls: FunctionCallField[] = [];
    const response = this.stream
      ? await this.runStreamingRequest(request, assistantMessages, toolCalls)
      : await this.runNonStreamingRequest(request, assistantMessages, toolCalls);

    return {
      response,
      assistantMessages,
      toolCalls,
    };
  }

  private async runNonStreamingRequest(
    request: CreateResponseParams,
    assistantMessages: MessageField[],
    toolCalls: FunctionCallField[],
  ): Promise<ResponseResource> {
    const response = await this.client.create(request);
    for (const item of response.output) {
      if (item.type === "function_call") {
        toolCalls.push(item as FunctionCallField);
      } else if (item.type === "message") {
        assistantMessages.push(item as MessageField);
      }
    }

    for (const message of assistantMessages) {
      const text = extractTextFromOutput(message);
      if (!text) continue;
      this.emitEvent({
        type: "assistant_message",
        timestamp: this.now(),
        messageId: message.id,
        text,
        reasoningContent: message.reasoning_content,
      });
    }

    return response;
  }

  private async runStreamingRequest(
    request: CreateResponseParams,
    assistantMessages: MessageField[],
    toolCalls: FunctionCallField[],
  ): Promise<ResponseResource> {
    let finalResponse: ResponseResource | null = null;
    const currentFcArgs: Map<number, { id: string; name: string; args: string }> = new Map();
    const currentReasoning = new Map<string, string>();

    for await (const event of this.client.createStream(request)) {
      switch (event.type) {
        case "response.created":
          finalResponse = event.response;
          break;

        case "response.output_item.added": {
          const item = event.item;

          if (item.type === "message") {
            const reasoning = currentReasoning.get(item.id);
            if (reasoning) {
              (item as MessageField).reasoning_content = reasoning;
            }
            assistantMessages.push(item as MessageField);
            this.emitEvent({
              type: "assistant_message_start",
              timestamp: this.now(),
              messageId: item.id,
            });
          } else if (item.type === "function_call") {
            const functionCall = item as FunctionCallField;
            toolCalls.push(functionCall);

            if (functionCall.arguments) {
              this.emitEvent({
                type: "function_call_done",
                timestamp: this.now(),
                toolCallId: functionCall.call_id,
                toolName: functionCall.name,
                arguments: functionCall.arguments,
              });
            }
          }
          break;
        }

        case "response.reasoning.delta": {
          const previous = currentReasoning.get(event.item_id) ?? "";
          const next = previous + event.delta;
          currentReasoning.set(event.item_id, next);

          const message = assistantMessages.find((item) => item.id === event.item_id);
          if (message) {
            message.reasoning_content = next;
          }

          this.emitEvent({
            type: "assistant_reasoning_delta",
            timestamp: this.now(),
            messageId: event.item_id,
            delta: event.delta,
          });
          break;
        }

        case "response.output_text.delta": {
          this.emitEvent({
            type: "assistant_text_delta",
            timestamp: this.now(),
            messageId: event.item_id,
            delta: event.delta,
          });

          const message = assistantMessages.find((item) => item.id === event.item_id);
          if (message) {
            if (message.content.length === 0) {
              message.content.push({
                type: "output_text",
                text: event.delta,
                annotations: [],
              });
            } else {
              const lastContent = message.content[message.content.length - 1];
              if (lastContent.type === "output_text") {
                lastContent.text += event.delta;
              }
            }
          }
          break;
        }

        case "response.output_item.done": {
          const item = event.item;

          if (item.type === "message") {
            this.emitEvent({
              type: "assistant_text_done",
              timestamp: this.now(),
              messageId: item.id,
              fullText: extractTextFromOutput(item),
              reasoningContent: (item as MessageField).reasoning_content,
            });

            const index = assistantMessages.findIndex((message) => message.id === item.id);
            if (index >= 0) {
              assistantMessages[index] = item as MessageField;
            }
          } else if (item.type === "function_call") {
            const functionCall = item as FunctionCallField;
            const index = toolCalls.findIndex((toolCall) => toolCall.call_id === functionCall.call_id);
            if (index >= 0) {
              toolCalls[index] = functionCall;
            }
          }
          break;
        }

        case "response.function_call_arguments.delta": {
          const functionCall = currentFcArgs.get(event.output_index) ?? {
            id: event.item_id,
            name: "",
            args: "",
          };
          functionCall.id = event.item_id;
          functionCall.args += event.delta;
          currentFcArgs.set(event.output_index, functionCall);

          this.emitEvent({
            type: "function_call_delta",
            timestamp: this.now(),
            toolCallId: event.item_id,
            toolName: functionCall.name,
            delta: event.delta,
          });
          break;
        }

        case "response.function_call_arguments.done": {
          const functionCall = currentFcArgs.get(event.output_index);
          if (functionCall) {
            functionCall.args = event.arguments;
            currentFcArgs.set(event.output_index, functionCall);

            const toolCall = toolCalls.find((item) => item.call_id === event.item_id);
            if (toolCall) {
              toolCall.arguments = event.arguments;
            }

            this.emitEvent({
              type: "function_call_done",
              timestamp: this.now(),
              toolCallId: event.item_id,
              toolName: functionCall.name,
              arguments: event.arguments,
            });
          }
          break;
        }

        case "response.completed":
          finalResponse = event.response;
          break;

        case "response.failed":
          throw new Error(event.error.message);
      }
    }

    if (!finalResponse) {
      throw new Error("Stream completed without a final response");
    }

    return finalResponse;
  }

  private emitEvent(event: AgentEvent): void {
    this.emit?.(event);
  }
}
