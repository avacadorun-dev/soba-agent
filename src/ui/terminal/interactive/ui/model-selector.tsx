/**
 * ModelSelector — provider/model picker opened with F2 or /model.
 *
 * Dense two-column overlay:
 * - current selection and model limits are visible at the top
 * - providers are listed on the left, models for the highlighted provider on the right
 * - search filters both provider and model names/ids
 * - Enter selects the highlighted model, Tab/←/→ changes provider
 */

import type { MouseEvent, TextareaRenderable } from "@opentui/core";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { TuiThemeName } from "../../../../application/public";
import { formatTokens } from "../lib/format-tool";
import { getTuiTheme } from "../lib/theme";
import type { ModelGroup, ModelSelectorEntry, ProviderStore } from "../model/provider-store";

const MAX_HEIGHT = 28;
const MIN_HEIGHT = 14;
const MIN_WIDTH = 72;
const MAX_WIDTH = 96;

function sliceAround<T>(items: T[], activeIndex: number, maxRows: number): { items: T[]; start: number } {
  if (maxRows <= 0 || items.length <= maxRows) return { items, start: 0 };
  const safeIndex = Math.max(0, Math.min(activeIndex, items.length - 1));
  const half = Math.floor(maxRows / 2);
  const start = Math.max(0, Math.min(safeIndex - half, items.length - maxRows));
  return { items: items.slice(start, start + maxRows), start };
}

function modelBadges(entry: ModelSelectorEntry, store: ProviderStore): string {
  if (!entry.selectable) {
    return entry.discoveryStatus === "failed"
      ? store.t("tui.modelSelector.discoveryFailed")
      : store.t("tui.modelSelector.discoveryPending");
  }
  const badges = [
    store.t("tui.modelSelector.contextShort", { tokens: formatTokens(entry.contextWindow) }),
    store.t("tui.modelSelector.outputShort", { tokens: formatTokens(entry.maxOutput) }),
  ];
  if (entry.supportsStreaming) badges.push(store.t("tui.modelSelector.streamingBadge"));
  if (entry.supportsThinking) badges.push(store.t("tui.modelSelector.thinkingBadge"));
  return badges.join(" · ");
}

function modelIdSuffix(entry: ModelSelectorEntry): string {
  return entry.modelId === entry.modelName ? "" : ` ${entry.modelId}`;
}

export function ModelSelector(props: {
  store: ProviderStore;
  themeName: () => TuiThemeName;
  width: number;
  height: number;
}) {
  const theme = () => getTuiTheme(props.themeName());
  const [query, setQuery] = createSignal(props.store.searchQuery());
  let textareaRef: TextareaRenderable | null = null;

  createEffect(() => {
    if (props.store.isOpen()) {
      setQuery("");
      props.store.setSearch("");
      queueMicrotask(() => {
        textareaRef?.focus();
      });
    }
  });

  const groups = createMemo<ModelGroup[]>(() => props.store.filteredGroups());
  const flatEntries = createMemo<ModelSelectorEntry[]>(() => props.store.flatEntries());
  const highlight = createMemo<number>(() => props.store.highlightedIndex());
  const activeEntry = createMemo<ModelSelectorEntry | null>(() => props.store.activeEntry());

  const selectedEntry = createMemo<ModelSelectorEntry | null>(() => flatEntries()[highlight()] ?? null);
  const selectedProviderId = createMemo<string>(() => selectedEntry()?.providerId ?? groups()[0]?.provider.id ?? "");
  const selectedGroup = createMemo<ModelGroup | undefined>(() =>
    groups().find((group) => group.provider.id === selectedProviderId()),
  );
  const selectedProviderIndex = createMemo<number>(() => {
    const index = groups().findIndex((group) => group.provider.id === selectedProviderId());
    return index >= 0 ? index : 0;
  });
  const selectedModelIndex = createMemo<number>(() => {
    const group = selectedGroup();
    const entry = selectedEntry();
    if (!group || !entry) return 0;
    const index = group.models.findIndex((model) => model.id === entry.modelId);
    return index >= 0 ? index : 0;
  });

  const overlayWidth = () => {
    const available = Math.max(36, props.width - 4);
    const preferred = Math.floor(props.width * 0.86);
    return Math.min(MAX_WIDTH, Math.max(Math.min(MIN_WIDTH, available), preferred), available);
  };
  const overlayHeight = () => Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, props.height - 4));
  const bodyRows = () => Math.max(4, overlayHeight() - 7);
  const providerColumnWidth = () => Math.max(20, Math.min(28, Math.floor(overlayWidth() * 0.32)));
  const modelColumnWidth = () => Math.max(28, overlayWidth() - providerColumnWidth() - 6);
  const leftCol = () => Math.max(0, Math.floor((props.width - overlayWidth()) / 2));
  const topRow = () => Math.max(0, Math.floor((props.height - overlayHeight()) / 2));

  const providerRows = createMemo(() => sliceAround(groups(), selectedProviderIndex(), bodyRows()));
  const modelRows = createMemo(() => sliceAround(selectedGroup()?.models ?? [], selectedModelIndex(), bodyRows()));

  const findFlatIndex = (providerId: string, modelId?: string): number => {
    const entries = flatEntries();
    const index = entries.findIndex(
      (entry) => entry.providerId === providerId && (modelId === undefined || entry.modelId === modelId),
    );
    return index >= 0 ? index : 0;
  };

  const moveProvider = (delta: number) => {
    const list = groups();
    if (list.length === 0) return;
    const nextProvider = list[(selectedProviderIndex() + delta + list.length) % list.length];
    props.store.setHighlight(findFlatIndex(nextProvider.provider.id));
  };

  const onInputChange = (value: string) => {
    setQuery(value);
    props.store.setSearch(value);
  };

  const onKeyDown = (key: { name: string; shift?: boolean; preventDefault: () => void }) => {
    if (key.name === "escape") {
      key.preventDefault();
      props.store.close();
      return;
    }
    if (key.name === "return" || key.name === "kpenter") {
      key.preventDefault();
      props.store.select();
      return;
    }
    if (key.name === "up") {
      key.preventDefault();
      props.store.moveHighlight(-1);
      return;
    }
    if (key.name === "down") {
      key.preventDefault();
      props.store.moveHighlight(1);
      return;
    }
    if (key.name === "pageup") {
      key.preventDefault();
      props.store.setHighlight(highlight() - bodyRows());
      return;
    }
    if (key.name === "pagedown") {
      key.preventDefault();
      props.store.setHighlight(highlight() + bodyRows());
      return;
    }
    if (key.name === "left") {
      key.preventDefault();
      moveProvider(-1);
      return;
    }
    if (key.name === "right") {
      key.preventDefault();
      moveProvider(1);
      return;
    }
    if (key.name === "tab") {
      key.preventDefault();
      moveProvider(key.shift ? -1 : 1);
    }
  };

  const onProviderScroll = (event: MouseEvent) => {
    if (!event.scroll) return;
    moveProvider(event.scroll.direction === "up" ? -1 : 1);
  };

  const onModelScroll = (event: MouseEvent) => {
    if (!event.scroll) return;
    const page = Math.max(3, Math.floor(bodyRows() / 2));
    const direction = event.scroll.direction === "up" ? -1 : 1;
    props.store.moveHighlight(direction * page);
  };

  return (
    <Show when={props.store.isOpen()}>
      <box
        position="absolute"
        left={leftCol()}
        top={topRow()}
        width={overlayWidth()}
        height={overlayHeight()}
        backgroundColor={theme().panel}
        border
        borderColor={theme().primary}
        style={{ flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}
      >
        <box height={1} style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <text fg={theme().primary} wrapMode="none" truncate>
            <b>{props.store.t("tui.modelSelector.title")}</b>
          </text>
          <text fg={theme().muted} wrapMode="none" truncate>
            F2 / /model
          </text>
        </box>

        <box height={1} style={{ flexDirection: "row" }}>
          <text fg={theme().muted} wrapMode="none" truncate>
            {props.store.t("tui.modelSelector.current")}{" "}
          </text>
          <Show
            when={activeEntry()}
            fallback={<text fg={theme().dim} wrapMode="none" truncate>—</text>}
          >
            {(entry) => (
              <text fg={theme().text} wrapMode="none" truncate>
                <span style={{ fg: theme().secondary }}>{entry().providerName}</span>
                {" / "}
                {entry().modelName}
                <span style={{ fg: theme().dim }}> · {modelBadges(entry(), props.store)}</span>
              </text>
            )}
          </Show>
        </box>

        <box height={1} style={{ flexDirection: "column" }}>
          <textarea
            ref={(ref: TextareaRenderable) => {
              textareaRef = ref;
            }}
            initialValue={query()}
            placeholder={props.store.t("tui.modelSelector.search")}
            textColor={theme().text}
            focusedTextColor={theme().text}
            cursorColor={theme().secondary}
            focused
            height={1}
            keyBindings={[]}
            style={{ flexGrow: 1 }}
            onContentChange={() => {
              const value = textareaRef?.plainText ?? "";
              onInputChange(value);
            }}
            onKeyDown={onKeyDown}
          />
        </box>

        <box height={1} style={{ flexDirection: "row" }}>
          <text fg={theme().secondary} wrapMode="none" truncate>
            {props.store.t("tui.modelSelector.providers")}
          </text>
          <text fg={theme().dim} wrapMode="none" truncate>
            {" ".repeat(Math.max(1, providerColumnWidth() - props.store.t("tui.modelSelector.providers").length))}
          </text>
          <text fg={theme().secondary} wrapMode="none" truncate>
            {props.store.t("tui.modelSelector.models")}
          </text>
        </box>

        <box style={{ flexGrow: 1, flexDirection: "row" }}>
          <Show
            when={flatEntries().length > 0}
            fallback={
              <text fg={theme().warning} wrapMode="none">
                {props.store.t("tui.modelSelector.empty", { query: query() })}
              </text>
            }
          >
            <box
              width={providerColumnWidth()}
              style={{ flexDirection: "column", paddingRight: 1 }}
              ref={(el) => {
                el.onMouseScroll = onProviderScroll;
              }}
            >
              <For each={providerRows().items}>
                {(group, index) => {
                  const realIndex = createMemo(() => providerRows().start + index());
                  const isSelected = createMemo(() => realIndex() === selectedProviderIndex());
                  const isActive = createMemo(() => group.provider.id === props.store.activeProviderId());
                  return (
                    <box
                      height={1}
                      backgroundColor={isSelected() ? theme().border : undefined}
                      style={{ flexDirection: "row" }}
                      ref={(el) => {
                        el.onMouseDown = () => props.store.setHighlight(findFlatIndex(group.provider.id));
                      }}
                    >
                      <text fg={isSelected() ? theme().primary : theme().text} wrapMode="none" truncate>
                        <span style={{ fg: isSelected() ? theme().primary : theme().dim }}>
                          {isSelected() ? "›" : " "}
                        </span>{" "}
                        <span style={{ fg: isActive() ? theme().secondary : theme().text }}>{group.provider.name}</span>
                        {group.provider.custom ? ` ${props.store.t("tui.modelSelector.customBadge")}` : ""}
                      </text>
                    </box>
                  );
                }}
              </For>
            </box>

            <box
              width={modelColumnWidth()}
              style={{ flexDirection: "column", paddingLeft: 1 }}
              ref={(el) => {
                el.onMouseScroll = onModelScroll;
              }}
            >
              <For each={modelRows().items}>
                {(model) => {
                  const group = selectedGroup();
                  if (!group) return null;
                  const entryIndex = createMemo(() => findFlatIndex(group.provider.id, model.id));
                  const isHighlighted = createMemo(() => entryIndex() === highlight());
                  const isActive = createMemo(
                    () => group.provider.id === props.store.activeProviderId() && model.id === props.store.activeModelId(),
                  );
                  const entry = createMemo<ModelSelectorEntry>(() => ({
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
                  }));
                  return (
                    <box
                      height={1}
                      backgroundColor={isHighlighted() && model.selectable ? theme().border : undefined}
                      style={{ flexDirection: "row" }}
                      ref={(el) => {
                        el.onMouseDown = () => {
                          if (model.selectable) props.store.select(group.provider.id, model.id);
                        };
                      }}
                    >
                      <text
                        fg={
                          !model.selectable
                            ? theme().dim
                            : isHighlighted()
                              ? theme().primary
                              : isActive()
                                ? theme().secondary
                                : theme().text
                        }
                        wrapMode="none"
                        truncate
                      >
                        <span style={{ fg: isHighlighted() && model.selectable ? theme().primary : theme().dim }}>
                          {isHighlighted() ? "›" : " "}
                        </span>{" "}
                        <span style={{ fg: !model.selectable ? theme().dim : isActive() ? theme().secondary : theme().text }}>
                          {isActive() ? `${props.store.t("tui.modelSelector.activeMarker")} ` : ""}
                          {model.name}
                        </span>
                        <Show when={model.selectable}>
                          <span style={{ fg: theme().dim }}>{modelIdSuffix(entry())}</span>
                        </Show>
                        <span style={{ fg: theme().muted }}> · {modelBadges(entry(), props.store)}</span>
                      </text>
                    </box>
                  );
                }}
              </For>
            </box>
          </Show>
        </box>

        <box height={1} style={{ flexDirection: "row" }}>
          <text fg={theme().muted} wrapMode="none" truncate>
            {props.store.t("tui.modelSelector.hint")}
          </text>
        </box>
      </box>
    </Show>
  );
}
