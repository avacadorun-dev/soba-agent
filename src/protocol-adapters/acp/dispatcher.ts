import type { SobaRuntime } from "../../application/types";
import { ACP_FOUNDATION_FEATURES, ACP_PROTOCOL_VERSION, type AcpFeatureSet, buildAgentCapabilities } from "./capabilities";
import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_METHOD_NOT_FOUND,
  JsonRpcError,
  type JsonRpcRequest,
  type JsonValue,
} from "./json-rpc";
import { AcpRequestRegistry } from "./request-registry";
import { initializeParamsSchema, sessionCancelParamsSchema, sessionNewParamsSchema } from "./schemas";

export interface AcpDispatcherOptions {
  runtime: SobaRuntime;
  cwd: string;
  agentInfo?: {
    name: string;
    version: string;
  };
  features?: AcpFeatureSet;
}

export interface AcpDispatchContext {
  signal: AbortSignal;
}

export class AcpDispatcher {
  private readonly runtime: SobaRuntime;
  private readonly cwd: string;
  private readonly agentInfo: { name: string; version: string };
  private readonly features: AcpFeatureSet;
  private readonly requestRegistry = new AcpRequestRegistry();

  constructor(options: AcpDispatcherOptions) {
    this.runtime = options.runtime;
    this.cwd = options.cwd;
    this.agentInfo = options.agentInfo ?? { name: "soba-agent", version: "0.0.0" };
    this.features = options.features ?? ACP_FOUNDATION_FEATURES;
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
      case "initialize":
        return this.handleInitialize(request.params);
      case "session/new":
        return this.handleSessionNew(request.params, context);
      case "session/cancel":
        return this.handleSessionCancel(request.params);
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

    const session = await this.runtime.createSession({ cwd: result.data.cwd ?? this.cwd });
    return {
      session: {
        id: session.id,
        cwd: session.cwd,
        title: session.title ?? null,
        updatedAt: session.updatedAt ?? null,
      },
    };
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
