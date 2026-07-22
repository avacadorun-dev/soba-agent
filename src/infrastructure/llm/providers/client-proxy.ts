/**
 * OpenResponsesClientProxy — Phase 2.5 A1.
 *
 * Implements the OpenResponsesClient interface and delegates every call to
 * whichever client the ProviderRegistry considers active. AgentLoop can
 * be wired against this proxy and remain oblivious to /model set events.
 *
 * Why a proxy (vs. handing the registry to AgentLoop):
 *   - AgentLoop's surface is OpenResponsesClient; the proxy is a drop-in.
 *   - Switches happen at the boundary; the loop never re-initialises.
 *   - Tests can swap the underlying client directly without touching the
 *     loop's wiring.
 *
 * The proxy exposes a `change` event for the TUI so the sidebar and
 * model-selector can react to active-model changes triggered elsewhere
 * (CLI flags, config reload, etc). Change detection is "next-call": on
 * every delegated call we compare the registry's active selection with
 * the last one we saw and fire handlers on transition. This is cheap
 * (a Map lookup) and works for both sync and async callers.
 */

import type {
  CompactResource,
  CompactResponseParams,
  CreateResponseParams,
  ResponseResource,
  StreamingEvent,
} from "../../../kernel/model/openresponses-types";
import type { NativeContinuation, ProviderCapabilities, ProviderIdentity } from "../../../kernel/transcript/types-v2";
import type { NativeCompactionInput, ProviderErrorKind } from "../openai/types";
import type { OpenResponsesClient, OpenResponsesClientConfig } from "../openresponses/openresponses-client";
import type { ProviderRegistry } from "./registry";

/** Handler for active-model change notifications. */
export type ClientChangeHandler = (info: {
  providerId: string;
  modelId: string;
  previous: { providerId: string; modelId: string };
}) => void;

/** Identifies the active (provider, model) pair. */
export interface ActiveSelection {
  providerId: string;
  modelId: string;
}

/**
 * OpenResponsesClient implementation backed by a ProviderRegistry.
 */
export class OpenResponsesClientProxy implements OpenResponsesClient {
  private readonly registry: ProviderRegistry;
  private readonly changeHandlers: Set<ClientChangeHandler> = new Set();
  private lastSeen: ActiveSelection;

  constructor(registry: ProviderRegistry) {
    this.registry = registry;
    this.lastSeen = this.readActive();
  }

  /** Stop forwarding registry changes. Idempotent. */
  public dispose(): void {
    this.changeHandlers.clear();
  }

  // ─── Active selection ───

  /** Currently active provider id. */
  public getActiveProviderId(): string {
    return this.lastSeen.providerId;
  }

  /** Currently active model id. */
  public getActiveModelId(): string {
    return this.lastSeen.modelId;
  }

  public getActiveSelection(): ActiveSelection {
    return { ...this.lastSeen };
  }

  // ─── Provider metadata passthrough ───

  public getProviderIdentity(): ProviderIdentity {
    return this.delegate().getProviderIdentity();
  }

  public getProviderCapabilities(): ProviderCapabilities {
    return this.delegate().getProviderCapabilities();
  }

  public classifyError(error: unknown): ProviderErrorKind {
    return this.delegate().classifyError(error);
  }

  // ─── OpenResponsesClient methods ───

  public async create(params: CreateResponseParams, options?: { signal?: AbortSignal }): Promise<ResponseResource> {
    return this.delegate().create(params, options);
  }

  public async *createStream(params: CreateResponseParams, options?: { signal?: AbortSignal }): AsyncIterable<StreamingEvent> {
    // Delegating an async generator requires `yield*` to preserve errors
    // and stream lifecycle.
    yield* this.delegate().createStream(params, options);
  }

  public async compact(params: CompactResponseParams): Promise<CompactResource> {
    return this.delegate().compact(params);
  }

  public async compactNative(
    input: NativeCompactionInput,
    signal: AbortSignal,
  ): Promise<NativeContinuation> {
    return this.delegate().compactNative(input, signal);
  }

  public getConfig(): OpenResponsesClientConfig {
    return this.delegate().getConfig();
  }

  public updateConfig(partial: Partial<OpenResponsesClientConfig>): void {
    this.registry.updateClientDefaults(partial);
    this.delegate().updateConfig(partial);
  }

  // ─── Change events ───

  /**
   * Register a handler invoked when the active (provider, model) pair
   * changes. Returns an unsubscribe function.
   *
   * Handlers are fired lazily — on the next delegated call after the
   * registry's active selection moves. To force an immediate check
   * (e.g. after a synchronous switchModel call from a slash command),
   * call `notifyChange()`.
   */
  public onChange(handler: ClientChangeHandler): () => void {
    this.changeHandlers.add(handler);
    return () => {
      this.changeHandlers.delete(handler);
    };
  }

  /**
   * Force a change-detection pass. Returns true if a transition was
   * reported to handlers, false if the active selection is unchanged.
   */
  public notifyChange(): boolean {
    return this.detectChange();
  }

  // ─── Internals ───

  /** Read the registry's active selection without touching the cache. */
  private readActive(): ActiveSelection {
    return {
      providerId: this.registry.getActiveProvider().id,
      modelId: this.registry.getActiveModel().id,
    };
  }

  /** Resolve the client to delegate to, detecting transitions along the way. */
  private delegate(): OpenResponsesClient {
    this.detectChange();
    return this.registry.getClient(this.lastSeen.providerId, this.lastSeen.modelId);
  }

  /** Compare current vs last-seen; fire handlers on transition. */
  private detectChange(): boolean {
    const current = this.readActive();
    if (
      current.providerId === this.lastSeen.providerId &&
      current.modelId === this.lastSeen.modelId
    ) {
      return false;
    }
    const previous = this.lastSeen;
    this.lastSeen = current;
    for (const handler of this.changeHandlers) {
      try {
        handler({ providerId: current.providerId, modelId: current.modelId, previous });
      } catch {
        // Handler errors must not break the proxy.
      }
    }
    return true;
  }
}
