import type {
  CreateResponseParams,
  ErrorPayload,
  ItemParam,
  ResponseResource,
  StreamingEvent,
  Usage,
} from "../../../kernel/model/openresponses-types";
import {
  type ReasoningSelection,
  resolveReasoningSelection,
} from "../../../kernel/model/reasoning";
import type { ProviderCapabilities, ProviderIdentity } from "../../../kernel/transcript/types-v2";
import { classifyOpenAIError } from "./openai-adapter";
import type {
  ProviderAdapter,
  ProviderConfig,
  ProviderErrorKind,
  ProviderRequest,
  ProviderResponse,
} from "./types";

/** Native adapter for OpenAI's /responses API. */
export class OpenAIResponsesAdapter implements ProviderAdapter {
  readonly name = "openai-responses";

  getCreatePath(): string {
    return "/responses";
  }

  getIdentity(config: ProviderConfig): ProviderIdentity {
    let endpointOrigin = config.baseUrl;
    try {
      endpointOrigin = new URL(config.baseUrl).origin;
    } catch {
      // Preserve the configured endpoint when it is not a fully-qualified URL.
    }
    return { adapterId: this.name, endpointOrigin, model: config.model };
  }

  getCapabilities(config: ProviderConfig): ProviderCapabilities {
    const identity = this.getIdentity(config);
    return {
      nativeCompaction: false,
      structuredOutput: true,
      developerMessages: true,
      continuationCompatibilityKey: `${identity.adapterId}::${identity.endpointOrigin}::${identity.model}`,
    };
  }

  classifyError(error: unknown): ProviderErrorKind {
    return classifyOpenAIError(error);
  }

  convertRequest(params: CreateResponseParams, config: ProviderConfig): ProviderRequest {
    const request: ProviderRequest = {
      model: params.model ?? config.model,
      input: sanitizeInput(params.input),
      stream: params.stream ?? false,
    };
    copyDefined(request, params, [
      "instructions",
      "previous_response_id",
      "tools",
      "tool_choice",
      "metadata",
      "text",
      "parallel_tool_calls",
      "background",
      "store",
      "service_tier",
      "safety_identifier",
      "prompt_cache_key",
      "truncation",
    ]);

    const maxOutputTokens = params.max_completion_tokens ?? params.max_output_tokens;
    if (maxOutputTokens != null) request.max_output_tokens = maxOutputTokens;
    if (params.temperature != null) request.temperature = params.temperature;
    if (params.top_p != null) request.top_p = params.top_p;
    if (params.presence_penalty != null) request.presence_penalty = params.presence_penalty;
    if (params.frequency_penalty != null) request.frequency_penalty = params.frequency_penalty;

    const requested = reasoningParamToSelection(params);
    const { effective } = resolveReasoningSelection(requested, config.reasoningCapabilities);
    if (effective.mode === "effort") {
      request.reasoning = {
        effort: effective.effort,
        ...(params.reasoning?.summary != null ? { summary: params.reasoning.summary } : {}),
      };
      const include = new Set(params.include ?? []);
      include.add("reasoning.encrypted_content");
      request.include = [...include];
      if (effective.effort !== "none") {
        delete request.temperature;
        delete request.top_p;
        delete request.presence_penalty;
        delete request.frequency_penalty;
      }
    } else if (params.include?.length) {
      request.include = [...params.include];
    }
    return request;
  }

  convertResponse(raw: ProviderResponse, config: ProviderConfig): ResponseResource {
    const source = raw as Partial<ResponseResource> & { error?: ErrorPayload | null };
    const now = Math.floor(Date.now() / 1000);
    return {
      id: typeof source.id === "string" ? source.id : `resp_${Date.now().toString(36)}`,
      object: "response",
      created_at: typeof source.created_at === "number" ? source.created_at : now,
      completed_at: typeof source.completed_at === "number" ? source.completed_at : null,
      status: typeof source.status === "string" ? source.status : source.error ? "failed" : "completed",
      incomplete_details: source.incomplete_details ?? null,
      model: typeof source.model === "string" ? source.model : config.model,
      previous_response_id: source.previous_response_id ?? null,
      instructions: source.instructions ?? null,
      output: Array.isArray(source.output) ? structuredClone(source.output) : [],
      error: source.error ?? null,
      tools: Array.isArray(source.tools) ? structuredClone(source.tools) : [],
      tool_choice: source.tool_choice ?? "auto",
      truncation: source.truncation ?? "disabled",
      parallel_tool_calls: source.parallel_tool_calls ?? true,
      text: source.text ?? {},
      top_p: source.top_p ?? 1,
      presence_penalty: source.presence_penalty ?? 0,
      frequency_penalty: source.frequency_penalty ?? 0,
      top_logprobs: source.top_logprobs ?? 0,
      temperature: source.temperature ?? 1,
      reasoning: source.reasoning ?? null,
      usage: normalizeUsage(source.usage),
      max_output_tokens: source.max_output_tokens ?? null,
      max_tool_calls: source.max_tool_calls ?? null,
      store: source.store ?? false,
      background: source.background ?? false,
      service_tier: source.service_tier ?? "default",
      metadata: source.metadata ?? {},
      safety_identifier: source.safety_identifier ?? null,
      prompt_cache_key: source.prompt_cache_key ?? null,
    };
  }

  convertStreamChunk(raw: unknown): StreamingEvent[] {
    return normalizeResponsesEvent(raw);
  }

  createStreamAccumulator(): Record<string, never> {
    return {};
  }

  processStreamLine(data: string, _state: unknown): StreamingEvent[] {
    if (!data || data === "[DONE]") return [];
    try {
      return normalizeResponsesEvent(JSON.parse(data));
    } catch {
      return [];
    }
  }

  isStreamComplete(event: StreamingEvent): boolean {
    return event.type === "response.completed" || event.type === "response.failed";
  }

  isStreamError(event: StreamingEvent): { isError: boolean; errorMessage?: string } {
    return event.type === "response.failed"
      ? { isError: true, errorMessage: event.error.message }
      : { isError: false };
  }

  buildResponseFromStream(events: StreamingEvent[], config: ProviderConfig): ResponseResource {
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event?.type === "response.completed" || event?.type === "response.created") {
        return event.response;
      }
    }
    return this.convertResponse({}, config);
  }
}

function reasoningParamToSelection(params: CreateResponseParams): ReasoningSelection {
  if (params.reasoning?.effort != null) return { mode: "effort", effort: params.reasoning.effort };
  if (params.reasoning?.max_tokens != null) return { mode: "budget", maxTokens: params.reasoning.max_tokens };
  if (params.reasoning?.enabled != null) return { mode: "toggle", enabled: params.reasoning.enabled };
  return { mode: "provider_default" };
}

function sanitizeInput(input: CreateResponseParams["input"]): CreateResponseParams["input"] {
  if (!Array.isArray(input)) return input;
  return input.map((item) => {
    if (item.type !== "message" && item.type !== "function_call") return structuredClone(item);
    const clone = structuredClone(item) as ItemParam & Record<string, unknown>;
    delete clone.reasoning_content;
    delete clone.reasoning_details;
    return clone;
  });
}

function copyDefined(
  target: ProviderRequest,
  source: CreateResponseParams,
  keys: Array<keyof CreateResponseParams>,
): void {
  const record = source as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) target[key] = structuredClone(value);
  }
}

function normalizeUsage(usage: Usage | null | undefined): Usage | null {
  if (!usage) return null;
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    total_tokens: usage.total_tokens ?? 0,
    input_tokens_details: { cached_tokens: usage.input_tokens_details?.cached_tokens ?? 0 },
    output_tokens_details: { reasoning_tokens: usage.output_tokens_details?.reasoning_tokens ?? 0 },
  };
}

function normalizeResponsesEvent(raw: unknown): StreamingEvent[] {
  if (!raw || typeof raw !== "object") return [];
  const event = raw as Record<string, unknown>;
  const type = event.type;
  if (type === "response.failed") {
    const response = asRecord(event.response);
    const error = asRecord(event.error) ?? asRecord(response?.error);
    return [{
      type: "response.failed",
      error: {
        code: typeof error?.code === "string" ? error.code : "response_failed",
        message: typeof error?.message === "string" ? error.message : "OpenAI Responses request failed",
        ...(typeof error?.param === "string" || error?.param === null ? { param: error.param } : {}),
        ...(typeof error?.type === "string" ? { type: error.type } : {}),
      },
    }];
  }
  if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
    return [{
      type: "response.reasoning.delta",
      item_id: String(event.item_id ?? ""),
      output_index: typeof event.output_index === "number" ? event.output_index : 0,
      content_index: typeof event.content_index === "number"
        ? event.content_index
        : typeof event.summary_index === "number"
          ? event.summary_index
          : 0,
      delta: typeof event.delta === "string" ? event.delta : "",
    }];
  }
  if (
    type === "response.created" ||
    type === "response.in_progress" ||
    type === "response.completed" ||
    type === "response.output_item.added" ||
    type === "response.output_item.done" ||
    type === "response.output_text.delta" ||
    type === "response.function_call_arguments.delta" ||
    type === "response.function_call_arguments.done" ||
    type === "error"
  ) {
    return [event as unknown as StreamingEvent];
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}
