/**
 * NotificationCenter — Phase 2.5 A2.
 *
 * Non-blocking overlay in the bottom-right corner of the terminal.
 * Shows up to 3 visible notifications with auto-dismiss timers.
 *
 * Layout: positioned as a column in the bottom-right area,
 * stacked vertically with newest at the bottom.
 */

import { For, Show } from "solid-js";
import type { TuiThemeName } from "../../../../application/public";
import { getTuiTheme } from "../lib/theme";
import type { Notification } from "../model/notification-store";
import { NotificationStore } from "../model/notification-store";
import { NotificationItem } from "./notification-item";

export interface NotificationCenterProps {
  store: NotificationStore;
  themeName: () => TuiThemeName;
}

export function NotificationCenter(props: NotificationCenterProps) {
  const visible = () => props.store.visible();
  const theme = () => getTuiTheme(props.themeName());

  return (
    <Show when={visible().length > 0}>
      <box
        style={{
          position: "absolute",
          bottom: 1,
          right: 1,
          flexDirection: "column-reverse",
        }}
        width={40}
        height={Math.max(3, visible().length * 4)}
        backgroundColor={theme().panel}
      >
        <For each={visible()}>
          {(notification: Notification) => (
            <box style={{ paddingBottom: 1 }}>
              <NotificationItem notification={notification} theme={theme()} />
            </box>
          )}
        </For>
      </box>
    </Show>
  );
}
