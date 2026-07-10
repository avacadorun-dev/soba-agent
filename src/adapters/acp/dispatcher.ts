import { Buffer } from "node:buffer";
import { isAbsolute, resolve } from "node:path";
import type { z } from "zod";
import type {
  RuntimeCommandMetadata,
  RuntimeContentBlock,
  RuntimeEvent,
  RuntimeSessionConfigOption,
  RuntimeSessionInfo,
  SobaRuntime,
  TurnResult,
} from "../../application/acp/public";
import { type ParsedEvidenceHandoff, splitEvidenceHandoff } from "../../application/acp/public";
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
  cancelRequestParamsSchema,
  initializeParamsSchema,
  sessionCancelParamsSchema,
  sessionIdParamsSchema,
  sessionListParamsSchema,
  sessionLoadParamsSchema,
  sessionNewParamsSchema,
  sessionPromptParamsSchema,
  sessionResumeParamsSchema,
  setSessionConfigParamsSchema,
  setSessionModeParamsSchema,
} from "./schemas";

const ACP_PERMISSION_OPTIONS: JsonValue[] = [
  { optionId: "deny", name: "Deny", kind: "reject_once" },
  { optionId: "once", name: "Allow once", kind: "allow_once" },
  { optionId: "session", name: "Allow for session", kind: "allow_always" },
  { optionId: "repo", name: "Allow for repository", kind: "allow_always" },
  { optionId: "full", name: "Allow full access", kind: "allow_always" },
];

const ACP_SESSION_LIST_PAGE_SIZE = 50;

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

interface ActiveAcpToolCall {
  toolName: string;
  args: Record<string, unknown>;
  resultStatus?: "completed" | "failed";
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
  private readonly sessionCwds = new Map<string, string>();
  private readonly sessionAdditionalDirectories = new Map<string, string[]>();
  private readonly pendingPermissions = new Map<string, Set<(decision: "deny") => void>>();
  private readonly activeToolCalls = new Map<string, ActiveAcpToolCall>();
  /** Assistant text already streamed as ACP chunks for the in-flight prompt, keyed by client session id. */
  private readonly streamedAssistantTextBySession = new Map<string, string>();
  private postResponseEffects: Array<() => Promise<void>> = [];

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

  takePostResponseEffects(): Array<() => Promise<void>> {
    const effects = this.postResponseEffects;
    this.postResponseEffects = [];
    return effects;
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
        return this.handleSessionPrompt(request.params, context);
      case "session/cancel":
        return this.handleSessionCancel(request.params);
      case "$/cancel_request":
        return this.handleCancelRequest(request.params);
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
    const cursor = decodeSessionListCursor(result.data.cursor ?? null);
    const sessions = await this.runtime.listSessions({ cwd: result.data.cwd ?? this.cwd, cursor: result.data.cursor ?? null });
    const page = sessions.slice(cursor.offset, cursor.offset + ACP_SESSION_LIST_PAGE_SIZE);
    const nextOffset = cursor.offset + page.length;
    return {
      sessions: page.map(sessionToAcp),
      ...(nextOffset < sessions.length ? { nextCursor: encodeSessionListCursor(nextOffset) } : {}),
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

    const additionalDirectories = result.data.additionalDirectories ?? [];
    const session = await this.runtime.createSession({
      cwd: result.data.cwd,
      mcpServers: result.data.mcpServers,
      additionalDirectories,
    });
    this.rememberSessionState(session.id, session.cwd, additionalDirectories);
    const configOptions = await this.sessionConfigOptions(session.id);
    this.afterResponse(() => this.emitAvailableCommands(session.id));
    this.afterResponse(() => this.emitSessionInfoUpdate(session.id, session));
    return {
      sessionId: session.id,
      ...(configOptions.length > 0 ? { configOptions } : {}),
    };
  }

  private async handleSessionLoad(params: JsonValue | undefined): Promise<JsonValue> {
    if (!this.features.loadSession) {
      throw new JsonRpcError(JSON_RPC_METHOD_NOT_FOUND, "Method not found: session/load");
    }
    const result = sessionLoadParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const clientSessionId = result.data.sessionId;
    const cwd = result.data.cwd;
    let runtimeSessionId = this.resolveRuntimeSessionId(clientSessionId);
    const additionalDirectories = result.data.additionalDirectories ?? [];
    let snapshot: Awaited<ReturnType<SobaRuntime["loadSession"]>>;
    try {
      snapshot = await this.runtime.loadSession({
        sessionId: runtimeSessionId,
        cwd,
        mcpServers: result.data.mcpServers,
        additionalDirectories,
      });
    } catch (error) {
      if (isSessionNotFound(error)) {
        throw new JsonRpcError(JSON_RPC_INVALID_PARAMS, `Session not found: ${clientSessionId}`);
      }
      throw error;
    }
    runtimeSessionId = snapshot.info.id;
    this.rememberSessionAlias(clientSessionId, runtimeSessionId);
    this.rememberSessionState(clientSessionId, snapshot.info.cwd ?? cwd, additionalDirectories);
    this.rememberSessionState(runtimeSessionId, snapshot.info.cwd ?? cwd, additionalDirectories);
    await this.replaySessionEntries(clientSessionId, runtimeSessionId, snapshot.entries);
    const configOptions = await this.sessionConfigOptions(runtimeSessionId);
    this.afterResponse(() => this.emitSessionInfoUpdate(clientSessionId, snapshot.info));
    this.afterResponse(() => this.emitAvailableCommands(clientSessionId));
    return configOptions.length > 0 ? { configOptions } : {};
  }

  private async handleSessionResume(params: JsonValue | undefined): Promise<JsonValue> {
    if (!this.features.loadSession) {
      throw new JsonRpcError(JSON_RPC_METHOD_NOT_FOUND, "Method not found: session/resume");
    }
    const result = sessionResumeParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const clientSessionId = result.data.sessionId;
    const cwd = result.data.cwd;
    let runtimeSessionId = this.resolveRuntimeSessionId(clientSessionId);
    const additionalDirectories = result.data.additionalDirectories ?? [];
    let session: Awaited<ReturnType<SobaRuntime["resumeSession"]>>;
    try {
      session = await this.runtime.resumeSession({
        sessionId: runtimeSessionId,
        cwd,
        mcpServers: result.data.mcpServers,
        additionalDirectories,
      });
    } catch (error) {
      if (isSessionNotFound(error)) {
        throw new JsonRpcError(JSON_RPC_INVALID_PARAMS, `Session not found: ${clientSessionId}`);
      }
      throw error;
    }
    runtimeSessionId = session.id;
    this.rememberSessionAlias(clientSessionId, runtimeSessionId);
    this.rememberSessionState(clientSessionId, session.cwd ?? cwd, additionalDirectories);
    this.rememberSessionState(runtimeSessionId, session.cwd ?? cwd, additionalDirectories);
    const configOptions = await this.emitSessionConfigOptions(clientSessionId, runtimeSessionId);
    this.afterResponse(() => this.emitSessionInfoUpdate(clientSessionId, session));
    this.afterResponse(() => this.emitAvailableCommands(clientSessionId));
    return configOptions.length > 0 ? { configOptions } : {};
  }

  private async handleSessionPrompt(params: JsonValue | undefined, context: AcpDispatchContext): Promise<JsonValue> {
    const result = sessionPromptParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }

    const { sessionId } = result.data;
    const runtimeSessionId = this.resolveRuntimeSessionId(sessionId);
    this.streamedAssistantTextBySession.set(sessionId, "");
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
        stopReason: context.signal.aborted ? "cancelled" : turnToStopReason(turn),
      };
    } catch (error) {
      if (context.signal.aborted) {
        return { stopReason: "cancelled" };
      }
      throw error;
    } finally {
      unsubscribe();
      this.streamedAssistantTextBySession.delete(sessionId);
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
    this.cancelPendingPermissions(sessionId);

    return {
      cancelled: true,
      cancelledRequests,
    };
  }

  private handleCancelRequest(params: JsonValue | undefined): JsonValue {
    const result = cancelRequestParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }

    const request = this.requestRegistry.cancelById(result.data.requestId);
    if (request?.sessionId) {
      this.runtime.cancelTurn(this.resolveRuntimeSessionId(request.sessionId));
      this.cancelPendingPermissions(request.sessionId);
    }
    return {};
  }

  private async handleSessionClose(params: JsonValue | undefined): Promise<JsonValue> {
    const result = sessionIdParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const runtimeSessionId = this.resolveRuntimeSessionId(result.data.sessionId);
    this.runtime.cancelTurn(runtimeSessionId);
    this.cancelPendingPermissions(result.data.sessionId);
    await this.runtime.closeSession(runtimeSessionId);
    this.sessionAliases.delete(result.data.sessionId);
    this.sessionCwds.delete(result.data.sessionId);
    this.sessionCwds.delete(runtimeSessionId);
    this.sessionAdditionalDirectories.delete(result.data.sessionId);
    this.sessionAdditionalDirectories.delete(runtimeSessionId);
    return {};
  }

  private async handleSessionDelete(params: JsonValue | undefined): Promise<JsonValue> {
    const result = sessionIdParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    const runtimeSessionId = this.resolveRuntimeSessionId(result.data.sessionId);
    this.runtime.cancelTurn(runtimeSessionId);
    this.cancelPendingPermissions(result.data.sessionId);
    await this.runtime.deleteSession(runtimeSessionId);
    this.sessionAliases.delete(result.data.sessionId);
    this.sessionCwds.delete(result.data.sessionId);
    this.sessionCwds.delete(runtimeSessionId);
    this.sessionAdditionalDirectories.delete(result.data.sessionId);
    this.sessionAdditionalDirectories.delete(runtimeSessionId);
    return {};
  }

  private async handleSetSessionConfig(params: JsonValue | undefined): Promise<JsonValue> {
    const result = setSessionConfigParamsSchema.safeParse(params ?? {});
    if (!result.success) {
      throw invalidParams(result.error.issues);
    }
    if (result.data.type === "boolean" && !this.clientCapabilities.booleanConfigOptions) {
      throw new JsonRpcError(JSON_RPC_INVALID_PARAMS, "Boolean config options are not supported by this client.");
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
      mode: result.data.modeId,
      enabled: true,
    });
    this.rememberSessionAlias(clientSessionId, session.id);
    await this.emitSessionUpdate(clientSessionId, {
      sessionUpdate: "current_mode_update",
      currentModeId: result.data.modeId,
    });
    return {};
  }

  private async replaySessionEntries(clientSessionId: string, runtimeSessionId: string, entries: unknown[]): Promise<void> {
    for (const entry of entries) {
      const update = sessionEntryToUpdate(entry, this.cwdForSession(clientSessionId));
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

  private async emitSessionInfoUpdate(sessionId: string, session: RuntimeSessionInfo): Promise<void> {
    const update = sessionInfoUpdate(session);
    if (!update) return;
    await this.emitSessionUpdate(sessionId, update);
  }

  private async emitAvailableCommands(sessionId: string): Promise<void> {
    const commands = this.runtime.listCommands({ surface: "acp" });
    await this.emitSessionUpdate(sessionId, {
      sessionUpdate: "available_commands_update",
      availableCommands: commands.map(runtimeCommandToAcp),
    });
  }

  private afterResponse(effect: () => Promise<void>): void {
    this.postResponseEffects.push(effect);
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

    const update = this.runtimeEventToUpdate(sessionId, event);
    if (update) await this.emitSessionUpdate(sessionId, update);
  }

  private async handlePermissionRequest(sessionId: string, event: Extract<RuntimeEvent, { type: "dangerous_confirmation" }>): Promise<void> {
    if (!this.requestClient || !this.clientCapabilities.requestPermission) {
      event.resolve("deny");
      return;
    }

    let settled = false;
    try {
      const rawInput = {
        command: event.toolName === "bash" ? event.description : undefined,
        description: event.description,
        reason: event.reason,
        level: event.level,
        alternatives: event.alternatives,
      };
      const permissionResolver = (decision: "deny") => {
        settled = true;
        event.resolve(decision);
      };
      this.trackPendingPermission(sessionId, permissionResolver);
      try {
        const response = await this.requestClient("session/request_permission", {
          sessionId,
          toolCall: {
            toolCallId: event.toolCallId,
            title: toolTitle(event.toolName, rawInput),
            kind: toolKind(event.toolName),
            status: "pending",
            rawInput: compactJsonObject(rawInput),
            _meta: toolMeta(event.toolName, rawInput),
          },
          options: ACP_PERMISSION_OPTIONS,
        });
        if (!settled) event.resolve(permissionDecisionFromAcp(response));
      } finally {
        this.untrackPendingPermission(sessionId, permissionResolver);
      }
    } catch {
      if (!settled) event.resolve("deny");
    }
  }

  private async emitSessionUpdate(sessionId: string, update: JsonValue): Promise<void> {
    await this.notify?.("session/update", {
      sessionId,
      update,
    });
  }

  private runtimeEventToUpdate(sessionId: string, event: RuntimeEvent): JsonValue | undefined {
    switch (event.type) {
      case "assistant_text_delta": {
        if (event.delta) {
          const previous = this.streamedAssistantTextBySession.get(sessionId) ?? "";
          this.streamedAssistantTextBySession.set(sessionId, previous + event.delta);
        }
        return {
          sessionUpdate: "agent_message_chunk",
          messageId: event.messageId,
          content: { type: "text", text: event.delta },
        };
      }
      case "assistant_message": {
        // ACP clients (e.g. Zed) append agent_message_chunk bodies. After streaming
        // deltas, a second full-body assistant_message would duplicate the visible text.
        // Keep metadata (evidence handoff) but suppress a redundant body when the text
        // was already streamed, or is essentially the same final handoff.
        const streamed = this.streamedAssistantTextBySession.get(sessionId) ?? "";
        const metadataOnly = shouldSuppressAssistantMessageBody(streamed, event.text);
        if (!metadataOnly && event.text) {
          this.streamedAssistantTextBySession.set(sessionId, streamed + event.text);
        }
        return agentMessageUpdate({
          messageId: event.messageId,
          text: event.text,
          metadataOnly,
        });
      }
      case "assistant_reasoning_delta":
        return {
          sessionUpdate: "agent_thought_chunk",
          messageId: event.messageId,
          content: { type: "text", text: event.delta },
        };
      case "assistant_text_done":
        return agentMessageUpdate({
          messageId: event.messageId,
          text: event.fullText,
          metadataOnly: true,
        });
      case "tool_call_start": {
        const key = this.toolCallKey(sessionId, event.toolCallId);
        this.activeToolCalls.set(key, { toolName: event.toolName, args: event.args });
        return toolCallStartUpdate(event.toolCallId, event.toolName, event.args, this.cwdForSession(sessionId));
      }
      case "tool_call_result": {
        const key = this.toolCallKey(sessionId, event.toolCallId);
        const active = this.activeToolCalls.get(key);
        const args = active?.args;
        const status = event.result.isError ? "failed" : "completed";
        if (active) active.resultStatus = status;
        return toolCallResultUpdate(event.toolCallId, event.toolName, event.result, args, status, this.cwdForSession(sessionId));
      }
      case "tool_call_end": {
        const key = this.toolCallKey(sessionId, event.toolCallId);
        const active = this.activeToolCalls.get(key);
        this.activeToolCalls.delete(key);
        return toolCallEndUpdate(event.toolCallId, event.toolName, event.durationMs, active);
      }
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
        if (event.eventType === "plan") {
          return {
            sessionUpdate: "plan",
            entries: [{
              content: event.message,
              priority: "medium",
              status: "in_progress",
            }],
            _meta: {
              soba: {
                evidence: {
                  source: "working_narration",
                  evidenceIds: event.evidenceIds,
                },
              },
            },
          };
        }
        return {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: event.message },
          _meta: {
            eventType: event.eventType,
            evidenceIds: event.evidenceIds,
            soba: {
              evidence: {
                source: "working_narration",
                evidenceIds: event.evidenceIds,
              },
            },
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
      case "plan_update":
        return {
          sessionUpdate: "plan",
          entries: event.entries,
        };
      default:
        return undefined;
    }
  }

  private toolCallKey(sessionId: string, toolCallId: string): string {
    return `${sessionId}\u0000${toolCallId}`;
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

  private rememberSessionState(sessionId: string, cwd: string, additionalDirectories: string[]): void {
    this.sessionCwds.set(sessionId, absolutePath(this.cwd, cwd));
    this.sessionAdditionalDirectories.set(sessionId, additionalDirectories.map((path) => absolutePath(this.cwd, path)));
  }

  private cwdForSession(sessionId: string): string {
    return this.sessionCwds.get(sessionId)
      ?? this.sessionCwds.get(this.resolveRuntimeSessionId(sessionId))
      ?? this.cwd;
  }

  private trackPendingPermission(sessionId: string, resolve: (decision: "deny") => void): void {
    const resolvers = this.pendingPermissions.get(sessionId) ?? new Set<(decision: "deny") => void>();
    resolvers.add(resolve);
    this.pendingPermissions.set(sessionId, resolvers);
  }

  private untrackPendingPermission(sessionId: string, resolve: (decision: "deny") => void): void {
    const resolvers = this.pendingPermissions.get(sessionId);
    if (!resolvers) return;
    resolvers.delete(resolve);
    if (resolvers.size === 0) this.pendingPermissions.delete(sessionId);
  }

  private cancelPendingPermissions(sessionId: string): void {
    const ids = [sessionId, this.resolveRuntimeSessionId(sessionId)];
    for (const id of ids) {
      const resolvers = this.pendingPermissions.get(id);
      if (!resolvers) continue;
      this.pendingPermissions.delete(id);
      for (const resolve of resolvers) resolve("deny");
    }
  }
}

function extractSessionId(params: JsonValue | undefined): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const value = params.sessionId;
  return typeof value === "string" ? value : undefined;
}

function absolutePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function isSessionNotFound(error: unknown): boolean {
  return error instanceof Error && /session not found/i.test(error.message);
}

function encodeSessionListCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeSessionListCursor(cursor: string | null): { offset: number } {
  if (!cursor) return { offset: 0 };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!isRecord(parsed) || typeof parsed.offset !== "number" || !Number.isInteger(parsed.offset) || parsed.offset < 0) {
      throw new Error("Invalid cursor payload.");
    }
    return { offset: parsed.offset };
  } catch {
    throw new JsonRpcError(JSON_RPC_INVALID_PARAMS, "Invalid session/list cursor.");
  }
}

function configOptionToAcp(option: RuntimeSessionConfigOption): JsonValue {
  const value: { [key: string]: JsonValue } = {
    id: option.id,
    name: option.name,
    description: option.description ?? null,
    category: option.category ?? "model",
    type: option.type,
    currentValue: option.currentValue,
  };
  if (option.type === "select") {
    value.options = (option.options ?? []).map((selectOption) => ({
      value: selectOption.value,
      name: selectOption.name,
      description: selectOption.description ?? null,
    }));
  }
  return value;
}

const ACP_COMMAND_DESCRIPTIONS: Record<string, string> = {
  compact: "Summarize the conversation to free up context.",
  rewind: "Rewind the session to a checkpoint.",
  session: "Show session statistics.",
  sessions: "List, resume, close, or delete sessions.",
  capsule: "Create, export, load, or inspect context capsules.",
  "auto-compact": "Show or change automatic compaction.",
  budget: "Show token budget usage.",
  config: "Show active configuration.",
  lang: "Change the response language.",
  permissions: "Show or change permission mode.",
  skill: "Manage skills.",
  "project-trust": "Show or change project skill trust.",
  mcp: "Manage MCP servers.",
  help: "Show available commands.",
};

function runtimeCommandToAcp(command: RuntimeCommandMetadata): JsonValue {
  const input = runtimeCommandInputToAcp(command);
  return {
    name: command.id,
    description: ACP_COMMAND_DESCRIPTIONS[command.id] ?? command.usage ?? command.name,
    ...(input ? { input } : {}),
    _meta: {
      soba: {
        commandId: command.id,
        slashCommand: command.name,
        descriptionKey: command.descriptionKey,
        usage: command.usage ?? null,
      },
    },
  };
}

function runtimeCommandInputToAcp(command: RuntimeCommandMetadata): JsonValue | undefined {
  if (!command.usage) return undefined;
  const usage = command.usage.trim();
  const hint = usage.startsWith(command.name)
    ? usage.slice(command.name.length).trim()
    : usage;
  return hint ? { hint } : undefined;
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
  const value: { [key: string]: JsonValue } = {
    sessionId: session.id,
    cwd: absolutePath(process.cwd(), session.cwd),
    title: session.title ?? null,
    updatedAt: session.updatedAt ?? null,
  };
  if (session.additionalDirectories && session.additionalDirectories.length > 0) {
    value.additionalDirectories = session.additionalDirectories.map((path) => absolutePath(session.cwd, path));
  }
  return value;
}

function sessionInfoUpdate(session: RuntimeSessionInfo): JsonValue | undefined {
  const update: { [key: string]: JsonValue } = {
    sessionUpdate: "session_info_update",
  };
  if (session.title !== undefined) update.title = session.title ?? null;
  if (session.updatedAt !== undefined) update.updatedAt = session.updatedAt ?? null;
  if (session.entries !== undefined) {
    update._meta = {
      soba: {
        entries: session.entries,
      },
    };
  }
  return Object.keys(update).length > 1 ? update : undefined;
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

function agentMessageUpdate(input: { messageId: string; text: string; metadataOnly?: boolean }): JsonValue | undefined {
  const evidence = splitEvidenceHandoff(input.text).evidence;
  if (!evidence && input.metadataOnly) return undefined;

  const update: { [key: string]: JsonValue } = {
    sessionUpdate: "agent_message_chunk",
    messageId: input.messageId,
    content: { type: "text", text: input.metadataOnly ? "" : input.text },
  };
  if (evidence) {
    update._meta = {
      soba: {
        evidence: evidenceHandoffMeta(evidence),
      },
    };
  }
  return update;
}

/**
 * Decide whether a final assistant_message body should be suppressed on the ACP wire.
 * Clients append chunk text, so re-sending text that was already streamed (or a finish
 * handoff whose body is essentially the streamed answer + evidence) would double the UI.
 */
function shouldSuppressAssistantMessageBody(streamed: string, fullText: string): boolean {
  if (!fullText) return true;
  if (!streamed) return false;
  if (fullText === streamed) return true;
  if (fullText.startsWith(streamed)) return true;

  const streamedBody = splitEvidenceHandoff(streamed).body.trim();
  const fullBody = splitEvidenceHandoff(fullText).body.trim();
  if (streamedBody.length > 0 && fullBody === streamedBody) return true;
  if (streamedBody.length > 0 && fullBody.startsWith(streamedBody)) return true;

  return false;
}

function toolCallStartUpdate(toolCallId: string, toolName: string, args: Record<string, unknown>, cwd: string): JsonValue {
  const update: { [key: string]: JsonValue } = {
    sessionUpdate: "tool_call",
    toolCallId,
    title: toolTitle(toolName, args),
    kind: toolKind(toolName),
    status: "pending",
    rawInput: jsonValueFromUnknown(args) ?? {},
    _meta: toolMeta(toolName, args),
  };
  const locations = toolLocations(toolName, args, undefined, cwd);
  if (locations.length > 0) update.locations = locations;
  return update;
}

function toolCallResultUpdate(
  toolCallId: string,
  toolName: string,
  result: { content?: unknown; details?: Record<string, unknown>; isError?: boolean },
  args: Record<string, unknown> | undefined,
  status: "completed" | "failed",
  cwd: string,
): JsonValue {
  const update: { [key: string]: JsonValue } = {
    sessionUpdate: "tool_call_update",
    toolCallId,
    title: toolTitle(toolName, args, result),
    status,
    content: toolResultContent(result, cwd),
    rawOutput: jsonValueFromUnknown(result) ?? {},
    _meta: toolMeta(toolName, args, result),
  };
  const locations = toolLocations(toolName, args, result, cwd);
  if (locations.length > 0) update.locations = locations;
  return update;
}

function toolCallEndUpdate(
  toolCallId: string,
  toolName: string,
  durationMs: number,
  active: ActiveAcpToolCall | undefined,
): JsonValue {
  const update: { [key: string]: JsonValue } = {
    sessionUpdate: "tool_call_update",
    toolCallId,
    _meta: toolMeta(toolName, active?.args, undefined, { durationMs }),
  };
  if (!active?.resultStatus) {
    update.status = "completed";
    if (active?.args) update.title = toolTitle(toolName, active.args);
  }
  return update;
}

function toolKind(toolName: string): string {
  const normalized = normalizedToolName(toolName);
  if (normalized === "bash" || normalized === "local_shell") return "execute";
  if (["read", "inspect_file", "ls"].includes(normalized)) return "read";
  if (["edit", "write"].includes(normalized)) return "edit";
  if (["delete", "rm"].includes(normalized)) return "delete";
  if (["move", "mv"].includes(normalized)) return "move";
  if (["search", "search_files", "rg", "grep"].includes(normalized)) return "search";
  if (toolName.startsWith("mcp__")) return "fetch";
  return "other";
}

function toolTitle(
  toolName: string,
  args?: Record<string, unknown>,
  result?: { details?: Record<string, unknown>; isError?: boolean },
): string {
  const normalized = normalizedToolName(toolName);
  const details = result?.details;
  const path = pathFrom(args, details);
  const command = commandFrom(args, details);
  const query = stringField(args, "query") ?? stringField(details, "query");

  if (normalized === "bash" || normalized === "local_shell") {
    const suffix = commandStatusSuffix(details, result?.isError);
    return command ? `Run: ${truncateInline(command, 120)}${suffix}` : `Run ${toolName}${suffix}`;
  }

  if (normalized === "read") {
    if (path && numberField(details, "startLine") && numberField(details, "endLine")) {
      const total = numberField(details, "totalLines");
      const suffix = total ? ` of ${total}` : "";
      return `Read ${path} lines ${numberField(details, "startLine")}-${numberField(details, "endLine")}${suffix}`;
    }
    return path ? `Read ${path}` : "Read file";
  }

  if (normalized === "inspect_file") {
    if (path && numberField(details, "startLine") && numberField(details, "endLine")) {
      const total = numberField(details, "totalLines");
      const suffix = total ? ` of ${total}` : "";
      return `Inspect ${path} lines ${numberField(details, "startLine")}-${numberField(details, "endLine")}${suffix}`;
    }
    if (path && numberField(args, "aroundLine")) return `Inspect ${path} around line ${numberField(args, "aroundLine")}`;
    return path ? `Inspect ${path}` : "Inspect file";
  }

  if (normalized === "ls") {
    const entryCount = numberField(details, "entryCount");
    const suffix = entryCount !== undefined ? ` (${entryCount} entries)` : "";
    return `List ${path ?? "."}${suffix}`;
  }

  if (normalized === "write") {
    if (path && result) {
      if (details?.oldText === null) return `Created ${path}`;
      if (typeof details?.oldText === "string") return `Updated ${path}`;
    }
    return path ? `Write ${path}` : "Write file";
  }

  if (normalized === "edit") {
    const editCount = numberField(details, "editCount");
    const suffix = editCount !== undefined ? ` (${editCount} edits)` : "";
    return path ? `${result ? "Edited" : "Edit"} ${path}${suffix}` : "Edit file";
  }

  if (normalized === "search_files" || normalized === "search" || normalized === "rg" || normalized === "grep") {
    const matchCount = numberField(details, "matchCount");
    const matchSuffix = matchCount !== undefined ? ` (${matchCount} matches)` : "";
    const scope = path ? ` in ${path}` : "";
    return query ? `Search "${truncateInline(query, 60)}"${scope}${matchSuffix}` : `Search${scope}${matchSuffix}`;
  }

  if (toolName.startsWith("mcp__")) return mcpTitle(toolName);
  return humanizeToolName(toolName);
}

function toolMeta(
  toolName: string,
  args?: Record<string, unknown>,
  result?: { details?: Record<string, unknown>; isError?: boolean },
  extra?: Record<string, unknown>,
): JsonValue {
  const details = result?.details;
  const soba = compactJsonObject({
    toolName,
    kind: toolKind(toolName),
    command: commandFrom(args, details),
    path: pathFrom(args, details),
    query: stringField(args, "query") ?? stringField(details, "query"),
    exitCode: numberOrNullField(details, "exitCode"),
    signalCode: stringOrNullField(details, "signalCode"),
    timedOut: booleanField(details, "timedOut"),
    aborted: booleanField(details, "aborted"),
    truncated: booleanField(details, "truncated"),
    totalLines: numberField(details, "totalLines"),
    readLines: numberField(details, "readLines"),
    startLine: numberField(details, "startLine"),
    endLine: numberField(details, "endLine"),
    entryCount: numberField(details, "entryCount"),
    matchCount: numberField(details, "matchCount"),
    durationMs: numberField(extra, "durationMs"),
    alternatives: jsonValueFromUnknown(args?.alternatives),
    evidence: toolEvidenceMeta(toolName, args, result, extra),
  });
  return {
    tool_name: toolName,
    soba,
  };
}

function evidenceHandoffMeta(evidence: ParsedEvidenceHandoff): JsonValue {
  return compactJsonObject({
    source: "assistant_handoff",
    status: evidence.status,
    changedFiles: evidence.changedFiles,
    diff: evidence.diff,
    checks: evidence.checks,
    risks: evidence.risks,
    reviewActions: evidence.reviewActions,
    rawLines: evidence.rawLines,
  });
}

function toolEvidenceMeta(
  toolName: string,
  args?: Record<string, unknown>,
  result?: { content?: unknown; details?: Record<string, unknown>; isError?: boolean },
  extra?: Record<string, unknown>,
): JsonValue {
  const details = result?.details;
  const durationMs = numberField(extra, "durationMs");
  return compactJsonObject({
    source: "tool_lifecycle",
    phase: durationMs !== undefined ? "end" : result ? "result" : "start",
    toolName,
    kind: toolKind(toolName),
    status: result ? result.isError ? "failed" : "completed" : durationMs !== undefined ? "completed" : "pending",
    command: commandFrom(args, details),
    path: pathFrom(args, details),
    query: stringField(args, "query") ?? stringField(details, "query"),
    exitCode: numberOrNullField(details, "exitCode"),
    durationMs,
    outputPreview: toolOutputPreview(result),
  });
}

function normalizedToolName(toolName: string): string {
  return toolName.replace(/-/g, "_");
}

function pathFrom(args?: Record<string, unknown>, details?: Record<string, unknown>): string | undefined {
  return stringField(details, "path")
    ?? stringField(details, "file")
    ?? stringField(args, "path")
    ?? stringField(args, "file");
}

function commandFrom(args?: Record<string, unknown>, details?: Record<string, unknown>): string | undefined {
  return stringField(details, "command")
    ?? stringField(args, "command")
    ?? stringField(args, "description");
}

function commandStatusSuffix(details: Record<string, unknown> | undefined, isError: boolean | undefined): string {
  if (booleanField(details, "timedOut")) return " (timed out)";
  if (booleanField(details, "aborted")) return " (aborted)";
  const exitCode = numberOrNullField(details, "exitCode");
  if (typeof exitCode === "number") return ` (exit ${exitCode})`;
  if (isError) return " (failed)";
  return "";
}

function mcpTitle(toolName: string): string {
  const parts = toolName.split("__").filter(Boolean);
  if (parts.length >= 3) return `MCP ${parts[1]}.${parts.slice(2).join(".")}`;
  return humanizeToolName(toolName);
}

function humanizeToolName(toolName: string): string {
  return toolName
    .replace(/^mcp__/, "mcp ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    || "Tool";
}

function truncateInline(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function stringOrNullField(value: Record<string, unknown> | undefined, key: string): string | null | undefined {
  const field = value?.[key];
  if (field === null) return null;
  return typeof field === "string" ? field : undefined;
}

function numberField(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const field = value?.[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function numberOrNullField(value: Record<string, unknown> | undefined, key: string): number | null | undefined {
  const field = value?.[key];
  if (field === null) return null;
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function booleanField(value: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const field = value?.[key];
  return typeof field === "boolean" ? field : undefined;
}

function compactJsonObject(value: Record<string, unknown>): { [key: string]: JsonValue } {
  const result: { [key: string]: JsonValue } = {};
  for (const [key, field] of Object.entries(value)) {
    const json = jsonValueFromUnknown(field);
    if (json !== undefined) result[key] = json;
  }
  return result;
}

function jsonValueFromUnknown(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    for (const item of value) {
      const json = jsonValueFromUnknown(item);
      if (json !== undefined) items.push(json);
    }
    return items;
  }
  if (isRecord(value)) return compactJsonObject(value);
  return String(value);
}

function toolResultContent(result: { content?: unknown; details?: Record<string, unknown> }, cwd: string): JsonValue[] {
  const content: JsonValue[] = [];
  const diff = diffContent(result.details, cwd);
  if (diff) content.push(diff);

  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (!isRecord(item)) continue;
      if (item.type === "text" && typeof item.text === "string") {
        content.push({ type: "content", content: { type: "text", text: item.text } });
      }
    }
  }

  const image = isRecord(result.details?.image) ? result.details.image : undefined;
  if (image && typeof image.data === "string" && typeof image.mimeType === "string") {
    content.push({ type: "content", content: { type: "image", data: image.data, mimeType: image.mimeType } });
  }

  return content;
}

function toolOutputPreview(result: { content?: unknown } | undefined): string | undefined {
  if (!Array.isArray(result?.content)) return undefined;
  const text = result.content
    .flatMap((item) => {
      if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") return [];
      return [item.text];
    })
    .join("\n")
    .trim();
  if (text.length === 0) return undefined;
  return truncateInline(text, 500);
}

function diffContent(details: Record<string, unknown> | undefined, cwd: string): JsonValue | undefined {
  if (!details || typeof details.path !== "string" || typeof details.newText !== "string") return undefined;
  const diff: { [key: string]: JsonValue } = {
    type: "diff",
    path: absolutePath(cwd, details.path),
    newText: details.newText,
  };
  if (typeof details.oldText === "string") {
    diff.oldText = details.oldText;
  } else if (details.oldText === null) {
    diff.oldText = null;
  }
  return diff;
}

function toolLocations(
  toolName: string,
  args: Record<string, unknown> | undefined,
  result: { details?: Record<string, unknown> } | undefined,
  cwd: string,
): JsonValue[] {
  const locations: JsonValue[] = [];
  const detailPath = pathFrom(undefined, result?.details);

  if (detailPath) {
    addLocation(locations, result?.details, cwd);
  } else {
    addLocation(locations, args, cwd);
  }

  const argPath = pathFrom(args);
  const resultLine = numberField(result?.details, "line") ?? numberField(result?.details, "startLine");
  if (!detailPath && argPath && resultLine !== undefined) locations.push({ path: absolutePath(cwd, argPath), line: resultLine });

  const matches = result?.details?.matches;
  if (Array.isArray(matches)) {
    for (const match of matches) addLocation(locations, match, cwd);
  }

  return dedupeLocations(locations.length > 0 ? locations : fallbackToolLocations(toolName, args, cwd));
}

function fallbackToolLocations(toolName: string, args: Record<string, unknown> | undefined, cwd: string): JsonValue[] {
  if (!args) return [];
  if (!["read", "edit", "delete", "move", "search"].includes(toolKind(toolName))) return [];
  return typeof args.path === "string" ? [{ path: absolutePath(cwd, args.path) }] : [];
}

function addLocation(locations: JsonValue[], value: unknown, cwd: string): void {
  if (!isRecord(value)) return;

  const nested = value.location;
  if (isRecord(nested)) addLocation(locations, nested, cwd);

  const path = typeof value.path === "string" ? value.path : typeof value.file === "string" ? value.file : undefined;
  if (!path) return;

  const location: { [key: string]: JsonValue } = {
    path: absolutePath(cwd, path),
  };
  const line = typeof value.line === "number" ? value.line : typeof value.startLine === "number" ? value.startLine : undefined;
  if (line !== undefined) location.line = line;
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
  const outcome = value.outcome;
  if (typeof outcome === "string") return outcome;
  if (outcome && typeof outcome === "object" && !Array.isArray(outcome)) {
    if (outcome.outcome === "cancelled") return "deny";
    const optionId = outcome.optionId;
    if (typeof optionId === "string") return optionId;
  }
  for (const key of ["decision", "optionId", "outcome", "id"]) {
    const field = value[key];
    if (typeof field === "string") return field;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sessionEntryToUpdate(entry: unknown, cwd: string): JsonValue | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const typedEntry = entry as { type?: unknown; item?: unknown };
  if (typedEntry.type !== "item" || !typedEntry.item || typeof typedEntry.item !== "object") return undefined;
  const item = typedEntry.item as {
    type?: unknown;
    role?: unknown;
    content?: unknown;
    call_id?: unknown;
    id?: unknown;
    name?: unknown;
    arguments?: unknown;
    command?: unknown;
    output?: unknown;
  };
  if (item.type === "message" && item.role === "user") {
    const text = messageText(item.content);
    if (!text) return undefined;
    const update: { [key: string]: JsonValue } = {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text },
    };
    if (typeof item.id === "string") update.messageId = item.id;
    return update;
  }
  if (item.type === "message" && item.role === "assistant") {
    const text = messageText(item.content);
    if (!text) return undefined;
    const update: { [key: string]: JsonValue } = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    };
    if (typeof item.id === "string") update.messageId = item.id;
    return update;
  }
  if (item.type === "function_call" && typeof item.call_id === "string") {
    const toolName = typeof item.name === "string" ? item.name : "tool";
    const args = parseToolArguments(item.arguments);
    const update = toolCallStartUpdate(item.call_id, toolName, args, cwd) as { [key: string]: JsonValue };
    update.status = "completed";
    update.rawInput = jsonValueFromUnknown(item) ?? update.rawInput;
    return update;
  }
  if (item.type === "function_call_output" && typeof item.call_id === "string") {
    return {
      sessionUpdate: "tool_call_update",
      toolCallId: item.call_id,
      status: "completed",
      content: toolOutputContent(item.output),
      rawOutput: jsonValueFromUnknown(item) ?? {},
    };
  }
  if (item.type === "local_shell_call" && typeof item.call_id === "string") {
    const args = typeof item.command === "string" ? { command: item.command } : {};
    const update = toolCallStartUpdate(item.call_id, "bash", args, cwd) as { [key: string]: JsonValue };
    update.status = "completed";
    update.rawInput = jsonValueFromUnknown(item) ?? update.rawInput;
    return update;
  }
  if (item.type === "local_shell_call_output" && typeof item.call_id === "string") {
    return {
      sessionUpdate: "tool_call_update",
      toolCallId: item.call_id,
      status: "completed",
      content: toolOutputContent(item.output),
      rawOutput: jsonValueFromUnknown(item) ?? {},
    };
  }
  return undefined;
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toolOutputContent(output: unknown): JsonValue[] {
  const text = outputText(output);
  return text ? [{ type: "content", content: { type: "text", text } }] : [];
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (!Array.isArray(output)) return "";
  return output
    .map((item) => {
      if (!isRecord(item)) return "";
      return typeof item.text === "string" ? item.text : "";
    })
    .join("");
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
