/**
 * ModelSelector — Phase 2.5 B1a.
 *
 * Centred overlay listing every provider/model from the ProviderStore. The
 * overlay is rendered conditionally (only when the store reports isOpen());
 * when closed it is unmounted and contributes no layout. Keyboard handling
 * for ↑/↓/Enter/Esc is handled inside the textarea; opening is the caller's
 * responsibility (e.g. useTuiKeys wires Ctrl+M).
 *
 * The component is fully read/write against the store; it never touches the
 * ProviderRegistry directly so the same component can be reused from
 * future slash-command flows.
 */

import type { TextareaRenderable } from "@opentui/core";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { TuiThemeName } from "../../../core/config/types";
import { formatTokens } from "../lib/format-tool";
import { getTuiTheme } from "../lib/theme";
import type { ModelGroup, ModelSelectorEntry, ProviderStore } from "../model/provider-store";

const MAX_HEIGHT = 30;
const MIN_WIDTH = 60;
const MAX_WIDTH = 80;

export function ModelSelector(props: {
  store: ProviderStore;
  themeName: () => TuiThemeName;
  width: number;
  height: number;
}) {
  const theme = () => getTuiTheme(props.themeName());
  const [query, setQuery] = createSignal(props.store.searchQuery());
  let textareaRef: TextareaRenderable | null = null;

  // Keep the local input signal in sync with the store (e.g. when reopened).
  createEffect(() => {
    if (props.store.isOpen()) {
      setQuery("");
      props.store.setSearch("");
      // Defer focus to the next tick so the textarea is mounted.
      queueMicrotask(() => {
        textareaRef?.focus();
      });
    }
  });

  const groups = createMemo<ModelGroup[]>(() => props.store.filteredGroups());
  const flatEntries = createMemo<ModelSelectorEntry[]>(() => props.store.flatEntries());
  const highlight = createMemo<number>(() => props.store.highlightedIndex());
  const activeProviderId = createMemo<string>(() => props.store.activeProviderId());
  const activeModelId = createMemo<string>(() => props.store.activeModelId());

  const overlayWidth = () => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(props.width * 0.8)));

  const overlayHeight = () => {
    const visibleModels = flatEntries().length;
    const groupsCount = groups().length;
    const contentRows = Math.min(visibleModels + groupsCount, MAX_HEIGHT - 6);
    return Math.max(8, Math.min(MAX_HEIGHT, contentRows + 6));
  };

  const leftCol = () => Math.max(0, Math.floor((props.width - overlayWidth()) / 2));
  const topRow = () => Math.max(0, Math.floor((props.height - overlayHeight()) / 2));

  const onInputChange = (value: string) => {
    setQuery(value);
    props.store.setSearch(value);
  };

  const onKeyDown = (key: { name: string; preventDefault: () => void }) => {
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
        <box height={1} style={{ flexDirection: "row" }}>
          <text fg={theme().primary} wrapMode="none" truncate>
            <b>{props.store.t("tui.modelSelector.title")}</b>
          </text>
        </box>
        <box height={3} style={{ flexDirection: "column" }}>
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
            height={3}
            keyBindings={[]}
            style={{ flexGrow: 1 }}
            onContentChange={() => {
              const value = textareaRef?.plainText ?? "";
              onInputChange(value);
            }}
            onKeyDown={onKeyDown}
          />
        </box>
        <box style={{ flexGrow: 1, flexDirection: "column" }}>
          <Show
            when={flatEntries().length > 0}
            fallback={
              <text fg={theme().muted} wrapMode="none">
                {props.store.t("tui.modelSelector.empty", { query: query() })}
              </text>
            }
          >
            <For each={groups()}>
              {(group) => (
                <box style={{ flexDirection: "column" }}>
                  <text fg={theme().secondary} wrapMode="none" truncate>
                    ▼ {group.provider.name}
                    {group.provider.custom ? ` ${props.store.t("tui.modelSelector.customBadge")}` : ""}
                    {group.provider.id === activeProviderId() ? " ●" : ""}
                  </text>
                  <For each={group.models}>
                    {(model) => {
                      const flatIndex = createMemo<number>(() => {
                        const list = flatEntries();
                        for (let i = 0; i < list.length; i++) {
                          if (list[i].providerId === group.provider.id && list[i].modelId === model.id) return i;
                        }
                        return -1;
                      });
                      const isHighlighted = createMemo<boolean>(() => flatIndex() === highlight());
                      const isActive = createMemo<boolean>(
                        () => group.provider.id === activeProviderId() && model.id === activeModelId(),
                      );
                      return (
                        <text
                          fg={isHighlighted() ? theme().primary : isActive() ? theme().secondary : theme().text}
                          wrapMode="none"
                          truncate
                        >
                          {isActive() ? "● " : "  "}
                          <span style={{ fg: theme().muted }}>{group.provider.name} › </span>
                          {model.name}
                          {"  ("}
                          {props.store.t("tui.modelSelector.contextShort", {
                            tokens: formatTokens(model.contextWindow),
                          })}
                          {")"}
                        </text>
                      );
                    }}
                  </For>
                </box>
              )}
            </For>
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
