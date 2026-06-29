/**
 * Middleware types — provider adapter interface.
 *
 * Middleware sits between the OpenResponses-typed agent loop
 * and provider-specific APIs (OpenAI, Anthropic, Groq, etc.).
 *
 * Phase 1: only OpenAI adapter.
 * Phase 2: explicit provider identity, capabilities, error classification,
 *           developer message handling, and native compaction contract.
 */

import type {
  CompactResource,
  CompactResponseParams,
  CreateResponseParams,
  ResponseResource,
  StreamingEvent,
} from "../../../kernel/model/openresponses-types";
import type { ItemParam } from "../../../kernel/transcript/types";
import type { NativeContinuation, ProviderCapabilities, ProviderIdentity } from "../../../kernel/transcript/types-v2";

/**
 * Configuration for the provider middleware.
 */
export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Provider-specific request type (adapter-dependent).
 */
export type ProviderRequest = Record<string, unknown>;

/**
 * Provider-specific response type (adapter-dependent).
 */
export type ProviderResponse = Record<string, unknown>;

/**
 * Input for the native compact API (provider-specific).
 */
export interface NativeCompactionInput {
  model: string;
  input: ItemParam[];
  instructions?: string;
  previousResponseId?: string;
}

/**
 * Error kinds that a provider can return.
 *
 * - context_overflow: the request was too large for the context window
 * - rate_limit: request was throttled
 * - authentication: invalid or missing API key
 * - timeout: request timed out
 * - transient: temporary server-side error (5xx, network)
 * - unknown: unclassified error
 */
export type ProviderErrorKind = "context_overflow" | "rate_limit" | "authentication" | "timeout" | "transient" | "unknown";

/**
 * Provider adapter interface.
 *
 * Each adapter translates OpenResponses-typed requests into
 * provider-specific API requests, and provider responses back
 * into OpenResponses-typed responses.
 *
 * Phase 2 additions:
 * - getIdentity / getCapabilities: explicit provider declaration
 * - classifyError: typed error classification
 * - compactNative: optional native compact API
 * - Developer message handling contract (see docs)
 */
export interface ProviderAdapter {
  /** Human-readable name for logging/debugging */
  readonly name: string;

  // ─── Phase 2: Identity & Capabilities ───

  /**
   * Return the identity of this provider for the given config.
   * Used to key native continuation compatibility.
   */
  getIdentity(config: ProviderConfig): ProviderIdentity;

  /**
   * Declare what this provider supports.
   *
   * - nativeCompaction: true only if compactNative is implemented and works.
   * - Generic OpenAI-compatible adapters default to nativeCompaction: false.
   * - developerMessages: true if the provider accepts role="developer" natively.
   *   When false, the adapter MUST convert developer messages to system messages
   *   with a visible marker prefix, preserving order. It MUST NOT silently drop them.
   */
  getCapabilities(config: ProviderConfig): ProviderCapabilities;

  /**
   * Classify an error (transport exception or failed provider response)
   * into a typed ProviderErrorKind.
   *
   * context_overflow recovery is triggered ONLY when this returns "context_overflow".
   * Must accept both Error objects and provider response bodies.
   */
  classifyError(error: unknown): ProviderErrorKind;

  // ─── Phase 1: Core request/response conversion ───

  /**
   * Convert OpenResponses CreateResponseParams to provider-specific request.
   */
  convertRequest(params: CreateResponseParams, config: ProviderConfig): ProviderRequest;

  /**
   * Convert provider-specific response to OpenResponses ResponseResource.
   */
  convertResponse(raw: ProviderResponse, config: ProviderConfig): ResponseResource;

  /**
   * Parse a single SSE chunk from the provider streaming response
   * into zero or more OpenResponses StreamingEvents.
   *
   * Returns an array because one SSE line may yield multiple events
   * (e.g., OpenAI's delta + finish_reason).
   */
  convertStreamChunk(raw: unknown): StreamingEvent[];

  /**
   * Check if a streaming event indicates the stream is complete.
   */
  isStreamComplete(event: StreamingEvent): boolean;

  /**
   * Check if a streaming event is an error.
   */
  isStreamError(event: StreamingEvent): { isError: boolean; errorMessage?: string };

  /**
   * Extract the final ResponseResource from accumulated streaming events.
   */
  buildResponseFromStream(events: StreamingEvent[], config: ProviderConfig): ResponseResource;

  // ─── Phase 1 (legacy): Summary-based compaction ───

  /**
   * Convert OpenResponses CompactResponseParams to provider-specific request.
   *
   * In phase 1 (OpenAI), compaction is handled through a separate
   * compact endpoint. If the provider doesn't support it natively,
   * returns null (caller should use a different strategy).
   */
  convertCompactRequest?(params: CompactResponseParams, config: ProviderConfig): ProviderRequest | null;

  /**
   * Convert provider-specific compact response to OpenResponses CompactResource.
   */
  convertCompactResponse?(raw: ProviderResponse): CompactResource;

  // ─── Phase 2: Native compact API ───

  /**
   * Call the provider's native compact API.
   *
   * Only present when getCapabilities().nativeCompaction === true.
   * The returned NativeContinuation.compatibilityKey must be non-empty.
   * Signal is used for cancellation (background compaction).
   */
  compactNative?(input: NativeCompactionInput, signal: AbortSignal): Promise<NativeContinuation>;
}

// Re-export Phase 2 types used by adapter consumers
export type { NativeContinuation, ProviderCapabilities, ProviderIdentity };
