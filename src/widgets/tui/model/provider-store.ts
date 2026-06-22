/**
 * ProviderStore — Phase 2.5 B1a.
 *
 * Solid-based reactive facade over a ProviderRegistry + OpenResponsesClientProxy.
 * Owns the ModelSelector overlay state (open/closed, search query, highlighted item)
 * and the "switch model" action. The store does NOT touch AgentLoop or session
 * directly — it asks the registry to switch the active client and the proxy to
 * forward every subsequent call to the new client.
 *
 * Lifecycle: construct once per TUI session, call dispose() on TUI shutdown to
 * unregister the proxy.onChange handler.
 */

import { batch, createSignal } from "solid-js";
import { I18n } from "../../../core/i18n/i18n";
import type { TranslationKey } from "../../../core/i18n/types";
import type { OpenResponsesClientProxy } from "../../../core/provider/client-proxy";
import {
  DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
  DEFAULT_SYNTHETIC_MAX_OUTPUT,
} from "../../../core/provider/model-defaults";
import { findBuiltinProvider } from "../../../core/provider/providers";
import { ProviderRegistry } from "../../../core/provider/registry";
import type { ModelDefinition, ProviderDefinition } from "../../../core/provider/types";
import type { NotificationStore } from "./notification-store";

export type ModelSelectorModel = ModelDefinition & {
  selectable: boolean;
  discoveryStatus?: "pending" | "failed";
};

export interface ModelGroup {
  provider: ProviderDefinition;
  models: ModelSelectorModel[];
}

export interface ModelSelectorEntry {
  providerId: string;
  modelId: string;
  modelName: string;
  providerName: string;
  providerCustom: boolean;
  contextWindow: number;
  maxOutput: number;
  supportsStreaming: boolean;
  supportsThinking: boolean;
  selectable: boolean;
  discoveryStatus?: "pending" | "failed";
}

export interface ProviderStoreOptions {
  registry: ProviderRegistry;
  proxy: OpenResponsesClientProxy;
  i18n?: I18n;
  /** Optional notification store for test-connection results (Phase 2.5 B1d). */
  notificationStore?: NotificationStore;
}

export type ModelSelectorStatus =
  | { kind: "idle" }
  | { kind: "switched"; providerId: string; modelId: string; providerName: string; modelName: string }
  | { kind: "failed"; providerId: string; modelId: string; message: string };

export class ProviderStore {
  readonly registry: ProviderRegistry;
  readonly proxy: OpenResponsesClientProxy;
  private readonly i18n: I18n;
  private notificationStore?: NotificationStore;
  // Detached change handler returned by proxy.onChange; called from dispose().
  private unsubscribeProxy: () => void = () => {};

  // Signals.
  private readonly _isOpen: ReturnType<typeof createSignal<boolean>>;
  private readonly _searchQuery: ReturnType<typeof createSignal<string>>;
  private readonly _highlightedIndex: ReturnType<typeof createSignal<number>>;
  private readonly _status: ReturnType<typeof createSignal<ModelSelectorStatus>>;
  private readonly _activeProviderId: ReturnType<typeof createSignal<string>>;
  private readonly _activeModelId: ReturnType<typeof createSignal<string>>;
  private readonly _catalogVersion: ReturnType<typeof createSignal<number>>;

  constructor(options: ProviderStoreOptions) {
    this.registry = options.registry;
    this.proxy = options.proxy;
    this.i18n = options.i18n ?? new I18n("en");
    this.notificationStore = options.notificationStore;
    const initial = this.registry.getActiveProvider();
    this._activeProviderId = createSignal(initial.id);
    this._activeModelId = createSignal(this.registry.getActiveModel().id);
    this._isOpen = createSignal(false);
    this._searchQuery = createSignal("");
    this._highlightedIndex = createSignal(0);
    this._status = createSignal<ModelSelectorStatus>({ kind: "idle" });
    this._catalogVersion = createSignal(0);
    // Subscribe to proxy.onChange so external setActive() / switchModel()
    // (e.g. from a future slash command) keeps the store in sync.
    this.unsubscribeProxy = this.proxy.onChange((info) => {
      batch(() => {
        this._activeProviderId[1](info.providerId);
        this._activeModelId[1](info.modelId);
        this._catalogVersion[1]((version) => version + 1);
      });
    });
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  isOpen = (): boolean => this._isOpen[0]();
  searchQuery = (): string => this._searchQuery[0]();
  highlightedIndex = (): number => this._highlightedIndex[0]();
  status = (): ModelSelectorStatus => this._status[0]();
  activeProviderId = (): string => this._activeProviderId[0]();
  activeModelId = (): string => this._activeModelId[0]();

  /**
   * All providers (built-in + custom) in registry order.
   * Custom providers are appended after built-ins for stable display.
   */
  providers = (): ProviderDefinition[] => this.registry.getAllProviders();

  /**
   * Grouped view filtered by the search query. A provider is shown if any of
   * its models match (case-insensitive substring over model id/name). When the
   * query is empty, every provider is shown.
   *
   * Recomputed on every read; cheap because the registry is small and Solid
   * tracks signal reads in JSX, so consumers re-derive on signal changes.
   */
  filteredGroups = (): ModelGroup[] => {
    this._catalogVersion[0]();
    const query = this._searchQuery[0]().trim().toLowerCase();
    const groups: ModelGroup[] = [];
    for (const provider of this.registry.getAllProviders()) {
      // `getModelsFor` joins `provider.models` (custom) with the
      // discovery cache for built-ins. Returns [] when neither is
      // set. For built-ins before discovery, we show a placeholder;
      // the wizard replaces it with real models after discovery.
      let all: ModelSelectorModel[] = this.registry
        .getModelsFor(provider.id)
        .map((model) => ({ ...model, selectable: true }));
      if (all.length === 0) {
        const seed =
          provider.defaultModel ??
          (provider.id === this._activeProviderId[0]() ? this._activeModelId[0]() : "");
        if (seed) {
          all = [
            {
              id: seed,
              name: seed,
              // Conservative defaults — the wizard will replace them
              // with real values from the catalogue.
              contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
              maxOutput: DEFAULT_SYNTHETIC_MAX_OUTPUT,
              supportsStreaming: true,
              supportsThinking: false,
              selectable: true,
            },
          ];
        } else if (findBuiltinProvider(provider.id)) {
          const discovery = this.registry.getModelDiscoveryStatus(provider.id);
          const failed = discovery.kind === "failed";
          all = [
            {
              id: "",
              name: failed
                ? this.t("tui.modelSelector.discoveryFailedShort")
                : this.t("tui.modelSelector.loadingModels"),
              contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
              maxOutput: DEFAULT_SYNTHETIC_MAX_OUTPUT,
              supportsStreaming: false,
              supportsThinking: false,
              selectable: false,
              discoveryStatus: failed ? "failed" : "pending",
            },
          ];
        }
      }
      const providerMatches =
        query.length > 0 &&
        (provider.id.toLowerCase().includes(query) || provider.name.toLowerCase().includes(query));
      const matched = query
        ? providerMatches
          ? all
          : all.filter(
              (model) => model.id.toLowerCase().includes(query) || model.name.toLowerCase().includes(query),
            )
        : all;
      if (matched.length === 0) continue;
      groups.push({ provider, models: matched });
    }
    return groups;
  };

  /**
   * Flat list of (providerId, modelId) pairs in display order, used for
   * keyboard navigation (↑/↓) and index-based highlighting.
   */
  flatEntries = (): ModelSelectorEntry[] => {
    return this.filteredGroups().flatMap<ModelSelectorEntry>((group) =>
      (group.models ?? []).map((model) => ({
        providerId: group.provider.id,
        modelId: model.id,
        modelName: model.name,
        providerName: group.provider.name,
        providerCustom: group.provider.custom === true,
        contextWindow: model.contextWindow,
        maxOutput: model.maxOutput,
        supportsStreaming: model.supportsStreaming,
        supportsThinking: model.supportsThinking,
        selectable: model.selectable,
        discoveryStatus: model.discoveryStatus,
      })),
    );
  };

  activeEntry = (): ModelSelectorEntry | null => {
    const providerId = this._activeProviderId[0]();
    const modelId = this._activeModelId[0]();
    const provider = this.registry.getProvider(providerId);
    const model = this.registry.getModel(providerId, modelId);
    if (!provider || !model) return null;
    return {
      providerId,
      modelId,
      modelName: model.name,
      providerName: provider.name,
      providerCustom: provider.custom === true,
      contextWindow: model.contextWindow,
      maxOutput: model.maxOutput,
      supportsStreaming: model.supportsStreaming,
      supportsThinking: model.supportsThinking,
      selectable: true,
    };
  };

  /**
   * Convenience derived value for the status bar: "Provider / Model".
   * Returns an empty string when the active selection can't be resolved.
   */
  activeLabel = (): string => {
    const providerId = this._activeProviderId[0]();
    const modelId = this._activeModelId[0]();
    const provider = this.registry.getProvider(providerId);
    const model = this.registry.getModel(providerId, modelId);
    if (!provider || !model) return "";
    return `${provider.name} / ${model.name}`;
  };

  // ── Mutators ──────────────────────────────────────────────────────────────

  open(): void {
    batch(() => {
      this._searchQuery[1]("");
      this._highlightedIndex[1](0);
      this._isOpen[1](true);
    });
    // Trigger model discovery for built-in providers in the background.
    // The list re-renders automatically through Solid signals when the
    // discovery cache is populated. Non-blocking — the picker shows
    // synthetic entries immediately and updates when results arrive.
    void this.registry
      .refreshBuiltinModels(() => {
        this._catalogVersion[1]((version) => version + 1);
      })
      .catch(() => {
        // Discovery failure is non-fatal — placeholders stay visible.
      })
      .finally(() => {
        this._catalogVersion[1]((version) => version + 1);
      });
  }

  close(): void {
    this._isOpen[1](false);
  }

  toggle(): void {
    if (this._isOpen[0]()) this.close();
    else this.open();
  }

  setSearch(value: string): void {
    batch(() => {
      this._searchQuery[1](value);
      this._highlightedIndex[1](0);
    });
  }

  moveHighlight(delta: number): void {
    const length = this.flatEntries().length;
    if (length === 0) return;
    const next = (this._highlightedIndex[0]() + delta + length) % length;
    this._highlightedIndex[1](next);
  }

  setHighlight(index: number): void {
    const length = this.flatEntries().length;
    if (length === 0) {
      this._highlightedIndex[1](0);
      return;
    }
    const clamped = Math.max(0, Math.min(index, length - 1));
    this._highlightedIndex[1](clamped);
  }

  /**
   * Switch to the currently highlighted entry, or to (providerId, modelId)
   * when given explicitly. Returns the new status; status is also exposed
   * via status() for components to render the result message.
   */
  select(providerId?: string, modelId?: string): ModelSelectorStatus {
    let target:
      | { providerId: string; modelId: string; providerName: string; modelName: string }
      | null = null;
    if (providerId && modelId) {
      const provider = this.registry.getProvider(providerId);
      const model = this.registry.getModel(providerId, modelId);
      if (!provider || !model) {
        const status: ModelSelectorStatus = {
          kind: "failed",
          providerId,
          modelId,
          message: this.t("tui.modelSelector.unknown", { provider: providerId, model: modelId }),
        };
        this._status[1](status);
        return status;
      }
      target = { providerId, modelId, providerName: provider.name, modelName: model.name };
    } else {
      const entries = this.flatEntries();
      const entry = entries[this._highlightedIndex[0]()];
      if (!entry || !entry.selectable) {
        const status: ModelSelectorStatus = { kind: "idle" };
        this._status[1](status);
        return status;
      }
      target = {
        providerId: entry.providerId,
        modelId: entry.modelId,
        providerName: entry.providerName,
        modelName: entry.modelName,
      };
    }
    const switched = this.registry.switchModel(target.providerId, target.modelId);
    if (!switched) {
      const status: ModelSelectorStatus = {
        kind: "failed",
        providerId: target.providerId,
        modelId: target.modelId,
        message: this.t("tui.modelSelector.failedSwitch", {
          provider: target.providerName,
          model: target.modelName,
        }),
      };
      this._status[1](status);
      return status;
    }
    // Force proxy change handlers to fire immediately so the sidebar
    // updates its model display without waiting for the next API call.
    this.proxy.notifyChange();

    // Fire-and-forget test-connection; display result as notification (Phase 2.5 B1d).
    if (this.notificationStore) {
      this.registry
        .testConnection(target.providerId, target.modelId)
        .then((result) => {
          if (result.ok) {
            this.notificationStore?.notify(
              "success",
              this.t("tui.modelSelector.connectionTest"),
              this.t("tui.modelSelector.connectionSuccess", {
                provider: target.providerName,
                model: target.modelName,
              }),
            );
          } else {
            this.notificationStore?.notify(
              "error",
              this.t("tui.modelSelector.connectionTest"),
              this.t("tui.modelSelector.connectionFailed", { message: result.error ?? "Unknown error" }),
            );
          }
        })
        .catch((err) => {
          this.notificationStore?.notify(
            "error",
            this.t("tui.modelSelector.connectionTest"),
            this.t("tui.modelSelector.connectionFailed", {
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        });
    }

    const status: ModelSelectorStatus = {
      kind: "switched",
      providerId: target.providerId,
      modelId: target.modelId,
      providerName: target.providerName,
      modelName: target.modelName,
    };
    batch(() => {
      this._status[1](status);
      this._activeProviderId[1](target.providerId);
      this._activeModelId[1](target.modelId);
      this._isOpen[1](false);
    });
    return status;
  }

  /**
   * Clear the last status (call after rendering a notification/toast).
   */
  clearStatus(): void {
    this._status[1]({ kind: "idle" });
  }

  /**
   * Set notification store reference after construction (Phase 2.5 B1d).
   * Called from InteractiveTUI constructor after NotificationStore is created.
   */
  setNotificationStore(store: NotificationStore): void {
    this.notificationStore = store;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  dispose(): void {
    this.unsubscribeProxy();
    this.close();
  }

  // ── i18n ──────────────────────────────────────────────────────────────────

  /** Public translation helper used by UI components that bind to this store. */
  t(key: TranslationKey, vars?: Record<string, string | number>): string {
    return this.i18n.t(key, vars);
  }
}
