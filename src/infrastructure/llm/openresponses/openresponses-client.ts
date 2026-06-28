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

import type { SobaConfig } from "../../../core/config/types";
import { OpenAIAdapter } from "../../../core/middleware/openai-adapter";
import type {
  NativeCompactionInput,
  ProviderAdapter,
  ProviderErrorKind,
} from "../../../core/middleware/types";
import type {
  NativeContinuation,
  ProviderCapabilities,
  ProviderIdentity,
} from "../../../core/session/types-v2";
import type {
  CompactResource,
  CompactResponseParams,
  CreateResponseParams,
  ResponseResource,
  StreamingEvent,
} from "./types";

const SOBA_APP_NAME = "soba-agent";
const SOBA_APP_URL = "https://github.com/avacadorun-dev/soba-agent";

// ─── Types ───

export interface OpenResponsesClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Maximum output tokens per response (text only). */
  maxOutputTokens: number;
  maxCompletionTokens: number;
  contextWindow: number;
  temperature: number;
}

export interface OpenResponsesClient {
  /**
   * Create a response using the configured provider adapter.
   *
   * Sends the items + instructions to the LLM and returns
   * a ResponseResource containing the output items.
   */
  create(params: CreateResponseParams): Promise<ResponseResource>;

  /**
   * Create a response with SSE streaming.
   *
   * Returns an async iterable of StreamingEvents.
   */
  createStream(params: CreateResponseParams): AsyncIterable<StreamingEvent>;

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

  constructor(sobaConfig: SobaConfig, adapter?: ProviderAdapter) {
    this.config = {
      baseUrl: sobaConfig.baseUrl,
      apiKey: sobaConfig.apiKey,
      model: sobaConfig.model,
      maxOutputTokens: sobaConfig.maxOutputTokens,
      maxCompletionTokens: sobaConfig.maxCompletionTokens,
      contextWindow: sobaConfig.contextWindow,
      temperature: sobaConfig.temperature,
    };

    this.adapter = adapter ?? new OpenAIAdapter();
  }

  getConfig(): OpenResponsesClientConfig {
    return { ...this.config };
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
    if (partial.baseUrl !== undefined) this.config.baseUrl = partial.baseUrl;
    if (partial.apiKey !== undefined) this.config.apiKey = partial.apiKey;
    if (partial.model !== undefined) this.config.model = partial.model;
    if (partial.maxOutputTokens !== undefined) this.config.maxOutputTokens = partial.maxOutputTokens;
    if (partial.maxCompletionTokens !== undefined) this.config.maxCompletionTokens = partial.maxCompletionTokens;
    if (partial.contextWindow !== undefined) this.config.contextWindow = partial.contextWindow;
    if (partial.temperature !== undefined) this.config.temperature = partial.temperature;
  }

  async create(params: CreateResponseParams): Promise<ResponseResource> {
    // Convert to provider-specific request
    const request = this.adapter.convertRequest(
      { ...params, stream: false },
      this.getProviderConfig(),
    );

    // Send to provider
    const response = await this.sendRequest(request);

    // Convert response back to OpenResponses format
    return this.adapter.convertResponse(response, this.getProviderConfig());
  }

  async *createStream(params: CreateResponseParams): AsyncIterable<StreamingEvent> {
    const adapter = this.adapter as OpenAIAdapter;

    const request = this.adapter.convertRequest(
      { ...params, stream: true },
      this.getProviderConfig(),
    );

    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const retries = 3;
    const baseDelay = 1000;
    let hasYieldedEvents = false;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const accumulator = adapter.createStreamAccumulator();

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: this.getRequestHeaders(),
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(300000),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "Unknown error");
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
        if (!hasYieldedEvents && attempt < retries && this.isNetworkError(error)) {
          const delay = baseDelay * 2 ** attempt;
          await Bun.sleep(delay);
          continue;
        }
        throw error;
      }
    }
  }

  async compact(params: CompactResponseParams): Promise<CompactResource> {
    const providerParams = this.adapter.convertCompactRequest?.(params, {
      ...this.getProviderConfig(),
    });

    if (!providerParams) {
      throw new Error(`Provider adapter "${this.adapter.name}" does not support compaction`);
    }

    const response = await this.sendRequest(providerParams);

    if (!this.adapter.convertCompactResponse) {
      throw new Error(`Provider adapter "${this.adapter.name}" does not support compact response conversion`);
    }

    return this.adapter.convertCompactResponse(response);
  }

  /**
   * Send a provider-specific request (non-streaming).
   * Includes retry logic with exponential backoff for 429/5xx errors.
   */
  private async sendRequest(
    request: Record<string, unknown>,
    retries = 3,
    baseDelay = 1000,
  ): Promise<Record<string, unknown>> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: this.getRequestHeaders(),
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(120000),
        });

        // Rate limiting or server error → retry
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          const delay = baseDelay * 2 ** attempt;
          const retryAfter = response.headers.get("retry-after");
          const waitMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : delay;
          await Bun.sleep(waitMs);
          continue;
        }

        const contentType = response.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
          return (await response.json()) as Record<string, unknown>;
        }

        const text = await response.text();
        return { error: { status: response.status, message: text } };
      } catch (error) {
        if (attempt < retries && this.isNetworkError(error)) {
          const delay = baseDelay * 2 ** attempt;
          await Bun.sleep(delay);
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
    return {
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      model: this.config.model,
    };
  }
}

/**
 * Factory function to create an OpenResponses client from SobaConfig.
 */
export function createOpenResponsesClient(config: SobaConfig, adapter?: ProviderAdapter): OpenResponsesClient {
  return new OpenResponsesClientImpl(config, adapter);
}
