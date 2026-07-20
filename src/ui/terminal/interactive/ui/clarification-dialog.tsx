import type { BoxRenderable } from "@opentui/core";
import { For, Show, createEffect } from "solid-js";
import type { TuiThemeName } from "../../../../application/ui/public";
import type { ClarificationDialogManager } from "../lib/clarification-dialog-manager";
import { getTuiTheme } from "../lib/theme";
import type { TuiStore } from "../model/tui-store";

export function ClarificationDialog(props: {
  store: TuiStore;
  themeName: () => TuiThemeName;
  manager: ClarificationDialogManager;
}) {
  const theme = () => getTuiTheme(props.themeName());
  const clarification = () => props.store.clarification();

  createEffect(() => {
    const request = clarification()?.request;
    if (request) props.manager.reset(request.options.length);
  });

  return (
    <Show when={clarification()}>
      {(event) => (
        <box
          backgroundColor={theme().panel}
          border
          borderColor={theme().primary}
          style={{
            flexDirection: "column",
            paddingLeft: 2,
            paddingRight: 2,
            paddingTop: 1,
            paddingBottom: 1,
            flexShrink: 0,
          }}
        >
          <text fg={theme().primary} wrapMode="word">
            <b>{event().request.question}</b>
          </text>
          <box height={1} />
          <For each={event().request.options}>
            {(option, index) => {
              const selected = () => props.manager.highlightedIndex() === index();
              return (
                <box
                  height={option.description ? 2 : 1}
                  style={{ flexDirection: "column", paddingLeft: 1 }}
                  ref={(element: BoxRenderable) => {
                    element.onMouseOver = () => props.manager.setHighlight(index());
                    element.onMouseDown = () => props.store.answerClarification(option.id);
                  }}
                >
                  <text fg={selected() ? theme().primary : theme().text} wrapMode="none" truncate>
                    {selected() ? "▶" : " "} {index() + 1}. {selected() ? <b>{option.label}</b> : option.label}
                  </text>
                  <Show when={option.description}>
                    <text fg={theme().muted} wrapMode="none" truncate>
                      {"    "}{option.description}
                    </text>
                  </Show>
                </box>
              );
            }}
          </For>
          <box height={1} />
          <text fg={theme().muted} wrapMode="none" truncate>
            {props.store.l(event().request.allowOther ? "tui.clarification.hintOther" : "tui.clarification.hint")}
          </text>
        </box>
      )}
    </Show>
  );
}
