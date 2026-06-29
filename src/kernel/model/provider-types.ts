import type { ItemParam } from "../transcript/types";

export interface NativeCompactionInput {
  model: string;
  input: ItemParam[];
  instructions?: string;
  previousResponseId?: string;
}

export type ProviderErrorKind = "context_overflow" | "rate_limit" | "authentication" | "timeout" | "transient" | "unknown";
