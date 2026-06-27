import type { z } from "zod";
import type {
  RuntimeContentBlock,
  RuntimeEvent,
  RuntimeSessionConfigOption,
  RuntimeSessionInfo,
  SobaRuntime,
  TurnResult,
} from "../../application/types";
import { ACP_LIFECYCLE_FEATURES, ACP_PROTOCOL_VERSION, type AcpFeatureSet, buildAgentCapabilities } from "./capabilities";
import { type AcpClientCapabilities, EMPTY_ACP_CLIENT_CAPABILITIES, parseAcpClientCapabilities } from "./client-capabilities";
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

const ACP_PERMISSION_OPTIONS: JsonValue[] = [
  { id: "deny", label: "Deny", kind: "reject_once" },
  { id: "once", label: "Allow once", kind: "allow_once" },
  { id: "session", label: "Allow for session", kind: "allow_always" },
  { id: "repo", label: "Allow for repository", kind: "allow_repo" },
  { id: "full", label: "Allow full access", kind: "allow_full" },
];

export interface AcpDispatcherOptions {
  runtime: SobaRuntime;
  cwd: string;
  agentInfo?: {
    name: string;
    version: string;
  };
  features?: AcpFeatureSet;
  notify?: (method: string, params: JsonValue) => void | Promise<void>;
  requestClient?: (method: string, params: JsonValue) => JsonValue | Promise<JsonValue>;
  onClientCapabilities?: (capabilities: AcpClientCapabilities, raw: JsonValue | undefined) => void | Promise<void>;
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
  private readonly requestClient?: (method: string, params: JsonValue) => JsonValue | Promise<JsonValue>;
  private readonly onClientCapabilities?: (capabilities: AcpClientCapabilities, raw: JsonValue | undefined) => void | Promise<void>;
  private clientCapabilities: AcpClientCapabilities = EMPTY_ACP_CLIENT_CAPABILITIES;
  private readonly requestRegistry = new AcpRequestRegistry();
  private readonly sessionAliases = new Map<string, string>();

  constructor(options: AcpDispatcherOptions) {
    this.runtime = options.runtime;
    this.cwd = options.cwd;
    this.agentInfo = options.agentInfo ?? { name: "soba-agent", version: "0.0.0" };
    this.features = options.features ?? ACP_LIFECYCLE_FEATURES;
    this.notify = options.notify;
    this.requestClient = options.requestClient;
    this.onClientCapabilities = options.onClientCapabilities;
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

  private async handleInitialize(params: JsonValue | undefined): Promise<JsonValue> {
    const result = initializeParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const rawCapabilities = result.data.clientCapabilities as JsonValue | undefined;
    this.clientCapabilities = parseAcpClientCapabilities(rawCapabilities);
    await this.onClientCapabilities?.(this.clientCapabilities, rawCapabilities);

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
    const configOptions = await this.sessionConfigOptions(session.id);
    return {
      sessionId: session.id,
      ...(configOptions.length > 0 ? { configOptions } : {}),
    };
  }

  private async handleSessionLoad(params: JsonValue | undefined): Promise<JsonValue> {
    if (!this.features.loadSession) {
      throw new JsonRpcError(JSON_RPC_METHOD_NOT_FOUND, "Method not found: session/load");
    }
    const result = sessionIdParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const clientSessionId = result.data.sessionId;
    const cwd = cwdFromParams(params) ?? this.cwd;
    let runtimeSessionId = this.resolveRuntimeSessionId(clientSessionId);
    let configOptions: JsonValue[];
    try {
      const snapshot = await this.runtime.loadSession({ sessionId: runtimeSessionId });
      runtimeSessionId = snapshot.info.id;
      this.rememberSessionAlias(clientSessionId, runtimeSessionId);
      await this.replaySessionEntries(clientSessionId, runtimeSessionId, snapshot.entries);
      configOptions = await this.sessionConfigOptions(runtimeSessionId);
    } catch (error) {
      if (!isSessionNotFound(error)) throw error;
      const session = await this.runtime.createSession({ cwd });
      runtimeSessionId = session.id;
      this.rememberSessionAlias(clientSessionId, runtimeSessionId);
      configOptions = await this.emitSessionConfigOptions(clientSessionId, runtimeSessionId);
    }
    return configOptions.length > 0 ? { configOptions } : {};
  }

  private async handleSessionResume(params: JsonValue | undefined): Promise<JsonValue> {
    if (!this.features.loadSession) {
      throw new JsonRpcError(JSON_RPC_METHOD_NOT_FOUND, "Method not found: session/resume");
    }
    const result = sessionIdParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const clientSessionId = result.data.sessionId;
    const cwd = cwdFromParams(params) ?? this.cwd;
    let runtimeSessionId = this.resolveRuntimeSessionId(clientSessionId);
    let configOptions: JsonValue[];
    try {
      const session = await this.runtime.resumeSession({ sessionId: runtimeSessionId });
      runtimeSessionId = session.id;
      this.rememberSessionAlias(clientSessionId, runtimeSessionId);
      configOptions = await this.emitSessionConfigOptions(clientSessionId, runtimeSessionId);
    } catch (error) {
      if (!isSessionNotFound(error)) throw error;
      const session = await this.runtime.createSession({ cwd });
      runtimeSessionId = session.id;
      this.rememberSessionAlias(clientSessionId, runtimeSessionId);
      configOptions = await this.emitSessionConfigOptions(clientSessionId, runtimeSessionId);
    }
    return configOptions.length > 0 ? { configOptions } : {};
  }

  private async handleSessionPrompt(params: JsonValue | undefined): Promise<JsonValue> {
    const result = sessionPromptParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }

    const { sessionId } = result.data;
    const runtimeSessionId = this.resolveRuntimeSessionId(sessionId);
    const unsubscribe = this.runtime.onEvent((event) => {
      void this.handleRuntimeEvent(sessionId, event);
    });
    try {
      const turn = await this.runtime.runTurn({
        sessionId: runtimeSessionId,
        source: "acp",
        content: result.data.prompt.map(acpContentToRuntime),
        command: result.data.command
          ? {
            name: result.data.command.name,
            args: result.data.command.args ?? [],
          }
          : undefined,
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
    this.runtime.cancelTurn(this.resolveRuntimeSessionId(sessionId));

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
    const runtimeSessionId = this.resolveRuntimeSessionId(result.data.sessionId);
    await this.runtime.closeSession(runtimeSessionId);
    this.sessionAliases.delete(result.data.sessionId);
    return {};
  }

  private async handleSessionDelete(params: JsonValue | undefined): Promise<JsonValue> {
    const result = sessionIdParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const runtimeSessionId = this.resolveRuntimeSessionId(result.data.sessionId);
    this.runtime.cancelTurn(runtimeSessionId);
    await this.runtime.deleteSession(runtimeSessionId);
    this.sessionAliases.delete(result.data.sessionId);
    return {};
  }

  private async handleSetSessionConfig(params: JsonValue | undefined): Promise<JsonValue> {
    const result = setSessionConfigParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const clientSessionId = result.data.sessionId;
    const runtimeSessionId = this.resolveRuntimeSessionId(clientSessionId);
    const session = await this.runtime.setSessionConfig({
      sessionId: runtimeSessionId,
      key: result.data.configId ?? result.data.key ?? "",
      value: result.data.value,
    });
    this.rememberSessionAlias(clientSessionId, session.id);
    const configOptions = await this.sessionConfigOptions(session.id);
    return { configOptions };
  }

  private async handleSetSessionMode(params: JsonValue | undefined): Promise<JsonValue> {
    const result = setSessionModeParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const clientSessionId = result.data.sessionId;
    const runtimeSessionId = this.resolveRuntimeSessionId(clientSessionId);
    const session = await this.runtime.setSessionMode({
      sessionId: runtimeSessionId,
      mode: result.data.mode,
      enabled: result.data.enabled,
    });
    this.rememberSessionAlias(clientSessionId, session.id);
    return { session: sessionToAcp({ ...session, id: clientSessionId }) };
  }

  private async replaySessionEntries(clientSessionId: string, runtimeSessionId: string, entries: unknown[]): Promise<void> {
    for (const entry of entries) {
      const update = sessionEntryToUpdate(entry);
      if (update) await this.emitSessionUpdate(clientSessionId, update);
    }
    await this.emitSessionConfigOptions(clientSessionId, runtimeSessionId);
  }

  private async emitSessionConfigOptions(clientSessionId: string, runtimeSessionId: string): Promise<JsonValue[]> {
    const options = await this.sessionConfigOptions(runtimeSessionId);
    if (options.length === 0) return options;
    await this.emitSessionUpdate(clientSessionId, {
      sessionUpdate: "config_option_update",
      configOptions: options,
    });
    return options;
  }

  private async sessionConfigOptions(runtimeSessionId: string): Promise<JsonValue[]> {
    const options = await this.runtime.listSessionConfigOptions?.(runtimeSessionId);
    return (options ?? []).map(configOptionToAcp);
  }

  private async handleRuntimeEvent(sessionId: string, event: RuntimeEvent): Promise<void> {
    if (event.type === "dangerous_confirmation") {
      await this.handlePermissionRequest(sessionId, event);
      return;
    }

    const update = runtimeEventToUpdate(event);
    if (update) await this.emitSessionUpdate(sessionId, update);
  }

  private async handlePermissionRequest(sessionId: string, event: Extract<RuntimeEvent, { type: "dangerous_confirmation" }>): Promise<void> {
    if (!this.requestClient || !this.clientCapabilities.requestPermission) {
      event.resolve("deny");
      return;
    }

    try {
      const response = await this.requestClient("session/request_permission", {
        sessionId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        title: event.toolName,
        description: event.description,
        reason: event.reason,
        level: event.level,
        options: ACP_PERMISSION_OPTIONS,
      });
      event.resolve(permissionDecisionFromAcp(response));
    } catch {
      event.resolve("deny");
    }
  }

  private async emitSessionUpdate(sessionId: string, update: JsonValue): Promise<void> {
    await this.notify?.("session/update", {
      sessionId,
      update,
    });
  }

  private resolveRuntimeSessionId(clientSessionId: string): string {
    return this.sessionAliases.get(clientSessionId) ?? clientSessionId;
  }

  private rememberSessionAlias(clientSessionId: string, runtimeSessionId: string): void {
    if (clientSessionId === runtimeSessionId) {
      this.sessionAliases.delete(clientSessionId);
      return;
    }
    this.sessionAliases.set(clientSessionId, runtimeSessionId);
  }
}

function extractSessionId(params: JsonValue | undefined): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const value = params.sessionId;
  return typeof value === "string" ? value : undefined;
}

function cwdFromParams(params: JsonValue | undefined): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const value = params.cwd;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isSessionNotFound(error: unknown): boolean {
  return error instanceof Error && /session not found/i.test(error.message);
}

function configOptionToAcp(option: RuntimeSessionConfigOption): JsonValue {
  return {
    id: option.id,
    name: option.name,
    description: option.description ?? null,
    category: option.category ?? "model",
    type: option.type,
    currentValue: option.currentValue,
    options: option.options.map((selectOption) => ({
      value: selectOption.value,
      name: selectOption.name,
      description: selectOption.description ?? null,
    })),
  };
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

function toolKind(toolName: string): string {
  if (toolName === "bash" || toolName === "local_shell") return "execute";
  if (["read", "inspect-file", "ls"].includes(toolName)) return "read";
  if (["edit", "write"].includes(toolName)) return "edit";
  if (["delete", "rm"].includes(toolName)) return "delete";
  if (["move", "mv"].includes(toolName)) return "move";
  if (["search", "search-files", "rg", "grep"].includes(toolName)) return "search";
  if (toolName.startsWith("mcp__")) return "fetch";
  return "other";
}

function toolResultContent(result: { content?: unknown; details?: Record<string, unknown> }): JsonValue[] {
  const content: JsonValue[] = [];
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (!isRecord(item)) continue;
      if (item.type === "text" && typeof item.text === "string") {
        content.push({ type: "text", text: item.text });
      }
    }
  }

  const image = isRecord(result.details?.image) ? result.details.image : undefined;
  if (image && typeof image.data === "string" && typeof image.mimeType === "string") {
    content.push({ type: "image", data: image.data, mimeType: image.mimeType });
  }

  return content;
}

function toolLocations(toolName: string, args?: Record<string, unknown>, result?: { details?: Record<string, unknown> }): JsonValue[] {
  const locations: JsonValue[] = [];

  addLocation(locations, args);
  addLocation(locations, result?.details);

  const matches = result?.details?.matches;
  if (Array.isArray(matches)) {
    for (const match of matches) addLocation(locations, match);
  }

  return dedupeLocations(locations.length > 0 ? locations : fallbackToolLocations(toolName, args));
}

function fallbackToolLocations(toolName: string, args?: Record<string, unknown>): JsonValue[] {
  if (!args) return [];
  if (!["read", "edit", "delete", "move", "search"].includes(toolKind(toolName))) return [];
  return typeof args.path === "string" ? [{ type: "file", path: args.path }] : [];
}

function addLocation(locations: JsonValue[], value: unknown): void {
  if (!isRecord(value)) return;

  const nested = value.location;
  if (isRecord(nested)) addLocation(locations, nested);

  const path = typeof value.path === "string" ? value.path : typeof value.file === "string" ? value.file : undefined;
  if (!path) return;

  const location: { [key: string]: JsonValue } = {
    type: "file",
    path,
  };
  if (typeof value.line === "number") location.line = value.line;
  if (typeof value.column === "number") location.column = value.column;
  locations.push(location);
}

function dedupeLocations(locations: JsonValue[]): JsonValue[] {
  const seen = new Set<string>();
  const deduped: JsonValue[] = [];
  for (const location of locations) {
    const key = JSON.stringify(location);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(location);
  }
  return deduped;
}

function permissionDecisionFromAcp(value: JsonValue): "deny" | "once" | "session" | "repo" | "full" {
  const decision = typeof value === "string" ? value : permissionField(value);
  switch (decision) {
    case "once":
    case "allow_once":
      return "once";
    case "session":
    case "allow_session":
    case "allow_always":
      return "session";
    case "repo":
    case "allow_repo":
      return "repo";
    case "full":
    case "allow_full":
      return "full";
    default:
      return "deny";
  }
}

function permissionField(value: JsonValue): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const key of ["decision", "optionId", "outcome", "id"]) {
    const field = value[key];
    if (typeof field === "string") return field;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function runtimeEventToUpdate(event: RuntimeEvent): JsonValue | undefined {
  switch (event.type) {
    case "assistant_text_delta":
      return {
        sessionUpdate: "agent_message_chunk",
        messageId: event.messageId,
        content: { type: "text", text: event.delta },
      };
    case "assistant_message":
      return {
        sessionUpdate: "agent_message_chunk",
        messageId: event.messageId,
        content: { type: "text", text: event.text },
      };
    case "tool_call_start":
      return {
        sessionUpdate: "tool_call",
        toolCallId: event.toolCallId,
        title: event.toolName,
        kind: toolKind(event.toolName),
        status: "pending",
        rawInput: event.args as unknown as JsonValue,
        locations: toolLocations(event.toolName, event.args),
      };
    case "tool_call_result":
      return {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        status: event.result.isError ? "failed" : "completed",
        content: toolResultContent(event.result),
        locations: toolLocations(event.toolName, undefined, event.result),
        rawOutput: event.result as unknown as JsonValue,
      };
    case "tool_call_end":
      return {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        status: "completed",
        durationMs: event.durationMs,
      };
    case "budget_update":
      return {
        sessionUpdate: "usage_update",
        used: event.effectiveContextTokens ?? event.usedTokens,
        size: event.contextWindow ?? event.totalBudget,
        _meta: {
          usedTokens: event.usedTokens,
          effectiveContextTokens: event.effectiveContextTokens ?? null,
          percentage: event.percentage,
        },
      };
    case "working_narration":
      return {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: event.message },
        _meta: {
          eventType: event.eventType,
          evidenceIds: event.evidenceIds,
        },
      };
    case "turn_error":
      return {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `SOBA runtime error: ${event.error}` },
        _meta: {
          status: event.status ?? null,
        },
      };
    case "context_error":
      return {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `SOBA context error: ${event.error}` },
        _meta: {
          effectiveTokens: event.effectiveTokens,
          hardLimit: event.hardLimit,
          recoveryAttempted: event.recoveryAttempted,
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
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    };
  }
  if (item.type === "function_call" && typeof item.call_id === "string") {
    return {
      sessionUpdate: "tool_call",
      toolCallId: item.call_id,
      title: typeof item.name === "string" ? item.name : "tool",
      kind: typeof item.name === "string" ? toolKind(item.name) : "other",
      status: "completed",
      rawInput: item as unknown as JsonValue,
    };
  }
  if (item.type === "function_call_output" && typeof item.call_id === "string") {
    return {
      sessionUpdate: "tool_call_update",
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
  if (turn.errors.some((error) => error.type === "cancelled")) return "cancelled";
  return "end_turn";
}
