/**
 * OpenResponses Client.
 *
 * Provides create() and compact() methods that delegate to the configured
 * provider adapter (middleware). The agent loop talks to this client
 * using OpenResponses types; the client delegates to the middleware
 * which translates to/from provider-specific APIs.
 *
 * Phase 1: only OpenAI adapter via middleware.
 */

import type { SobaConfig } from "../../../application/config/types";
import type { ModelCompatibilityFeature } from "../../../application/providers/types";
import type {
  CompactResource,
  CompactResponseParams,
  CreateResponseParams,
  ResponseResource,
  StreamingEvent,
} from "../../../kernel/model/openresponses-types";
import {
  DEFAULT_REASONING_SELECTION,
  type ReasoningCapabilities,
  type ReasoningSelection,
  type ReasoningTransport,
  resolveReasoningSelection,
} from "../../../kernel/model/reasoning";
import type {
  NativeContinuation,
  ProviderCapabilities,
  ProviderIdentity,
} from "../../../kernel/transcript/types-v2";
import { OpenAIAdapter } from "../openai/openai-adapter";
import type {
  NativeCompactionInput,
  ProviderAdapter,
  ProviderErrorKind,
} from "../openai/types";

const SOBA_APP_NAME = "soba-agent";
const SOBA_APP_URL = "https://github.com/avacadorun-dev/soba-agent";

// ─── Types ───

export interface OpenResponsesClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  modelCompatibility?: ModelCompatibilityFeature[];
  /** Maximum output tokens per response (text only). */
  maxOutputTokens: number;
  maxCompletionTokens: number;
  contextWindow: number;
  temperature: number;
  reasoning?: ReasoningSelection;
  reasoningEffective?: ReasoningSelection;
  reasoningFallbackReason?: string;
  modelReasoning?: ReasoningCapabilities;
  modelReasoningTransport?: ReasoningTransport;
}

export interface OpenResponsesClient {
  /**
   * Create a response using the configured provider adapter.
   *
   * Sends the items + instructions to the LLM and returns
   * a ResponseResource containing the output items.
   */
  create(params: CreateResponseParams, options?: { signal?: AbortSignal }): Promise<ResponseResource>;

  /**
   * Create a response with SSE streaming.
   *
   * Returns an async iterable of StreamingEvents.
   */
  createStream(params: CreateResponseParams, options?: { signal?: AbortSignal }): AsyncIterable<StreamingEvent>;

  /**
   * Compact context using the OpenResponses compact endpoint
   * (or provider-specific equivalent).
   *
   * Returns a CompactResource containing the compaction item.
   */
  compact(params: CompactResponseParams): Promise<CompactResource>;

  /** Return the active provider identity. */
  getProviderIdentity(): ProviderIdentity;

  /** Return the active provider capabilities. */
  getProviderCapabilities(): ProviderCapabilities;

  /** Classify a provider or transport error. */
  classifyError(error: unknown): ProviderErrorKind;

  /** Execute provider-native compaction when supported. */
  compactNative(
    input: NativeCompactionInput,
    signal: AbortSignal,
  ): Promise<NativeContinuation>;

  /** Get the current configuration */
  getConfig(): OpenResponsesClientConfig;

  /** Update configuration (e.g., model change via /model command) */
  updateConfig(partial: Partial<OpenResponsesClientConfig>): void;
}

// ─── Implementation ───

export class OpenResponsesClientImpl implements OpenResponsesClient {
  private config: OpenResponsesClientConfig;
  private adapter: ProviderAdapter;
  private runtimeReasoningFallbackReason: string | undefined;
  private runtimeModelCompatibility = new Set<ModelCompatibilityFeature>();

  constructor(sobaConfig: SobaConfig, adapter?: ProviderAdapter) {
    this.config = {
      baseUrl: sobaConfig.baseUrl,
      apiKey: sobaConfig.apiKey,
      model: sobaConfig.model,
      modelCompatibility: sobaConfig.modelCompatibility
        ? [...sobaConfig.modelCompatibility]
        : undefined,
      maxOutputTokens: sobaConfig.maxOutputTokens,
      maxCompletionTokens: sobaConfig.maxCompletionTokens,
      contextWindow: sobaConfig.contextWindow,
      temperature: sobaConfig.temperature,
      reasoning: structuredClone(sobaConfig.reasoning ?? DEFAULT_REASONING_SELECTION),
      modelReasoning: sobaConfig.modelReasoning
        ? structuredClone(sobaConfig.modelReasoning)
        : undefined,
      modelReasoningTransport: sobaConfig.modelReasoningTransport,
    };

    this.adapter = adapter ?? new OpenAIAdapter();
  }

  getConfig(): OpenResponsesClientConfig {
    const resolvedReasoning = resolveReasoningSelection(
      this.config.reasoning ?? DEFAULT_REASONING_SELECTION,
      this.config.modelReasoning,
    );
    const effectiveReasoning = this.runtimeReasoningFallbackReason
      ? DEFAULT_REASONING_SELECTION
      : resolvedReasoning.effective;
    return {
      ...this.config,
      modelCompatibility: this.config.modelCompatibility
        ? [...this.config.modelCompatibility]
        : undefined,
      reasoning: structuredClone(this.config.reasoning),
      modelReasoning: this.config.modelReasoning
        ? structuredClone(this.config.modelReasoning)
        : undefined,
      reasoningEffective: structuredClone(effectiveReasoning),
      reasoningFallbackReason: this.runtimeReasoningFallbackReason ?? resolvedReasoning.fallbackReason,
    };
  }

  getProviderIdentity(): ProviderIdentity {
    return this.adapter.getIdentity(this.getProviderConfig());
  }

  getProviderCapabilities(): ProviderCapabilities {
    return this.adapter.getCapabilities(this.getProviderConfig());
  }

  classifyError(error: unknown): ProviderErrorKind {
    return this.adapter.classifyError(error);
  }

  async compactNative(
    input: NativeCompactionInput,
    signal: AbortSignal,
  ): Promise<NativeContinuation> {
    if (!this.adapter.compactNative) {
      throw new Error(
        `Provider adapter "${this.adapter.name}" does not support native compaction`,
      );
    }
    return this.adapter.compactNative(input, signal);
  }

  updateConfig(partial: Partial<OpenResponsesClientConfig>): void {
    if (
      partial.model !== undefined ||
      partial.reasoning !== undefined ||
      "modelReasoning" in partial ||
      "modelReasoningTransport" in partial
    ) {
      this.runtimeReasoningFallbackReason = undefined;
    }
    if (
      partial.baseUrl !== undefined ||
      partial.model !== undefined ||
      "modelCompatibility" in partial
    ) {
      this.runtimeModelCompatibility.clear();
    }
    if (partial.baseUrl !== undefined) this.config.baseUrl = partial.baseUrl;
    if (partial.apiKey !== undefined) this.config.apiKey = partial.apiKey;
    if (partial.model !== undefined) this.config.model = partial.model;
    if ("modelCompatibility" in partial) {
      this.config.modelCompatibility = partial.modelCompatibility
        ? [...partial.modelCompatibility]
        : undefined;
    }
    if (partial.maxOutputTokens !== undefined) this.config.maxOutputTokens = partial.maxOutputTokens;
    if (partial.maxCompletionTokens !== undefined) this.config.maxCompletionTokens = partial.maxCompletionTokens;
    if (partial.contextWindow !== undefined) this.config.contextWindow = partial.contextWindow;
    if (partial.temperature !== undefined) this.config.temperature = partial.temperature;
    if (partial.reasoning !== undefined) this.config.reasoning = structuredClone(partial.reasoning);
    if ("modelReasoning" in partial) {
      this.config.modelReasoning = partial.modelReasoning
        ? structuredClone(partial.modelReasoning)
        : undefined;
    }
    if ("modelReasoningTransport" in partial) {
      this.config.modelReasoningTransport = partial.modelReasoningTransport;
    }
  }

  async create(params: CreateResponseParams, options: { signal?: AbortSignal } = {}): Promise<ResponseResource> {
    let request = this.convertCreateRequest(params, false);
    let response = await this.sendRequest(request, { signal: options.signal });

    while (true) {
      if (
        isSingleSystemMessageResponse(response) &&
        this.enableRuntimeCompatibility("single_system_message")
      ) {
        request = this.convertCreateRequest(params, false);
        response = await this.sendRequest(request, { signal: options.signal, retries: 0 });
        continue;
      }

      if (hasReasoningWireControl(request) && isUnsupportedReasoningResponse(response)) {
        this.runtimeReasoningFallbackReason = "Provider rejected the reasoning control; provider default was used.";
        request = this.convertCreateRequest(params, false);
        response = await this.sendRequest(request, { signal: options.signal, retries: 0 });
        continue;
      }

      break;
    }

    // Convert response back to OpenResponses format
    return this.adapter.convertResponse(response, this.getProviderConfig());
  }

  async *createStream(params: CreateResponseParams, options: { signal?: AbortSignal } = {}): AsyncIterable<StreamingEvent> {
    const adapter = this.adapter as ProviderAdapter & {
      createStreamAccumulator(): unknown;
      processStreamLine(data: string, state: unknown): StreamingEvent[];
    };

    let request = this.convertCreateRequest(params, true);

    const url = `${this.config.baseUrl.replace(/\/$/, "")}${this.adapter.getCreatePath?.() ?? "/chat/completions"}`;

    const retries = 3;
    const baseDelay = 1000;
    let hasYieldedEvents = false;

    let networkRetryAttempt = 0;
    while (true) {
      const accumulator = adapter.createStreamAccumulator();

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: this.getRequestHeaders(),
          body: JSON.stringify(request),
          signal: signalWithTimeout(options.signal, 300000),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "Unknown error");
          if (
            isSingleSystemMessageError(response.status, errorText) &&
            this.enableRuntimeCompatibility("single_system_message")
          ) {
            request = this.convertCreateRequest(params, true);
            continue;
          }
          if (
            hasReasoningWireControl(request) &&
            isUnsupportedReasoningError(response.status, errorText)
          ) {
            this.runtimeReasoningFallbackReason = "Provider rejected the reasoning control; provider default was used.";
            request = this.convertCreateRequest(params, true);
            continue;
          }
          yield {
            type: "response.failed",
            error: {
              code: `http_${response.status}`,
              message: `HTTP ${response.status}: ${errorText}`,
            },
          };
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          yield {
            type: "response.failed",
            error: {
              code: "no_response_body",
              message: "No response body received from provider",
            },
          };
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let sawDoneEvent = false;

        const yieldEvents = async function* (events: StreamingEvent[]) {
          for (const event of events) {
            hasYieldedEvents = true;
            yield event;
          }
        };

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (value) {
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed?.startsWith("data:")) continue;
                const data = trimmed.slice(5).trim();
                if (data === "[DONE]") {
                  sawDoneEvent = true;
                  yield* yieldEvents(adapter.processStreamLine("[DONE]", accumulator));
                  continue;
                }

                yield* yieldEvents(adapter.processStreamLine(data, accumulator));
              }
            }

            if (done) break;
          }

          const remaining = buffer.trim();
          if (remaining.startsWith("data:")) {
            const data = remaining.slice(5).trim();
            if (data === "[DONE]") {
              sawDoneEvent = true;
              yield* yieldEvents(adapter.processStreamLine("[DONE]", accumulator));
            } else if (data) {
              yield* yieldEvents(adapter.processStreamLine(data, accumulator));
            }
          }

          if (!sawDoneEvent) {
            yield* yieldEvents(adapter.processStreamLine("[DONE]", accumulator));
          }
        } finally {
          reader.releaseLock();
        }

        return;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (!hasYieldedEvents && networkRetryAttempt < retries && this.isNetworkError(error)) {
          const delay = baseDelay * 2 ** networkRetryAttempt;
          networkRetryAttempt++;
          await sleepWithAbort(delay, options.signal);
          continue;
        }
        throw error;
      }
    }
  }

  async compact(params: CompactResponseParams): Promise<CompactResource> {
    let request = this.convertCompactRequest(params);

    if (!this.adapter.convertCompactResponse) {
      throw new Error(`Provider adapter "${this.adapter.name}" does not support compact response conversion`);
    }

    let response = await this.sendRequest(request);

    if (
      isSingleSystemMessageResponse(response) &&
      this.enableRuntimeCompatibility("single_system_message")
    ) {
      request = this.convertCompactRequest(params);
      response = await this.sendRequest(request, { retries: 0 });
    }

    const providerError = readProviderResponseError(response);
    if (providerError) {
      const status = providerError.status ? ` (${providerError.status})` : "";
      throw new Error(`Provider compaction request failed${status}: ${providerError.message}`);
    }

    const compactResponse = this.adapter.convertCompactResponse(response);
    const compactionItem = compactResponse.output.find((item) => item.type === "compaction");
    if (
      compactionItem?.type !== "compaction" ||
      typeof compactionItem.encrypted_content !== "string" ||
      compactionItem.encrypted_content.trim().length === 0
    ) {
      throw new Error("Provider compaction response did not contain a non-empty compaction item");
    }

    return compactResponse;
  }

  /**
   * Send a provider-specific request (non-streaming).
   * Includes retry logic with exponential backoff for 429/5xx errors.
   */
  private async sendRequest(
    request: Record<string, unknown>,
    options: { signal?: AbortSignal; retries?: number; baseDelay?: number } = {},
  ): Promise<Record<string, unknown>> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}${this.adapter.getCreatePath?.() ?? "/chat/completions"}`;
    const retries = options.retries ?? 3;
    const baseDelay = options.baseDelay ?? 1000;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: this.getRequestHeaders(),
          body: JSON.stringify(request),
          signal: signalWithTimeout(options.signal, 120000),
        });

        // Rate limiting or server error → retry
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          const delay = baseDelay * 2 ** attempt;
          const retryAfter = response.headers.get("retry-after");
          const waitMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : delay;
          await sleepWithAbort(waitMs, options.signal);
          continue;
        }

        const contentType = response.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
          const payload = (await response.json()) as Record<string, unknown>;
          return response.ok ? payload : attachHttpStatus(payload, response.status);
        }

        const text = await response.text();
        return { error: { status: response.status, message: text } };
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (attempt < retries && this.isNetworkError(error)) {
          const delay = baseDelay * 2 ** attempt;
          await sleepWithAbort(delay, options.signal);
          continue;
        }
        throw error;
      }
    }

    throw new Error("Max retries exceeded");
  }

  private isNetworkError(error: unknown): boolean {
    if (error instanceof Error) {
      return (
        error.name === "TimeoutError" ||
        error.message.includes("fetch") ||
        error.message.includes("network") ||
        error.message.includes("socket") ||
        error.message.includes("connection") ||
        error.message.includes("ECONNREFUSED") ||
        error.message.includes("ECONNRESET") ||
        error.message.includes("ENOTFOUND")
      );
    }
    return false;
  }

  private getRequestHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "HTTP-Referer": SOBA_APP_URL,
      "X-Title": SOBA_APP_NAME,
      "User-Agent": SOBA_APP_NAME,
    };
  }

  private getProviderConfig() {
    const compatibility = new Set(this.config.modelCompatibility);
    for (const feature of this.runtimeModelCompatibility) compatibility.add(feature);

    return {
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      model: this.config.model,
      compatibility: compatibility.size > 0 ? [...compatibility] : undefined,
      reasoning: this.config.reasoning,
      reasoningCapabilities: this.config.modelReasoning,
      reasoningTransport: this.config.modelReasoningTransport,
    };
  }

  private convertCreateRequest(
    params: CreateResponseParams,
    stream: boolean,
  ): Record<string, unknown> {
    const request = this.adapter.convertRequest(
      { ...params, stream },
      this.getProviderConfig(),
    );
    return this.runtimeReasoningFallbackReason
      ? stripReasoningWireControl(request)
      : request;
  }

  private convertCompactRequest(params: CompactResponseParams): Record<string, unknown> {
    const request = this.adapter.convertCompactRequest?.(params, this.getProviderConfig());
    if (!request) {
      throw new Error(`Provider adapter "${this.adapter.name}" does not support compaction`);
    }
    return request;
  }

  private enableRuntimeCompatibility(feature: ModelCompatibilityFeature): boolean {
    if (
      this.config.modelCompatibility?.includes(feature) ||
      this.runtimeModelCompatibility.has(feature)
    ) {
      return false;
    }
    this.runtimeModelCompatibility.add(feature);
    return true;
  }
}

const REASONING_WIRE_KEYS = [
  "reasoning_effort",
  "reasoning",
  "thinking",
  "enable_thinking",
  "thinking_budget",
  "think",
] as const;

function hasReasoningWireControl(request: Record<string, unknown>): boolean {
  return REASONING_WIRE_KEYS.some((key) => key in request);
}

function stripReasoningWireControl(request: Record<string, unknown>): Record<string, unknown> {
  const stripped = { ...request };
  for (const key of REASONING_WIRE_KEYS) delete stripped[key];
  return stripped;
}

function isUnsupportedReasoningResponse(response: Record<string, unknown>): boolean {
  const error = response.error;
  if (!error || typeof error !== "object") return false;
  const status = typeof (error as Record<string, unknown>).status === "number"
    ? (error as Record<string, unknown>).status as number
    : 400;
  return isUnsupportedReasoningError(status, JSON.stringify(error));
}

function isUnsupportedReasoningError(status: number, message: string): boolean {
  if (status < 400 || status >= 500) return false;
  const normalized = message.toLowerCase();
  const mentionsControl = /reasoning|thinking|effort|enable_thinking|think/.test(normalized);
  const rejectsControl = /unsupported|not supported|unknown|unrecognized|invalid|extra|unexpected|not permitted/.test(normalized);
  return mentionsControl && rejectsControl;
}

function isSingleSystemMessageResponse(response: Record<string, unknown>): boolean {
  const error = response.error;
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const status = parseHttpStatus(record.status) ?? parseHttpStatus(record.code);
  return status !== undefined && isSingleSystemMessageError(status, JSON.stringify(error));
}

function isSingleSystemMessageError(status: number, message: string): boolean {
  if (status < 400 || status >= 500) return false;
  const normalized = message.toLowerCase();
  if (!/system (?:message|role)/.test(normalized)) return false;
  return (
    /must be at (?:the )?beginning/.test(normalized) ||
    /must (?:appear|be) (?:only )?(?:at|in) (?:the )?(?:beginning|first position)/.test(normalized) ||
    /must be (?:the )?first/.test(normalized) ||
    /only one system (?:message|role)/.test(normalized) ||
    /at most one system (?:message|role)/.test(normalized) ||
    /multiple system (?:messages|roles)/.test(normalized)
  );
}

function parseHttpStatus(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string" || !/^\d{3}$/.test(value.trim())) return undefined;
  return Number.parseInt(value, 10);
}

function readProviderResponseError(
  response: Record<string, unknown>,
): { status?: number; message: string } | undefined {
  const error = response.error;
  if (typeof error === "string" && error.trim().length > 0) {
    return { message: error.trim() };
  }
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;

  const record = error as Record<string, unknown>;
  const status = parseHttpStatus(record.status) ?? parseHttpStatus(record.code);
  const message = typeof record.message === "string" && record.message.trim().length > 0
    ? record.message.trim()
    : "Provider returned an error response.";
  return { ...(status !== undefined ? { status } : {}), message };
}

function attachHttpStatus(
  payload: Record<string, unknown>,
  status: number,
): Record<string, unknown> {
  const error = payload.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return payload;
  }
  const record = error as Record<string, unknown>;
  if (parseHttpStatus(record.status) !== undefined) return payload;
  return { ...payload, error: { ...record, status } };
}

function signalWithTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  const abortSignalAny = (AbortSignal as typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
  }).any;
  if (abortSignalAny) return abortSignalAny([signal, timeoutSignal]);
  if (signal.aborted) return signal;

  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  signal.addEventListener("abort", abort, { once: true });
  timeoutSignal.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

async function sleepWithAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) {
    await Bun.sleep(ms);
    return;
  }
  if (signal.aborted) throw new Error("Operation cancelled by user");

  await Promise.race([
    Bun.sleep(ms),
    new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Operation cancelled by user")), { once: true });
    }),
  ]);
}

/**
 * Factory function to create an OpenResponses client from SobaConfig.
 */
export function createOpenResponsesClient(config: SobaConfig, adapter?: ProviderAdapter): OpenResponsesClient {
  return new OpenResponsesClientImpl(config, adapter);
}
