import type { ScrollBoxRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect } from "solid-js";
import { useAutoCopySelection } from "../hooks/use-auto-copy-selection";
import { useTuiKeys } from "../hooks/use-tui-keys";
import { getTuiTheme } from "../lib/theme";
import type { NotificationStore } from "../model/notification-store";
import type { ProviderStore } from "../model/provider-store";
import type { TuiStore } from "../model/tui-store";
import { Show } from "solid-js";
import { InputBar } from "./input-bar";
import { MessageList, type ToolResultFocusRef } from "./message-list";
import { ModelSelector } from "./model-selector";
import { NotificationCenter } from "./notification-center";
import { SearchOverlay } from "./search-overlay";
import { Sidebar } from "./sidebar";
import { StatusBar } from "./status-bar";
import { TrustDialog, TrustDialogManager } from "./trust-dialog";

export function TuiApp(props: {
  store: TuiStore;
  shutdown: () => void;
  providerStore?: ProviderStore;
  notificationStore?: NotificationStore;
}) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  let messageScrollbox: ScrollBoxRenderable | null = null;
  let toolFocusRef: ToolResultFocusRef | null = null;
  const theme = () => getTuiTheme(props.store.themeName());
  const trustDialogManager = new TrustDialogManager();

  // Wire scrollbox ref to store for search-result jump scrolling
  const setScrollboxRef = (ref: ScrollBoxRenderable) => {
    messageScrollbox = ref;
    props.store.setJumpScrollbox(ref);
  };
  useTuiKeys({
    store: props.store,
    providerStore: props.providerStore,
    notificationStore: props.notificationStore,
    getScrollbox: () => messageScrollbox,
    getToolFocus: () => toolFocusRef,
    shutdown: props.shutdown,
    renderer,
    trustDialogManager,
    openSearch: () => props.store.openSearch(),
  });
  useAutoCopySelection(renderer, () => props.store.notifyCopied());
  createEffect(() => renderer.setBackgroundColor(theme().background));

  const sidebarWidth = () => (dimensions().width >= 100 ? 28 : 20);
  const mainWidth = () =>
    props.store.sidebarCollapsed() ? dimensions().width : dimensions().width - sidebarWidth();

  return (
    <box width="100%" height="100%" backgroundColor={theme().background} style={{ flexDirection: "row" }}>
      <Show when={!props.store.sidebarCollapsed()}>
        <Sidebar store={props.store} width={sidebarWidth()} />
      </Show>
      <box style={{ flexDirection: "column", flexGrow: 1 }}>
        <box style={{ flexGrow: 1 }}>
          <MessageList
            messages={props.store.messages()}
            setRef={setScrollboxRef}
            store={props.store}
            onToolFocusReady={(ref) => (toolFocusRef = ref)}
          />
          {/* Trust dialog appears between message list and input bar in normal flow. */}
          <TrustDialog store={props.store} themeName={props.store.themeName} manager={trustDialogManager} />
          <InputBar store={props.store} />
        </box>
        <StatusBar store={props.store} width={mainWidth()} />
      </box>
      {props.providerStore ? (
        <ModelSelector
          store={props.providerStore}
          themeName={props.store.themeName}
          width={dimensions().width}
          height={dimensions().height}
        />
      ) : null}
      {props.notificationStore ? (
        <NotificationCenter store={props.notificationStore} themeName={props.store.themeName} />
      ) : null}
      <SearchOverlay
        messages={props.store.messages}
        themeName={props.store.themeName}
        width={dimensions().width}
        height={dimensions().height}
        isOpen={props.store.isSearchOpen}
        onClose={() => props.store.closeSearch()}
        onJumpTo={(idx) => props.store.jumpToMessage(idx)}
        placeholder={props.store.l("tui.search.placeholder")}
        title={props.store.l("tui.search.title")}
        emptyText={(q) => props.store.l("tui.search.empty", { query: q })}
        hintText={props.store.l("tui.search.hint")}
      />
    </box>
  );
}
