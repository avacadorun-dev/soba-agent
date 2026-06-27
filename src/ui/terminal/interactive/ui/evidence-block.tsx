import { Show, createMemo } from "solid-js";
import { BLOCK } from "../lib/message-blocks";
import { getTuiTheme } from "../lib/theme";
import type { TuiStore } from "../model/tui-store";
import type { TuiMessage } from "../model/types";

type EvidenceMessage = Extract<TuiMessage, { type: "evidence" }>;

function compactCount(label: string, count: number): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function EvidenceSection(props: {
  title: string;
  items: string[];
  color: string;
}) {
  return (
    <Show when={props.items.length > 0}>
      <box style={{ flexDirection: "column", gap: BLOCK.gap }}>
        <text fg={props.color} wrapMode="none">
          {props.title}
        </text>
        {props.items.map((item) => (
          <text fg={props.color} wrapMode="word">
            {"  - "}
            {item}
          </text>
        ))}
      </box>
    </Show>
  );
}

export function EvidenceBlock(props: {
  message: EvidenceMessage;
  store: TuiStore;
  expanded: boolean;
  focused: boolean;
  onToggle: () => void;
}) {
  const theme = () => getTuiTheme(props.store.themeName());
  const summary = createMemo(() => props.message.summary);
  const compact = createMemo(() => {
    const parts: string[] = [];
    if (summary().changedFiles.length > 0) parts.push(compactCount("file", summary().changedFiles.length));
    if (summary().checks.length > 0) parts.push(compactCount("check", summary().checks.length));
    if (summary().risks.length > 0) parts.push(compactCount("risk", summary().risks.length));
    if (summary().reviewActions.length > 0) parts.push(compactCount("review action", summary().reviewActions.length));
    return parts.join(" / ");
  });

  return (
    <box
      width="100%"
      backgroundColor={theme().panel}
      borderStyle={BLOCK.borderStyle}
      border={["left"]}
      borderColor={props.focused ? theme().primary : theme().secondary}
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
        el.onMouseUp = () => props.onToggle();
      }}
    >
      <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <text wrapMode="none" truncate>
          <span style={{ fg: props.focused ? theme().primary : theme().secondary }}>E</span>
          <span style={{ fg: theme().muted }}> Evidence</span>
          <Show when={summary().status}>
            <span style={{ fg: theme().text }}> · {summary().status}</span>
          </Show>
          <Show when={compact().length > 0}>
            <span style={{ fg: theme().dim }}> · {compact()}</span>
          </Show>
        </text>
        <text fg={props.focused ? theme().primary : theme().dim} wrapMode="none">
          {props.expanded ? "expanded" : "collapsed"}
        </text>
      </box>

      <Show when={props.expanded}>
        <Show when={summary().diff}>
          <text fg={theme().muted} wrapMode="word">
            Diff: {summary().diff}
          </text>
        </Show>
        <EvidenceSection title="Changed files" items={summary().changedFiles} color={theme().text} />
        <EvidenceSection title="Checks" items={summary().checks} color={theme().success} />
        <EvidenceSection title="Risks" items={summary().risks} color={summary().risks.length > 0 ? theme().warning : theme().muted} />
        <EvidenceSection title="Review actions" items={summary().reviewActions} color={theme().secondary} />
      </Show>
    </box>
  );
}
