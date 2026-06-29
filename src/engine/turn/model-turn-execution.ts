import type { OpenResponsesClient } from "../../kernel/model/model-gateway";
import type {
  FunctionCallField,
  MessageField,
  ResponseResource,
  Usage,
} from "../../kernel/model/openresponses-types";
import type { SessionPort } from "../../kernel/session/session-port";
import type { ToolRegistry } from "../../kernel/tools/tool-registry";
import type { ContextController } from "../context/context-controller";
import { ModelTurnRunner } from "../model-turn/model-turn-runner";
import { buildRequest, createTurnError } from "./turn-helpers";
import type { AgentEvent, AgentTurnError, TurnStopReasonEvent } from "./types";

export type ModelTurnExecutionResult =
  | {
      action: "response";
      response: ResponseResource;
      toolCalls: FunctionCallField[];
      assistantMessages: MessageField[];
      systemPromptTokens: number;
      toolSchemaTokens: number;
    }
  | {
      action: "retry" | "break";
      systemPromptTokens: number;
      toolSchemaTokens: number;
    };

export async function executeModelTurn(input: {
  client: OpenResponsesClient;
  session: SessionPort;
  tools: ToolRegistry;
  contextController: ContextController;
  systemPrompt: string;
  model: string;
  maxOutputTokens: number;
  maxCompletionTokens: number;
  temperature: number;
  stream: boolean;
  ephemeralMessages: Array<{ role: "developer"; content: string }>;
  allowParallelToolCalls: boolean;
  turn: number;
  iteration: number;
  totalUsage: Usage;
  tokenBudget: number;
  contextWindow: number;
  errors: AgentTurnError[];
  emit: (event: AgentEvent) => void;
  emitStopReason: (
    reason: TurnStopReasonEvent["reason"],
    detail: string,
  ) => void;
  narrateBlocked: (message: string) => void;
}): Promise<ModelTurnExecutionResult> {
  input.emit({ type: "thinking", timestamp: Date.now(), active: true });

  const request = buildRequest(
    input.session,
    input.systemPrompt,
    input.tools,
    input.model,
    input.maxOutputTokens,
    input.maxCompletionTokens,
    input.temperature,
    input.ephemeralMessages,
    input.allowParallelToolCalls,
  );

  const systemPromptTokens = Math.ceil(input.systemPrompt.length / 4);
  const toolSchemaTokens = Math.ceil(JSON.stringify(request.tools).length / 4);

  const checkResult = await input.contextController.performPreInferenceCheck({
    systemPromptTokens,
    toolSchemaTokens,
    requestFingerprint: `turn_${input.turn}`,
  });
  emitContextUsageUpdate({
    contextController: input.contextController,
    totalUsage: input.totalUsage,
    tokenBudget: input.tokenBudget,
    contextWindow: input.contextWindow,
    systemPromptTokens,
    toolSchemaTokens,
    requestFingerprint: `turn_${input.turn}`,
    emit: input.emit,
  });

  if (!checkResult.canProceed) {
    input.emit({ type: "thinking", timestamp: Date.now(), active: false });
    const errorMsg = checkResult.error || "Cannot proceed: context exceeds hard limit even after compaction";
    input.narrateBlocked(errorMsg);
    input.errors.push(createTurnError("api_error", errorMsg, input.iteration));
    input.emit({
      type: "turn_error",
      timestamp: Date.now(),
      error: errorMsg,
    });
    input.emitStopReason("api-error", errorMsg);
    return { action: "break", systemPromptTokens, toolSchemaTokens };
  }

  try {
    const modelTurn = await new ModelTurnRunner(input.client, {
      stream: input.stream,
      emit: input.emit,
    }).run(request);
    input.emit({ type: "thinking", timestamp: Date.now(), active: false });
    return {
      action: "response",
      response: modelTurn.response,
      toolCalls: modelTurn.toolCalls,
      assistantMessages: modelTurn.assistantMessages,
      systemPromptTokens,
      toolSchemaTokens,
    };
  } catch (error) {
    input.emit({ type: "thinking", timestamp: Date.now(), active: false });

    const errorType = typeof input.client.classifyError === "function"
      ? input.client.classifyError(error)
      : "unknown";
    if (errorType === "context_overflow") {
      const recoveryResult = await input.contextController.recoverContextOverflow({
        systemPromptTokens,
        toolSchemaTokens,
        requestFingerprint: `turn_${input.turn}_overflow`,
      });
      if (recoveryResult.recovered && recoveryResult.shouldRetry) {
        input.emit({ type: "thinking", timestamp: Date.now(), active: true });
        return { action: "retry", systemPromptTokens, toolSchemaTokens };
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    input.errors.push(createTurnError("api_error", message, input.iteration));
    input.narrateBlocked(message);
    input.emit({
      type: "turn_error",
      timestamp: Date.now(),
      error: message,
    });
    input.emitStopReason("api-error", message);
    return { action: "break", systemPromptTokens, toolSchemaTokens };
  }
}

function emitContextUsageUpdate(input: {
  contextController: ContextController;
  totalUsage: Usage;
  tokenBudget: number;
  contextWindow: number;
  systemPromptTokens: number;
  toolSchemaTokens: number;
  requestFingerprint: string;
  emit: (event: AgentEvent) => void;
}): void {
  const effectiveContextTokens = input.contextController.getEffectiveContextTokens({
    systemPromptTokens: input.systemPromptTokens,
    toolSchemaTokens: input.toolSchemaTokens,
    requestFingerprint: input.requestFingerprint,
  });
  const used = effectiveContextTokens ?? input.totalUsage.total_tokens;
  const percentage = input.contextWindow > 0 ? Math.round((used / input.contextWindow) * 100) : 0;
  input.emit({
    type: "budget_update",
    timestamp: Date.now(),
    usedTokens: input.totalUsage.total_tokens,
    totalBudget: input.tokenBudget,
    contextWindow: input.contextWindow,
    percentage,
    effectiveContextTokens,
  });
}
