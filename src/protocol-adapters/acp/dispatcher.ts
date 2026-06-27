import type { z } from "zod";
import type { RuntimeContentBlock, RuntimeEvent, RuntimeSessionInfo, SobaRuntime, TurnResult } from "../../application/types";
import { ACP_LIFECYCLE_FEATURES, ACP_PROTOCOL_VERSION, type AcpFeatureSet, buildAgentCapabilities } from "./capabilities";
import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_METHOD_NOT_FOUND,
  JsonRpcError,
  type JsonRpcRequest,
  type JsonValue,
} from "./json-rpc";
import { AcpRequestRegistry } from "./request-registry";
import {
  initializeParamsSchema,
  sessionCancelParamsSchema,
  sessionIdParamsSchema,
  sessionListParamsSchema,
  sessionNewParamsSchema,
  sessionPromptParamsSchema,
  setSessionConfigParamsSchema,
  setSessionModeParamsSchema,
} from "./schemas";

export interface AcpDispatcherOptions {
  runtime: SobaRuntime;
  cwd: string;
  agentInfo?: {
    name: string;
    version: string;
  };
  features?: AcpFeatureSet;
  notify?: (method: string, params: JsonValue) => void | Promise<void>;
}

export interface AcpDispatchContext {
  signal: AbortSignal;
}

export class AcpDispatcher {
  private readonly runtime: SobaRuntime;
  private readonly cwd: string;
  private readonly agentInfo: { name: string; version: string };
  private readonly features: AcpFeatureSet;
  private readonly notify?: (method: string, params: JsonValue) => void | Promise<void>;
  private readonly requestRegistry = new AcpRequestRegistry();

  constructor(options: AcpDispatcherOptions) {
    this.runtime = options.runtime;
    this.cwd = options.cwd;
    this.agentInfo = options.agentInfo ?? { name: "soba-agent", version: "0.0.0" };
    this.features = options.features ?? ACP_LIFECYCLE_FEATURES;
    this.notify = options.notify;
  }

  async dispatch(request: JsonRpcRequest): Promise<JsonValue | undefined> {
    const sessionId = extractSessionId(request.params);
    const signal = request.id === undefined
      ? new AbortController().signal
      : this.requestRegistry.begin(request.id, request.method, sessionId);

    try {
      return await this.dispatchWithContext(request, { signal });
    } finally {
      if (request.id !== undefined) this.requestRegistry.end(request.id);
    }
  }

  pendingRequests(): Array<{ id: string | number | null; method: string; sessionId?: string }> {
    return this.requestRegistry.listPending();
  }

  private async dispatchWithContext(request: JsonRpcRequest, context: AcpDispatchContext): Promise<JsonValue | undefined> {
    switch (request.method) {
      case "authenticate":
      case "logout":
        return {};
      case "initialize":
        return this.handleInitialize(request.params);
      case "session/list":
        return this.handleSessionList(request.params);
      case "session/new":
        return this.handleSessionNew(request.params, context);
      case "session/load":
        return this.handleSessionLoad(request.params);
      case "session/resume":
        return this.handleSessionResume(request.params);
      case "session/prompt":
        return this.handleSessionPrompt(request.params);
      case "session/cancel":
        return this.handleSessionCancel(request.params);
      case "session/close":
        return this.handleSessionClose(request.params);
      case "session/delete":
        return this.handleSessionDelete(request.params);
      case "session/set_config_option":
        return this.handleSetSessionConfig(request.params);
      case "session/set_mode":
        return this.handleSetSessionMode(request.params);
      default:
        throw new JsonRpcError(JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${request.method}`);
    }
  }

  private handleInitialize(params: JsonValue | undefined): JsonValue {
    const result = initializeParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }

    return {
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentInfo: this.agentInfo,
      agentCapabilities: buildAgentCapabilities(this.features),
    };
  }

  private async handleSessionList(params: JsonValue | undefined): Promise<JsonValue> {
    const result = sessionListParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const sessions = await this.runtime.listSessions({ cwd: result.data.cwd ?? this.cwd });
    return {
      sessions: sessions.map(sessionToAcp),
    };
  }

  private async handleSessionNew(params: JsonValue | undefined, context: AcpDispatchContext): Promise<JsonValue> {
    if (!this.features.sessionNew) {
      throw new JsonRpcError(JSON_RPC_METHOD_NOT_FOUND, "Method not found: session/new");
    }
    if (context.signal.aborted) {
      throw new JsonRpcError(JSON_RPC_INTERNAL_ERROR, "Request was cancelled");
    }

    const result = sessionNewParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }

    const session = await this.runtime.createSession({ cwd: result.data.cwd });
    return {
      sessionId: session.id,
    };
  }

  private async handleSessionLoad(params: JsonValue | undefined): Promise<JsonValue> {
    const result = sessionIdParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const snapshot = await this.runtime.loadSession({ sessionId: result.data.sessionId });
    await this.replaySessionEntries(snapshot.info.id, snapshot.entries);
    return { sessionId: snapshot.info.id };
  }

  private async handleSessionResume(params: JsonValue | undefined): Promise<JsonValue> {
    const result = sessionIdParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const session = await this.runtime.resumeSession({ sessionId: result.data.sessionId });
    return { sessionId: session.id };
  }

  private async handleSessionPrompt(params: JsonValue | undefined): Promise<JsonValue> {
    const result = sessionPromptParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }

    const { sessionId } = result.data;
    const unsubscribe = this.runtime.onEvent((event) => {
      void this.handleRuntimeEvent(sessionId, event);
    });
    try {
      const turn = await this.runtime.runTurn({
        sessionId,
        source: "acp",
        content: result.data.prompt.map(acpContentToRuntime),
      });
      return {
        stopReason: turnToStopReason(turn),
      };
    } finally {
      unsubscribe();
    }
  }

  private handleSessionCancel(params: JsonValue | undefined): JsonValue {
    const result = sessionCancelParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }

    const { sessionId } = result.data;
    const cancelledRequests = this.requestRegistry.cancelBySession(sessionId);
    this.runtime.cancelTurn(sessionId);

    return {
      cancelled: true,
      cancelledRequests,
    };
  }

  private async handleSessionClose(params: JsonValue | undefined): Promise<JsonValue> {
    const result = sessionIdParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    await this.runtime.closeSession(result.data.sessionId);
    return {};
  }

  private async handleSessionDelete(params: JsonValue | undefined): Promise<JsonValue> {
    const result = sessionIdParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    this.runtime.cancelTurn(result.data.sessionId);
    await this.runtime.deleteSession(result.data.sessionId);
    return {};
  }

  private async handleSetSessionConfig(params: JsonValue | undefined): Promise<JsonValue> {
    const result = setSessionConfigParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const session = await this.runtime.setSessionConfig({
      sessionId: result.data.sessionId,
      key: result.data.key,
      value: result.data.value,
    });
    return { session: sessionToAcp(session) };
  }

  private async handleSetSessionMode(params: JsonValue | undefined): Promise<JsonValue> {
    const result = setSessionModeParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const session = await this.runtime.setSessionMode({
      sessionId: result.data.sessionId,
      mode: result.data.mode,
      enabled: result.data.enabled,
    });
    return { session: sessionToAcp(session) };
  }

  private async replaySessionEntries(sessionId: string, entries: unknown[]): Promise<void> {
    for (const entry of entries) {
      const update = sessionEntryToUpdate(entry);
      if (update) await this.emitSessionUpdate(sessionId, update);
    }
  }

  private async handleRuntimeEvent(sessionId: string, event: RuntimeEvent): Promise<void> {
    const update = runtimeEventToUpdate(event);
    if (update) await this.emitSessionUpdate(sessionId, update);
  }

  private async emitSessionUpdate(sessionId: string, update: JsonValue): Promise<void> {
    await this.notify?.("session/update", {
      sessionId,
      update,
    });
  }
}

function extractSessionId(params: JsonValue | undefined): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const value = params.sessionId;
  return typeof value === "string" ? value : undefined;
}

function invalidParams(issues: Array<{ path: PropertyKey[]; message: string }>): JsonRpcError {
  return new JsonRpcError(JSON_RPC_INVALID_PARAMS, "Invalid params", {
    issues: issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

function sessionToAcp(session: RuntimeSessionInfo): JsonValue {
  return {
    sessionId: session.id,
    cwd: session.cwd,
    title: session.title ?? null,
    updatedAt: session.updatedAt ?? null,
  };
}

function acpContentToRuntime(content: z.infer<typeof sessionPromptParamsSchema>["prompt"][number]): RuntimeContentBlock {
  if (content.type === "text") {
    return { type: "text", text: content.text };
  }
  if (content.type === "resource") {
    return {
      type: "resource",
      uri: content.resource.uri,
      text: content.resource.text,
      mimeType: content.resource.mimeType,
    };
  }
  if (content.type === "resource_link") {
    return {
      type: "resource_link",
      uri: content.uri,
      name: content.name,
      mimeType: content.mimeType,
    };
  }
  return {
    type: "image",
    mimeType: content.mimeType,
    data: content.data,
  };
}

function runtimeEventToUpdate(event: RuntimeEvent): JsonValue | undefined {
  switch (event.type) {
    case "assistant_text_delta":
      return {
        type: "agent_message_chunk",
        messageId: event.messageId,
        content: { type: "text", text: event.delta },
      };
    case "assistant_message":
      return {
        type: "agent_message",
        messageId: event.messageId,
        content: [{ type: "text", text: event.text }],
      };
    case "tool_call_start":
      return {
        type: "tool_call",
        toolCallId: event.toolCallId,
        title: event.toolName,
        rawInput: event.args as unknown as JsonValue,
      };
    case "tool_call_result":
      return {
        type: "tool_call_update",
        toolCallId: event.toolCallId,
        status: event.result.isError ? "failed" : "completed",
        rawOutput: event.result as unknown as JsonValue,
      };
    case "tool_call_end":
      return {
        type: "tool_call_update",
        toolCallId: event.toolCallId,
        status: "completed",
        durationMs: event.durationMs,
      };
    case "budget_update":
      return {
        type: "usage_update",
        usedTokens: event.effectiveContextTokens ?? event.usedTokens,
        totalBudget: event.totalBudget,
        percentage: event.percentage,
      };
    case "working_narration":
      return {
        type: "agent_message_chunk",
        content: { type: "text", text: event.message },
        narration: {
          eventType: event.eventType,
          evidenceIds: event.evidenceIds,
        },
      };
    default:
      return undefined;
  }
}

function sessionEntryToUpdate(entry: unknown): JsonValue | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const typedEntry = entry as { type?: unknown; item?: unknown };
  if (typedEntry.type !== "item" || !typedEntry.item || typeof typedEntry.item !== "object") return undefined;
  const item = typedEntry.item as { type?: unknown; role?: unknown; content?: unknown; call_id?: unknown; name?: unknown; output?: unknown };
  if (item.type === "message" && item.role === "assistant") {
    const text = messageText(item.content);
    if (!text) return undefined;
    return {
      type: "agent_message",
      content: [{ type: "text", text }],
    };
  }
  if (item.type === "function_call" && typeof item.call_id === "string") {
    return {
      type: "tool_call",
      toolCallId: item.call_id,
      title: typeof item.name === "string" ? item.name : "tool",
      rawInput: item as unknown as JsonValue,
    };
  }
  if (item.type === "function_call_output" && typeof item.call_id === "string") {
    return {
      type: "tool_call_update",
      toolCallId: item.call_id,
      status: "completed",
      rawOutput: item as unknown as JsonValue,
    };
  }
  return undefined;
}

function messageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const block = item as { type?: unknown; text?: unknown };
      return (block.type === "output_text" || block.type === "input_text") && typeof block.text === "string"
        ? block.text
        : "";
    })
    .join("");
}

function turnToStopReason(turn: TurnResult): string {
  if (turn.activeErrors.length > 0) return "error";
  if (turn.errors.some((error) => error.type === "cancelled")) return "cancelled";
  return "end_turn";
}
