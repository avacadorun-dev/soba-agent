/**
 * ToolResultBlock — Phase 2.5 B2.
 *
 * Collapsible tool result panel that replaces the static ToolResultMessage.
 * Shows a summary header (tool icon + name, lines, size, duration) and
 * a collapsible body containing the full tool output.
 *
 * Behavior:
 *  - Collapsed by default (show summary only)
 *  - Error results auto-expand
 *  - Enter toggles expand/collapse (managed by parent MessageList)
 *  - Diff results (edit tool) render with +/- color highlighting
 */

import { Show, createMemo } from "solid-js";
import type { MouseEvent } from "@opentui/core";
import { BLOCK, getToolMeta } from "../lib/message-blocks";
import { getTuiTheme } from "../lib/theme";
import { buildToolOutputPreview } from "../lib/tool-output-preview";
import type { TuiMessage } from "../model/types";
import type { TuiStore } from "../model/tui-store";

type ToolResultMessage = Extract<TuiMessage, { type: "tool-result" }>;

/**
 * Format byte size as human-readable string.
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format duration in milliseconds.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Build a compact summary line for the collapsed state.
 */
function buildSummary(message: ToolResultMessage): { lines: number; bytes: number; label: string } {
  const lines = message.content ? message.content.split("\n").length : 0;
  const bytes = message.content ? new TextEncoder().encode(message.content).length : 0;

  const parts: string[] = [];
  if (lines > 0) parts.push(`${lines} ${lines === 1 ? "line" : "lines"}`);
  if (bytes > 0) parts.push(formatSize(bytes));

  return { lines, bytes, label: parts.join(" · ") };
}

const TOOL_RESULT_CLICK_DRAG_THRESHOLD = 0;

export function createToolResultMouseToggle(onToggle: () => void): {
  onMouseDown: (event: MouseEvent) => void;
  onMouseUp: (event: MouseEvent) => void;
  onMouseDrag: () => void;
  onMouseDragEnd: () => void;
} {
  let mouseDownPosition: { x: number; y: number } | null = null;
  let dragged = false;

  return {
    onMouseDown: (event) => {
      mouseDownPosition = { x: event.x, y: event.y };
      dragged = false;
    },
    onMouseUp: (event) => {
      if (!mouseDownPosition) return;
      const delta =
        Math.abs(event.x - mouseDownPosition.x) +
        Math.abs(event.y - mouseDownPosition.y);
      const shouldToggle = !dragged && delta <= TOOL_RESULT_CLICK_DRAG_THRESHOLD;
      mouseDownPosition = null;
      dragged = false;
      if (shouldToggle) onToggle();
    },
    onMouseDrag: () => {
      dragged = true;
    },
    onMouseDragEnd: () => {
      dragged = true;
    },
  };
}

/**
 * Render a line of tool output with diff highlighting for edit results.
 */
function OutputLine(props: { line: string; isDiff: boolean; isError: boolean; theme: ReturnType<typeof getTuiTheme> }) {
  const prefix = props.isError ? "✖ " : "  ";

  if (props.isDiff) {
    if (props.line.startsWith("+")) {
      return (
        <text fg={props.theme.success} wrapMode="none">
          {prefix}
          {props.line}
        </text>
      );
    }
    if (props.line.startsWith("-")) {
      return (
        <text fg={props.theme.error} wrapMode="none">
          {prefix}
          {props.line}
        </text>
      );
    }
    if (props.line.startsWith("@@")) {
      return (
        <text fg={props.theme.secondary} wrapMode="none">
          {prefix}
          {props.line}
        </text>
      );
    }
  }

  return (
    <text fg={props.isError ? props.theme.error : props.theme.muted} wrapMode="none">
      {prefix}
      {props.line}
    </text>
  );
}

export function ToolResultBlock(props: {
  message: ToolResultMessage;
  store: TuiStore;
  expanded: boolean;
  focused: boolean;
  onToggle: () => void;
}) {
  const theme = () => getTuiTheme(props.store.themeName());
  const meta = () => getToolMeta(props.message.toolName);

  const summary = createMemo(() => buildSummary(props.message));
  const preview = createMemo(() => buildToolOutputPreview(props.message.content || ""));
  const details = createMemo(() => props.message.details ?? []);
  const mouseToggle = createToolResultMouseToggle(props.onToggle);

  return (
    <box
      width="100%"
      backgroundColor={theme().panel}
      borderStyle={BLOCK.borderStyle}
      border={["left"]}
      borderColor={
        props.focused ? theme().primary : props.message.isError ? theme().error : theme()[meta().color]
      }
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
            <span style={{ fg: props.focused ? theme().primary : theme()[meta().color] }}>{meta().icon}</span>
            <span style={{ fg: theme().muted }}>
              {" "}
              {props.message.summary || (props.message.toolName + " · " + summary().label)}
            </span>
            <Show when={props.message.durationMs !== undefined}>
              <span style={{ fg: theme().dim }}> · {formatDuration(props.message.durationMs!)}</span>
            </Show>
          </text>
        </box>
        <box>
          <text fg={props.focused ? theme().primary : theme().dim} wrapMode="none">
            {props.expanded ? "▾ collapsed" : "▸ expand"}
          </text>
        </box>
      </box>

      {/* Divider + body: visible when expanded */}
      <Show when={props.expanded}>
        <text fg={theme().border} wrapMode="none">
          {props.store.l("tui.tool.resultSeparator")}
        </text>
        <Show when={details().length > 0}>
          {details().map((line) => (
            <text fg={theme().secondary} wrapMode="word">
              {line}
            </text>
          ))}
          <text fg={theme().border} wrapMode="none">
            {props.store.l("tui.tool.resultSeparator")}
          </text>
        </Show>
        <Show when={preview().hadUnsafeControlChars}>
          <text fg={theme().warning} wrapMode="none" truncate>
            Unsafe terminal control characters were escaped for TUI preview.
          </text>
        </Show>
        {preview().lines.map((line) => (
          <OutputLine
            line={line}
            isDiff={props.message.isDiff}
            isError={props.message.isError}
            theme={theme()}
          />
        ))}
        <Show when={preview().omittedLines > 0}>
          <text fg={theme().dim} wrapMode="none" truncate>
            Preview limited to {preview().lines.length} of {preview().totalLines} lines.
          </text>
        </Show>
      </Show>
    </box>
  );
}
