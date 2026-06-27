/**
 * SearchOverlay — Phase 2.5 B4.
 *
 * Overlay positioned at top-right showing a search input and results.
 * Follows the ModelSelector pattern: absolute-positioned box, textarea
 * for query input, For-loop for results, ↑/↓/Enter/Esc keyboard nav.
 */

import type { TextareaRenderable } from "@opentui/core";
import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js";
import type { TuiThemeName } from "../../../../core/config/types";
import { getTuiTheme } from "../lib/theme";
import { type SearchResult, searchMessages } from "../lib/search-engine";
import type { TuiMessage } from "../model/types";

const MAX_RESULTS = 50;
const OVERLAY_WIDTH = 64;
const MAX_HEIGHT = 24;
const MIN_HEIGHT = 8;
const DEBOUNCE_MS = 250;

export interface SearchOverlayProps {
  messages: () => TuiMessage[];
  themeName: () => TuiThemeName;
  width: number;
  height: number;
  isOpen: () => boolean;
  onClose: () => void;
  onJumpTo: (messageIndex: number) => void;
  placeholder: string;
  title: string;
  emptyText: (query: string) => string;
  hintText: string;
}

export function SearchOverlay(props: SearchOverlayProps) {
  const theme = () => getTuiTheme(props.themeName());
  const [query, setQuery] = createSignal("");
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  let textareaRef: TextareaRenderable | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Reset state when opening
  createEffect(() => {
    if (props.isOpen()) {
      setQuery("");
      setHighlightedIndex(0);
      queueMicrotask(() => {
        textareaRef?.focus();
      });
    }
  });

  // Debounced search
  const results = createMemo<SearchResult[]>(() => {
    const q = query().trim();
    if (q.length === 0) return [];
    const msgs = props.messages();
    return searchMessages(msgs, q).slice(0, MAX_RESULTS);
  });

  // Reset highlight when results change
  createEffect(() => {
    void results();
    setHighlightedIndex(0);
  });

  const overlayWidth = () => Math.min(OVERLAY_WIDTH, props.width - 4);
  const overlayHeight = () => {
    const resultCount = results().length;
    if (resultCount === 0) return MIN_HEIGHT;
    const contentRows = Math.min(resultCount, MAX_HEIGHT - 6);
    return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, contentRows + 6));
  };

  const leftCol = () => props.width - overlayWidth() - 2;
  const topRow = () => 1;

  const onInputChange = (value: string) => {
    setQuery(value);
    // Debounce search
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      // already recomputed via solid reactivity
    }, DEBOUNCE_MS);
  };

  const onKeyDown = (key: { name: string; preventDefault: () => void }) => {
    if (key.name === "escape") {
      key.preventDefault();
      props.onClose();
      return;
    }
    if (key.name === "return" || key.name === "kpenter") {
      key.preventDefault();
      const res = results();
      const idx = Math.min(highlightedIndex(), res.length - 1);
      if (idx >= 0 && res[idx]) {
        props.onJumpTo(res[idx].messageIndex);
        props.onClose();
      }
      return;
    }
    if (key.name === "up") {
      key.preventDefault();
      setHighlightedIndex(Math.max(0, highlightedIndex() - 1));
      return;
    }
    if (key.name === "down") {
      key.preventDefault();
      setHighlightedIndex(Math.min(results().length - 1, highlightedIndex() + 1));
      return;
    }
  };

  return (
    <Show when={props.isOpen()}>
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
        {/* Title bar */}
        <box height={1} style={{ flexDirection: "row" }}>
          <text fg={theme().primary} wrapMode="none" truncate>
            <b>{props.title}</b>
          </text>
        </box>

        {/* Search input */}
        <box height={3} style={{ flexDirection: "column" }}>
          <textarea
            ref={(ref: TextareaRenderable) => {
              textareaRef = ref;
            }}
            initialValue={query()}
            placeholder={props.placeholder}
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

        {/* Results */}
        <box style={{ flexGrow: 1, flexDirection: "column" }}>
          <Switch>
            <Match when={query().trim().length === 0}>
              {/* Empty state: no query yet */}
              <text fg={theme().muted} wrapMode="none">
                {props.hintText}
              </text>
            </Match>
            <Match when={results().length === 0}>
              {/* No results */}
              <text fg={theme().warning} wrapMode="none">
                {props.emptyText(query())}
              </text>
            </Match>
            <Match when={results().length > 0}>
              <For each={results()}>
                {(result, idx) => {
                  const isHighlighted = createMemo(() => idx() === highlightedIndex());
                  const labels = {
                    user: "◆",
                    assistant: "AI",
                    evidence: "EV",
                    reasoning: "🍜",
                    "tool-start": "⚙",
                    "tool-result": "📋",
                    "tool-end": "✓",
                    info: "ℹ",
                    success: "✓",
                    warning: "⚠",
                    error: "✗",
                  } as const;
                  const label = labels[result.message.type as keyof typeof labels] ?? "·";

                  return (
                    <text
                      fg={isHighlighted() ? theme().primary : theme().text}
                      wrapMode="none"
                      truncate
                    >
                      <span style={{ fg: isHighlighted() ? theme().primary : theme().secondary }}>
                        {isHighlighted() ? "▸" : " "}
                      </span>{" "}
                      <span style={{ fg: theme().muted }}>{label}</span>{" "}
                      <span style={isHighlighted() ? { fg: theme().text } : {}}>{result.preview}</span>
                    </text>
                  );
                }}
              </For>
            </Match>
          </Switch>
        </box>

        {/* Footer hint */}
        <box height={1} style={{ flexDirection: "row" }}>
          <text fg={theme().muted} wrapMode="none" truncate>
            {results().length > 0 ? props.hintText : ""}
          </text>
        </box>
      </box>
    </Show>
  );
}
