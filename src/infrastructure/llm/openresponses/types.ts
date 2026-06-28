/**
 * OpenResponses Client types.
 *
 * TypeScript types mirroring the OpenResponses API specification
 * based on the OpenResponses API contract.
 * These are the canonical types used throughout the agent loop.
 */

// ─── Content blocks ───

export interface InputTextContent {
  type: "input_text";
  text: string;
}

export interface OutputTextContent {
  type: "output_text";
  text: string;
  annotations?: Array<{ type: "url_citation"; url: string; title?: string }>;
}

export type TextContent = InputTextContent | OutputTextContent;

export interface RefusalContent {
  type: "refusal";
  refusal: string;
}

export interface InputImageContent {
  type: "input_image";
  image_url: string;
  detail?: "auto" | "low" | "high";
}

// ─── Message items (input) ───

export interface UserMessageItemParam {
  type: "message";
  role: "user";
  content: Array<InputTextContent | InputImageContent>;
  id?: string | null;
  status?: string | null;
}

export interface AssistantMessageItemParam {
  type: "message";
  role: "assistant";
  content: Array<OutputTextContent | RefusalContent>;
  id?: string | null;
  status?: string | null;
  phase?: "commentary" | "final_answer";
  reasoning_content?: string;
}

export interface SystemMessageItemParam {
  type: "message";
  role: "system";
  content: Array<InputTextContent>;
  id?: string | null;
  status?: string | null;
}

export interface DeveloperMessageItemParam {
  type: "message";
  role: "developer";
  content: Array<InputTextContent>;
  id?: string | null;
  status?: string | null;
}

// ─── Function call items ───

export interface FunctionCallItemParam {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
  id?: string | null;
  status?: "in_progress" | "completed" | "failed" | null;
  reasoning_content?: string;
}

export interface FunctionCallOutputItemParam {
  type: "function_call_output";
  call_id: string;
  output: string | Array<InputTextContent>;
  id?: string | null;
  status?: string | null;
}

// ─── Local shell call items ───

export interface LocalShellCallItemParam {
  type: "local_shell_call";
  call_id: string;
  command: string;
  id?: string | null;
  status?: string | null;
}

export interface LocalShellCallOutputItemParam {
  type: "local_shell_call_output";
  call_id: string;
  output: string;
  exit_code?: number;
  truncated?: boolean;
  id?: string | null;
  status?: string | null;
}

// ─── Compaction ───

export interface CompactionSummaryItemParam {
  type: "compaction";
  encrypted_content: string;
  id?: string | null;
}

export interface ReasoningItemParam {
  type: "reasoning";
  encrypted_content: string;
  id?: string | null;
}

// ─── Item reference (for passing items by reference) ───

export interface ItemReferenceParam {
  type: "item_reference";
  id: string;
}

// ─── ItemParam union ───

export type ItemParam =
  | UserMessageItemParam
  | AssistantMessageItemParam
  | SystemMessageItemParam
  | DeveloperMessageItemParam
  | FunctionCallItemParam
  | FunctionCallOutputItemParam
  | LocalShellCallItemParam
  | LocalShellCallOutputItemParam
  | CompactionSummaryItemParam
  | ReasoningItemParam
  | ItemReferenceParam;

// ─── Tools ───

export interface FunctionToolParam {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface LocalShellToolParam {
  type: "local_shell";
}

export type ToolParam = FunctionToolParam | LocalShellToolParam;

// ─── Tool choice ───

export type ToolChoiceParam = "auto" | "none" | "required" | { type: "function"; name: string };

// ─── Reasoning ───

export interface ReasoningParam {
  effort?: "low" | "medium" | "high" | null;
  summary?: "auto" | null;
}

// ─── Truncation ───

export type TruncationEnum = "auto" | "disabled";

// ─── Text format ───

export interface TextParam {
  format:
    | { type: "text" }
    | { type: "json_object" }
    | { type: "json_schema"; name: string; schema: Record<string, unknown> };
}

// ─── Streaming options ───

export interface StreamOptionsParam {
  include_usage?: boolean;
}

// ─── Create Response ───

export interface CreateResponseParams {
  model?: string;
  input?: ItemParam[] | string;
  previous_response_id?: string | null;
  include?: Array<"message.input_image.image_url" | "file_search_call.results">;
  tools?: ToolParam[] | null;
  tool_choice?: ToolChoiceParam | null;
  metadata?: Record<string, unknown> | null;
  text?: TextParam | null;
  temperature?: number | null;
  top_p?: number | null;
  presence_penalty?: number | null;
  frequency_penalty?: number | null;
  parallel_tool_calls?: boolean | null;
  stream?: boolean;
  stream_options?: StreamOptionsParam | null;
  background?: boolean;
  max_output_tokens?: number | null;
  /**
   * Maximum completion tokens (includes reasoning/thinking + output).
   * OpenAI-compatible standard — works across all providers.
   */
  max_completion_tokens?: number | null;
  max_tool_calls?: number | null;
  reasoning?: ReasoningParam | null;
  safety_identifier?: string | null;
  prompt_cache_key?: string | null;
  truncation?: TruncationEnum;
  instructions?: string | null;
  store?: boolean;
  service_tier?: "auto" | "default";
  top_logprobs?: number | null;
}

// ─── Response ───

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details: {
    cached_tokens: number;
  };
  output_tokens_details: {
    reasoning_tokens: number;
  };
}

export interface IncompleteDetails {
  reason: "max_output_tokens" | "content_filter" | "interrupted" | "token_budget_exceeded";
}

export interface ResponseResource {
  id: string;
  object: "response";
  created_at: number;
  completed_at: number | null;
  status: string;
  incomplete_details: IncompleteDetails | null;
  model: string;
  previous_response_id: string | null;
  instructions: string | null;
  output: ItemField[];
  error: ErrorPayload | null;
  tools: ToolParam[];
  tool_choice: ToolChoiceParam;
  truncation: TruncationEnum;
  parallel_tool_calls: boolean;
  text: Record<string, unknown>;
  top_p: number;
  presence_penalty: number;
  frequency_penalty: number;
  top_logprobs: number;
  temperature: number;
  reasoning: Record<string, unknown> | null;
  usage: Usage | null;
  max_output_tokens: number | null;
  max_tool_calls: number | null;
  store: boolean;
  background: boolean;
  service_tier: string;
  metadata: Record<string, unknown>;
  safety_identifier: string | null;
  prompt_cache_key: string | null;
}

// ─── ItemField (output items in response) ───

export interface MessageField {
  type: "message";
  id: string;
  status: string;
  role: string;
  content: Array<OutputTextContent | RefusalContent>;
  phase?: "commentary" | "final_answer";
  reasoning_content?: string;
}

export interface FunctionCallField {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status: string;
  reasoning_content?: string;
}

export interface FunctionCallOutputField {
  type: "function_call_output";
  id: string;
  call_id: string;
  output: string | Array<InputTextContent>;
  status: string;
}

export interface ReasoningField {
  type: "reasoning";
  id: string;
  encrypted_content: string;
}

export interface CompactionField {
  type: "compaction";
  id: string;
  encrypted_content: string;
  created_by?: string;
}

export type ItemField = MessageField | FunctionCallField | FunctionCallOutputField | ReasoningField | CompactionField;

// ─── Error ───

export interface ErrorPayload {
  code: string;
  message: string;
  param?: string | null;
  type?: string;
}

// ─── Compact Request/Response ───

export interface CompactResponseParams {
  model: string;
  input?: ItemParam[] | string;
  previous_response_id?: string | null;
  instructions?: string | null;
  prompt_cache_key?: string | null;
}

export interface CompactResource {
  id: string;
  object: "response.compaction";
  output: ItemField[];
  created_at: number;
  usage: Usage;
}

// ─── Streaming Events ───

export interface ResponseCreatedStreamingEvent {
  type: "response.created";
  response: ResponseResource;
}

export interface ResponseInProgressStreamingEvent {
  type: "response.in_progress";
}

export interface ResponseCompletedStreamingEvent {
  type: "response.completed";
  response: ResponseResource;
}

export interface ResponseFailedStreamingEvent {
  type: "response.failed";
  error: ErrorPayload;
}

export interface ResponseOutputItemAddedStreamingEvent {
  type: "response.output_item.added";
  item: ItemField;
  output_index: number;
}

export interface ResponseOutputItemDoneStreamingEvent {
  type: "response.output_item.done";
  item: ItemField;
  output_index: number;
}

export interface ResponseOutputTextDeltaStreamingEvent {
  type: "response.output_text.delta";
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseReasoningDeltaStreamingEvent {
  type: "response.reasoning.delta";
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseFunctionCallArgumentsDeltaStreamingEvent {
  type: "response.function_call_arguments.delta";
  item_id: string;
  output_index: number;
  delta: string;
}

export interface ResponseFunctionCallArgumentsDoneStreamingEvent {
  type: "response.function_call_arguments.done";
  item_id: string;
  output_index: number;
  arguments: string;
}

export interface ErrorStreamingEvent {
  type: "error";
  error: ErrorPayload;
}

export type StreamingEvent =
  | ResponseCreatedStreamingEvent
  | ResponseInProgressStreamingEvent
  | ResponseCompletedStreamingEvent
  | ResponseFailedStreamingEvent
  | ResponseOutputItemAddedStreamingEvent
  | ResponseOutputItemDoneStreamingEvent
  | ResponseOutputTextDeltaStreamingEvent
  | ResponseReasoningDeltaStreamingEvent
  | ResponseFunctionCallArgumentsDeltaStreamingEvent
  | ResponseFunctionCallArgumentsDoneStreamingEvent
  | ErrorStreamingEvent;
