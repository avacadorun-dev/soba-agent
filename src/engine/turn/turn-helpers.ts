import type {
  AssistantMessageItemParam,
  CreateResponseParams,
  FunctionCallField,
  FunctionCallItemParam,
  FunctionToolParam,
  ItemParam,
  MessageField,
  OutputTextContent,
  ResponseResource,
} from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import { type CheckpointArgs, type CheckpointEvent } from "../../kernel/tools/checkpoint";
import { resolveToolSemantics, type ToolSemantics } from "../../kernel/tools/semantics";
import type { ToolRegistry } from "../../kernel/tools/tool-registry";
import type { ToolResult } from "../../kernel/tools/types";
import type { InputImageContent, InputTextContent, UserMessageItemParam } from "../../kernel/transcript/types";
import { isRestrictedWorkMode, type WorkMode } from "../../kernel/work-mode/public";
import type { AutoVerifierToolCall } from "../verification/auto-verifier";
import { DEFAULT_FULL_VERIFICATION_PHRASES } from "../verification/task-intent-lexicon";
import type { TaskKind } from "../verification/verification-policy";
import { assistantTextMarkers, containsAssistantTextMarker } from "./assistant-text-lexicon";
import type { AgentTurnError, CheckpointWorkPlanState } from "./types";

export const FINISH_TOOL_NAME = "finish";

const FINISH_TOOL: FunctionToolParam = {
  type: "function",
  name: FINISH_TOOL_NAME,
  description:
    "Finish the current user turn. Call this only when the task is complete, explicitly unverified with permission, or blocked on required user input. Put the final user-facing response in summary.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "The final user-facing response.",
      },
      status: {
        type: "string",
        description:
          "Use completed when verified work is done, completed_with_unverified_changes only when unverified completion is explicitly allowed, or blocked when required work cannot continue.",
        enum: ["completed", "blocked", "completed_with_unverified_changes"],
      },
      criteria: {
        type: "array",
        description:
          "Concrete completion claims. The loop validates them against successful tool execution.",
        items: {
          type: "object",
          properties: {
            criterion: {
              type: "string",
              description: "A concrete completion criterion.",
            },
            evidenceIds: {
              type: "array",
              description: "Optional Evidence Ledger entry IDs supporting this criterion.",
              items: { type: "string" },
            },
          },
          required: ["criterion"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "status", "criteria"],
    additionalProperties: false,
  },
  strict: true,
};

/**
 * User-authored content accepted by the agent loop.
 */
export type UserInputContent = Array<InputTextContent | InputImageContent>;

export type AgentUserInput = string | UserInputContent;

/**
 * Create a UserMessageItemParam from text or mixed user content.
 */
export function createUserItem(input: AgentUserInput): UserMessageItemParam {
  return {
    type: "message",
    role: "user",
    content: typeof input === "string" ? [{ type: "input_text", text: input }] : input,
  };
}

export function userInputToText(input: AgentUserInput): string {
  if (typeof input === "string") return input;
  return input
    .map((part) => {
      if (part.type === "input_text") return part.text;
      if (!part.image_url.startsWith("data:")) return "[Image: image]";
      const metadataEnd = part.image_url.indexOf(";");
      return `[Image: ${metadataEnd > 5 ? part.image_url.slice(5, metadataEnd) : "image"}]`;
    })
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

export function createLoopErrorResponse(): ResponseResource {
  return {
    id: "",
    object: "response",
    created_at: 0,
    completed_at: 0,
    status: "failed",
    incomplete_details: null,
    model: "",
    previous_response_id: null,
    instructions: null,
    output: [],
    error: { code: "loop_error", message: "No response received" },
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

export function extractToolResultText(result: ToolResult): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}

export function safeParseArgs(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function extractCommandArgument(args: Record<string, unknown>): string {
  if (typeof args.command === "string") return args.command;
  return typeof args.input === "string" ? args.input : "";
}

export function summarizeMutationToolCall(toolName: string, args: Record<string, unknown>): string {
  const path = typeof args.path === "string" ? args.path : "";
  return path ? `${toolName} changed ${path}` : `${toolName} changed project files`;
}

export function toCheckpointArgs(args: Record<string, unknown>): CheckpointArgs | null {
  const kind = args.kind;
  const reason = args.reason;
  if ((kind !== "milestone" && kind !== "plan_pivot") || typeof reason !== "string") {
    return null;
  }

  return {
    kind,
    reason,
    nextDirection: typeof args.nextDirection === "string" ? args.nextDirection : undefined,
    completed: toStringArray(args.completed),
    pending: toStringArray(args.pending),
  };
}

export function checkpointEventToPlanState(event: CheckpointEvent): CheckpointWorkPlanState {
  return {
    lastKind: event.kind,
    reason: event.reason,
    nextDirection: event.nextDirection,
    completed: event.completed.slice(),
    pending: event.pending.slice(),
    updatedAt: event.timestamp,
  };
}

/**
 * Check if assistant messages contain any visible (non-empty) output_text.
 */
export function hasVisibleAssistantText(assistantMessages: MessageField[]): boolean {
  return assistantMessages.some(
    (msg) =>
      msg.content
        .filter((c): c is OutputTextContent => c.type === "output_text")
        .map((c) => c.text)
        .join(" ")
        .trim().length > 0,
  );
}

export function isInvisibleAssistantMessage(message: MessageField): boolean {
  return !hasVisibleAssistantText([message]);
}

export function wantsFullVerification(
  text: string,
  additionalPhrases: readonly string[] = [],
): boolean {
  const normalized = text.toLowerCase();
  return [...DEFAULT_FULL_VERIFICATION_PHRASES, ...additionalPhrases].some((phrase) =>
    normalized.includes(phrase.toLowerCase())
  );
}

export function autoVerifierTimeoutSeconds(maxTimeoutSeconds: number): number {
  if (!Number.isFinite(maxTimeoutSeconds) || maxTimeoutSeconds <= 0) return 120;
  return Math.min(120, Math.floor(maxTimeoutSeconds));
}

export function canExecuteReadOnlyBatchInParallel(
  toolCalls: FunctionCallField[],
  semanticsFor: (toolName: string) => ToolSemantics = (toolName) => resolveToolSemantics(toolName),
): boolean {
  return toolCalls.length > 1 && toolCalls.every((toolCall) => semanticsFor(toolCall.name).parallelSafe);
}

export function finishRequestToMessage(
  toolCall: FunctionCallField,
  summary: string,
  status: "completed" | "blocked" | "completed_with_unverified_changes",
  evidenceText?: string,
): MessageField {
  const baseText =
    status === "completed_with_unverified_changes"
      ? `Completed with unverified changes:\n${summary}`
      : summary;
  const text = evidenceText ? `${baseText}\n${evidenceText}` : baseText;
  return {
    type: "message",
    id: `finish_${toolCall.call_id}`,
    status: "completed",
    role: "assistant",
    phase: "final_answer",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

export function createTurnError(
  type: AgentTurnError["type"],
  message: string,
  iteration?: number,
): AgentTurnError {
  return {
    id: `${type}_${crypto.randomUUID().slice(0, 8)}`,
    type,
    status: "active",
    message,
    iteration,
  };
}

/**
 * Decide whether a text-only response is structurally intermediate.
 */
export function getAutonomousFollowUpReason(
  assistantMessages: MessageField[],
  needsVerification: boolean,
  activeErrors: AgentTurnError[],
  hasMutatedFiles: boolean,
  hasUsedTools: boolean,
  taskKind: TaskKind = "unknown",
  workMode: WorkMode = "agent",
): string | null {
  if (assistantMessages.length === 0) {
    return null;
  }

  if (!hasVisibleAssistantText(assistantMessages)) {
    return "You produced no visible text (only thinking). Write your response in plain text now - do not output only reasoning.";
  }

  if (!hasUsedTools) {
    return null;
  }

  if (needsVerification) {
    return "You changed project files but stopped before verifying the result. Run the project-appropriate verification workflow now; do not call finish until verification evidence exists unless verification is impossible for a concrete external reason.";
  }

  if (activeErrors.length > 0) {
    const errorList = activeErrors
      .map(
        (error) =>
          `${error.id} (${error.toolName ?? error.type}: ${error.message.slice(0, 120)})`,
      )
      .join("\n    ");
    return `Active tool errors must be resolved before finishing. Fix their cause with tools, or use status blocked only if a concrete external blocker makes recovery impossible:\n    ${errorList}`;
  }

  // Plan/goal are inspect+design modes. After tools without mutations, a visible
  // plan/goal brief is a valid terminal response — do not auto-continue just to
  // force finish. Mutation-driven verification and active errors still apply above.
  if (isRestrictedWorkMode(workMode) && !hasMutatedFiles) {
    return null;
  }

  if (taskKind === "read_only_question" && !hasMutatedFiles) {
    return null;
  }

  if (hasFinishIntentReasoning(assistantMessages)) {
    return null;
  }

  if (isTextOnlyFinalResponseCandidate(assistantMessages)) {
    return null;
  }

  return "Tool-assisted turns must end through finish. If the task is done and verified, call finish now with status completed, final summary, and concrete criteria. Do not write commentary. If not done, continue with tools.";
}

function isTextOnlyFinalResponseCandidate(assistantMessages: MessageField[]): boolean {
  if (assistantMessages.some((message) => message.phase === "final_answer")) return true;

  const text = assistantMessages
    .flatMap((message) =>
      message.content
        .filter((content): content is OutputTextContent => content.type === "output_text")
        .map((content) => content.text),
    )
    .join("\n")
    .trim();
  if (text.length === 0) return false;
  if (looksLikeContinuation(text)) return false;

  return looksLikeFinalText(text);
}

function looksLikeContinuation(text: string): boolean {
  const normalized = text.toLowerCase();
  if (/[：:]\s*$/.test(normalized)) return true;
  return assistantTextMarkers("continuation").some((marker) =>
    containsAssistantTextMarker(normalized, marker)
  );
}

function looksLikeFinalText(text: string): boolean {
  const normalized = text.toLowerCase();
  return assistantTextMarkers("final").some((marker) =>
    containsAssistantTextMarker(normalized, marker)
  );
}

/**
 * Convert agent output items to session ItemParam items.
 */
export function outputItemToSessionItem(
  item: MessageField | FunctionCallField,
): ItemParam | null {
  switch (item.type) {
    case "message": {
      const msg: AssistantMessageItemParam = {
        type: "message",
        role: item.role as "assistant",
        content: item.content,
        id: item.id,
        status: item.status,
      };
      if (item.phase) msg.phase = item.phase;
      if (item.reasoning_content)
        msg.reasoning_content = item.reasoning_content;
      return msg;
    }

    case "function_call": {
      const fc: FunctionCallItemParam = {
        type: "function_call",
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments,
        id: item.id,
        status: "completed",
      };
      if (item.reasoning_content) fc.reasoning_content = item.reasoning_content;
      return fc;
    }

    default:
      return null;
  }
}

export function autoVerifierCallToSessionItem(call: AutoVerifierToolCall): FunctionCallItemParam {
  return {
    type: "function_call",
    call_id: call.callId,
    name: call.toolName,
    arguments: call.arguments,
    id: `fc_${call.callId}`,
    status: "completed",
  };
}

/**
 * Build CreateResponseParams from session and system prompt.
 */
export function buildRequest(
  session: SessionPort,
  systemPrompt: string,
  tools: ToolRegistry,
  model: string,
  maxOutputTokens: number,
  maxCompletionTokens: number,
  temperature: number,
  ephemeralMessages: Array<{ role: "developer"; content: string }> = [],
  allowParallelToolCalls = true,
  allowedToolNames?: ReadonlySet<string>,
): CreateResponseParams {
  const input = session.buildInput();
  const items = input.items as ItemParam[];

  if (ephemeralMessages.length > 0) {
    const ephemeralItems = ephemeralMessages.map(
      (msg) => ({
        type: "message" as const,
        role: "developer" as const,
        content: [{ type: "input_text" as const, text: msg.content }],
      }),
    );
    items.unshift(...ephemeralItems);
  }

  return {
    model,
    input: items,
    instructions: systemPrompt,
    tools: [
      ...tools
        .getOpenResponsesTools()
        .filter(
          (tool) =>
            tool.type !== "function" ||
            (tool.name !== FINISH_TOOL_NAME &&
              (allowedToolNames === undefined || allowedToolNames.has(tool.name))),
        ),
      FINISH_TOOL,
    ],
    previous_response_id: input.previousResponseId ?? undefined,
    parallel_tool_calls: allowParallelToolCalls,
    store: false,
    max_output_tokens: maxOutputTokens,
    max_completion_tokens: maxCompletionTokens > 0 ? maxCompletionTokens : null,
    temperature,
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function hasFinishIntentReasoning(assistantMessages: MessageField[]): boolean {
  const reasoningText = assistantMessages
    .map((message) => message.reasoning_content ?? "")
    .join("\n")
    .toLowerCase();
  if (!reasoningText.trim()) return false;

  const compactReasoningText = reasoningText.replace(/[\s_-]+/g, "");
  return (
    /\b(?:call|calling|invoke|use)\s+(?:the\s+)?finish\b/.test(reasoningText) ||
    reasoningText.includes("finish tool") ||
    compactReasoningText.includes("callfinish")
  );
}
