/**
 * ReasoningBlock — collapsible agent thought panel.
 *
 * Mirrors the ToolResultBlock UX for agent thoughts / reasoning chunks:
 *  - While the thought is streaming it renders the live text expanded.
 *  - Short completed thoughts render expanded (no toggle chrome).
 *  - Long completed thoughts render collapsed by default with a compact
 *    header (🍜 reasoning · preview · expand indicator) and a toggle body.
 *  - Click (and the shared keyboard focus handler) toggles expand/collapse.
 *
 * The collapse decision lives in lib/reasoning-collapse so it can be tested
 * without rendering. The mouse toggle helper is reused from ToolResultBlock
 * to keep the interaction identical to tool entries.
 */

import { Show, createMemo } from "solid-js";
import { BLOCK } from "../lib/message-blocks";
import { buildReasoningPreview, isReasoningCollapsible } from "../lib/reasoning-collapse";
import { getTuiTheme } from "../lib/theme";
import type { TuiMessage } from "../model/types";
import type { TuiStore } from "../model/tui-store";
import { createToolResultMouseToggle } from "./tool-result-block";

type ReasoningMessage = Extract<TuiMessage, { type: "reasoning" }>;

export function ReasoningBlock(props: {
  message: ReasoningMessage;
  store: TuiStore;
  expanded: boolean;
  focused: boolean;
  onToggle: () => void;
}) {
  const theme = () => getTuiTheme(props.store.themeName());
  const collapsible = createMemo(() => isReasoningCollapsible(props.message));
  const preview = createMemo(() => buildReasoningPreview(props.message.content || ""));

  // Streaming and short completed thoughts render as a plain expanded row,
  // preserving the original inline reasoning experience.
  if (!collapsible()) {
    return (
      <box style={{ marginBottom: BLOCK.marginBottom }}>
        <text wrapMode="word">
          <span style={{ fg: theme().muted }}>🍜 </span>
          <span style={{ fg: theme().muted }}>
            <i>{props.message.content}</i>
          </span>
        </text>
      </box>
    );
  }

  const mouseToggle = createToolResultMouseToggle(props.onToggle);

  return (
    <box
      width="100%"
      backgroundColor={theme().panel}
      borderStyle={BLOCK.borderStyle}
      border={["left"]}
      borderColor={props.focused ? theme().primary : theme().muted}
      style={{
        flexDirection: "column",
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 1,
        paddingBottom: 1,
        marginBottom: BLOCK.marginBottom,
        gap: BLOCK.gap,
      }}
      ref={(el) => {
        el.onMouseDown = mouseToggle.onMouseDown;
        el.onMouseUp = mouseToggle.onMouseUp;
        el.onMouseDrag = mouseToggle.onMouseDrag;
        el.onMouseDragEnd = mouseToggle.onMouseDragEnd;
      }}
    >
      {/* Summary header: always visible */}
      <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <box style={{ flexDirection: "row" }}>
          <text wrapMode="none" truncate>
            <span style={{ fg: props.focused ? theme().primary : theme().muted }}>🍜 </span>
            <span style={{ fg: theme().muted }}>
              {" "}
              {props.store.l("tui.reasoning")}
              <Show when={preview().length > 0}>
                <span style={{ fg: theme().dim }}> · </span>
                <i>{preview()}</i>
              </Show>
            </span>
          </text>
        </box>
        <box>
          <text fg={props.focused ? theme().primary : theme().dim} wrapMode="none">
            {props.expanded ? "▾ collapsed" : "▸ expand"}
          </text>
        </box>
      </box>

      {/* Body: visible when expanded */}
      <Show when={props.expanded}>
        <text fg={theme().border} wrapMode="none">
          {props.store.l("tui.tool.resultSeparator")}
        </text>
        <text wrapMode="word">
          <span style={{ fg: theme().muted }}>
            <i>{props.message.content}</i>
          </span>
        </text>
      </Show>
    </box>
  );
}
