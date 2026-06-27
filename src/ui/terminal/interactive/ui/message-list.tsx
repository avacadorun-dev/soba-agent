import type { ScrollBoxRenderable } from "@opentui/core";
import { For, Match, Show, Switch, batch, createMemo, createSignal } from "solid-js";
import { BLOCK } from "../lib/message-blocks";
import { getMarkdownStyle, getTuiTheme } from "../lib/theme";
import { computeTurnMap, computeTurnStarts, isTurnStart as checkTurnStart } from "../lib/turn-grouping";
import type { TuiStore } from "../model/tui-store";
import type { TuiMessage } from "../model/types";
import { ToolResultBlock } from "./tool-result-block";
import { TurnSeparator } from "./turn-separator";

/**
 * Callback interface for keyboard-driven tool-result focus.
 * The parent wires these to Enter / Tab / Shift+Tab.
 */
export interface ToolResultFocusRef {
  toggleFocused: () => void;
  focusNext: () => void;
  focusPrev: () => void;
  isFocused: () => boolean;
  defocus: () => void;
}

function UserMessage(props: { content: string; store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());
  return (
    <box style={{ marginBottom: BLOCK.marginBottom }}>
      <text wrapMode="word">
        <span style={{ fg: theme().secondary }}>◆ </span>
        <span style={{ fg: theme().text }}>{props.content}</span>
      </text>
    </box>
  );
}

function AssistantMessage(props: { message: Extract<TuiMessage, { type: "assistant" }>; store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());
  const hasContent = () => props.message.content.trim().length > 0;
  return (
    <Show when={hasContent()}>
      <box style={{ marginBottom: BLOCK.marginBottom }}>
        <Switch>
          <Match when={props.message.streaming}>
            <text fg={theme().text}>{props.message.content}</text>
          </Match>
          <Match when={!props.message.streaming}>
            <markdown
              content={props.message.content}
              streaming={false}
              syntaxStyle={getMarkdownStyle(props.store.themeName())}
              fg={theme().text}
              conceal
              internalBlockMode="top-level"
            />
          </Match>
        </Switch>
      </box>
    </Show>
  );
}

function ReasoningMessage(props: { content: string; store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());
  return (
    <box style={{ marginBottom: BLOCK.marginBottom }}>
      <text wrapMode="word">
        <span style={{ fg: theme().muted }}>🍜 </span>
        <span style={{ fg: theme().muted }}>
          <i>{props.content}</i>
        </span>
      </text>
    </box>
  );
}

function NarrationMessage(props: { message: Extract<TuiMessage, { type: "narration" }>; store: TuiStore }) {
  const theme = () => getTuiTheme(props.store.themeName());
  return (
    <box style={{ marginBottom: BLOCK.marginBottom }}>
      <text wrapMode="word">
        <span style={{ fg: theme().secondary }}>• </span>
        <span style={{ fg: theme().muted }}>{props.message.content}</span>
      </text>
    </box>
  );
}

function InlineMessage(props: {
  message: Extract<TuiMessage, { type: "info" | "success" | "warning" | "error" }>;
  store: TuiStore;
}) {
  const theme = () => getTuiTheme(props.store.themeName());
  const colors = {
    info: theme().muted,
    success: theme().success,
    warning: theme().warning,
    error: theme().error,
  } as const;
  return (
    <box style={{ marginBottom: BLOCK.marginBottom }}>
      <text fg={colors[props.message.type]}>{props.message.content}</text>
    </box>
  );
}

/**
 * Individual message renderer. Delegates to the appropriate
 * sub-component based on message type.
 */
function Message(props: {
  message: TuiMessage;
  store: TuiStore;
  expanded: boolean;
  focused: boolean;
  onToggle: () => void;
}) {
  return (
    <Switch>
      <Match when={props.message.type === "user" && props.message}>
        {(message) => <UserMessage content={message().content} store={props.store} />}
      </Match>
      <Match when={props.message.type === "assistant" && props.message}>
        {(message) => <AssistantMessage message={message()} store={props.store} />}
      </Match>
      <Match when={props.message.type === "reasoning" && props.message}>
        {(message) => <ReasoningMessage content={message().content} store={props.store} />}
      </Match>
      <Match when={props.message.type === "narration" && props.message}>
        {(message) => <NarrationMessage message={message()} store={props.store} />}
      </Match>
      <Match when={props.message.type === "tool-start" && props.message}>
        {/* Tool-start is now rendered as part of ToolResultBlock — hide standalone block */}
        <></>
      </Match>
      <Match when={props.message.type === "tool-result" && props.message}>
        {(message) => (
          <ToolResultBlock
            message={message()}
            store={props.store}
            expanded={props.expanded}
            focused={props.focused}
            onToggle={props.onToggle}
          />
        )}
      </Match>
      <Match when={props.message.type === "tool-end" && props.message}>
        {/* Tool-end is now rendered as part of ToolResultBlock — hide standalone block */}
        <></>
      </Match>
      <Match when={props.message.type === "info" && props.message}>
        {(message) => <InlineMessage message={message()} store={props.store} />}
      </Match>
      <Match when={props.message.type === "success" && props.message}>
        {(message) => <InlineMessage message={message()} store={props.store} />}
      </Match>
      <Match when={props.message.type === "warning" && props.message}>
        {(message) => <InlineMessage message={message()} store={props.store} />}
      </Match>
      <Match when={props.message.type === "error" && props.message}>
        {(message) => <InlineMessage message={message()} store={props.store} />}
      </Match>
    </Switch>
  );
}

export function MessageList(props: {
  messages: TuiMessage[];
  setRef: (ref: ScrollBoxRenderable) => void;
  store: TuiStore;
  onToolFocusReady?: (ref: ToolResultFocusRef) => void;
}) {
  const theme = () => getTuiTheme(props.store.themeName());
  const highlightedIndex = () => props.store.highlightedMessageIndex();

  // Track expanded tool-results by message ID
  const [expandedIds, setExpandedIds] = createSignal(new Set<number>());
  // Index in messages array of the currently focused tool-result (-1 = none)
  const [focusedIndex, setFocusedIndex] = createSignal(-1);

  // === Turn grouping (Phase 2.5 B3) ===
  // Track collapsed turns by turn index (0-based)
  const [collapsedTurns, setCollapsedTurns] = createSignal(new Set<number>());

  // Compute turn boundaries: array of start indices for each turn
  // A turn starts at each user message.
  const turnStarts = createMemo(() => computeTurnStarts(props.messages));

  // For each message index, return the turn index it belongs to (-1 if before first turn)
  const turnForIndex = createMemo(() => computeTurnMap(turnStarts(), props.messages.length));

  // Derived list of message indices that are tool-result messages
  const toolResultIndices = createMemo(() => {
    const indices: number[] = [];
    const msgs = props.messages;
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].type === "tool-result") {
        indices.push(i);
      }
    }
    return indices;
  });

  // Auto-expand error results and clean up removed messages
  createMemo(() => {
    const msgs = props.messages;
    const currentExpanded = expandedIds();

    // Expand any new error messages that aren't yet in the set
    let changed = false;
    const newExpanded = new Set(currentExpanded);
    for (const msg of msgs) {
      if (msg.type === "tool-result" && msg.isError && !newExpanded.has(msg.id)) {
        newExpanded.add(msg.id);
        changed = true;
      }
    }
    if (changed) {
      setExpandedIds(newExpanded);
    }
  });

  // Expose focus callbacks for the keyboard handler
  const focusRef: ToolResultFocusRef = {
    isFocused: () => focusedIndex() >= 0,
    defocus: () => {
      setFocusedIndex(-1);
      props.store.setActiveUiPane("input");
    },
    toggleFocused: () => {
      const fi = focusedIndex();
      if (fi < 0) return;
      const msg = props.messages[fi];
      if (msg?.type === "tool-result") {
        batch(() => {
          const current = expandedIds();
          const next = new Set(current);
          if (next.has(msg.id)) {
            next.delete(msg.id);
          } else {
            next.add(msg.id);
          }
          setExpandedIds(next);
        });
      }
    },
    focusNext: () => {
      const indices = toolResultIndices();
      if (indices.length === 0) return;
      const current = focusedIndex();
      const currentPos = indices.indexOf(current);
      const nextPos = currentPos < 0 ? 0 : (currentPos + 1) % indices.length;
      setFocusedIndex(indices[nextPos]);
      props.store.setActiveUiPane("output");
    },
    focusPrev: () => {
      const indices = toolResultIndices();
      if (indices.length === 0) return;
      const current = focusedIndex();
      const currentPos = indices.indexOf(current);
      const prevPos = currentPos <= 0 ? indices.length - 1 : currentPos - 1;
      setFocusedIndex(indices[prevPos]);
      props.store.setActiveUiPane("output");
    },
  };

  // Register the focus ref with the parent
  if (props.onToolFocusReady) {
    props.onToolFocusReady(focusRef);
  }

  return (
    <scrollbox
      ref={props.setRef}
      stickyScroll
      stickyStart="bottom"
      style={{
        flexGrow: 1,
        rootOptions: { border: ["bottom"], borderColor: theme().border, backgroundColor: theme().background },
        contentOptions: { paddingLeft: 2, paddingRight: 2, paddingTop: 1 },
        scrollbarOptions: {
          showArrows: true,
          trackOptions: { foregroundColor: theme().secondary, backgroundColor: theme().panel },
        },
      }}
    >
      <For each={props.messages}>
        {(message, index) => {
          const i = index();

          // Check if this message starts a turn — render separator before it
          const turnIdx = turnForIndex()[i];
          const starts = turnStarts();
          const isTurnStart = checkTurnStart(i, starts);
          const turnCollapsed = turnIdx >= 0 && collapsedTurns().has(turnIdx);

          // Skip non-start messages of collapsed turns
          if (turnCollapsed && !isTurnStart) {
            return <></>;
          }

          const onTurnToggle = () => {
            if (turnIdx < 0) return;
            batch(() => {
              const current = collapsedTurns();
              const next = new Set(current);
              if (next.has(turnIdx)) {
                next.delete(turnIdx);
              } else {
                next.add(turnIdx);
              }
              setCollapsedTurns(next);
            });
          };

          const turnSeparator = isTurnStart ? (
            <TurnSeparator
              turnNumber={turnIdx + 1}
              colorIndex={turnIdx}
              collapsed={turnCollapsed}
              onToggle={onTurnToggle}
              store={props.store}
            />
          ) : null;

          // When turn is collapsed, only show the separator (not the message)
          if (turnCollapsed) {
            return <>{turnSeparator}</>;
          }

          const isHighlighted = () => highlightedIndex() === i;
          const isExpanded = () => message.type === "tool-result" && expandedIds().has(message.id);
          const isFocused = () => {
            const fi = focusedIndex();
            if (fi < 0) return false;
            return props.messages[fi]?.id === message.id;
          };
          const onToggle = () => {
            if (message.type !== "tool-result") return;
            batch(() => {
              const current = expandedIds();
              const next = new Set(current);
              if (next.has(message.id)) {
                next.delete(message.id);
              } else {
                next.add(message.id);
              }
              setExpandedIds(next);
              // Also set focus to this tool-result
              const idx = props.messages.indexOf(message);
              if (idx >= 0) setFocusedIndex(idx);
              props.store.setActiveUiPane("output");
            });
          };
          return (
            <>
              {turnSeparator}
              <box
                style={{
                  backgroundColor: isHighlighted() ? theme().primary : undefined,
                }}
              >
                <Message
                  message={message}
                  store={props.store}
                  expanded={isExpanded()}
                  focused={isFocused()}
                  onToggle={onToggle}
                />
              </box>
            </>
          );
        }}
      </For>
    </scrollbox>
  );
}
