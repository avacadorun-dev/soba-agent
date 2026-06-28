import type { NativeContinuation, ProviderCapabilities, ProviderIdentity } from "../transcript/types-v2";
import type { CompactResource, CompactResponseParams, CreateResponseParams, ResponseResource, StreamingEvent } from "./openresponses-types";
import type { NativeCompactionInput, ProviderErrorKind } from "./provider-types";

export interface OpenResponsesClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  maxCompletionTokens: number;
  contextWindow: number;
  temperature: number;
}

export interface OpenResponsesClient {
  create(params: CreateResponseParams): Promise<ResponseResource>;
  createStream(params: CreateResponseParams): AsyncIterable<StreamingEvent>;
  compact(params: CompactResponseParams): Promise<CompactResource>;
  getProviderIdentity(): ProviderIdentity;
  getProviderCapabilities(): ProviderCapabilities;
  classifyError(error: unknown): ProviderErrorKind;
  compactNative(input: NativeCompactionInput, signal: AbortSignal): Promise<NativeContinuation>;
  getConfig(): OpenResponsesClientConfig;
  updateConfig(partial: Partial<OpenResponsesClientConfig>): void;
}
