import { type CliRenderer, createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { getTuiTheme } from "./lib/theme";
import { setNotificationStore } from "./lib/notification";
import { NotificationStore } from "./model/notification-store";
import type { ProviderStore } from "./model/provider-store";
import { TuiStore } from "./model/tui-store";
import type { InteractiveTUIOptions } from "./model/types";
import { TuiApp } from "./ui/tui-app";

export type { InteractiveTUIOptions } from "./model/types";

export class InteractiveTUI {
  private readonly store: TuiStore;
  private readonly providerStore?: ProviderStore;
  private readonly notificationStore: NotificationStore;
  private renderer: CliRenderer | null = null;
  private shutdownRequested = false;

  constructor(options: InteractiveTUIOptions & { providerStore?: ProviderStore }) {
    this.notificationStore = new NotificationStore({ i18n: options.i18n });
    const optsWithNotifications: InteractiveTUIOptions = {
      ...options,
      notificationStore: this.notificationStore,
      clientProxy: options.providerStore?.proxy,
    };
    this.store = new TuiStore(optsWithNotifications, () => this.shutdown());
    this.providerStore = options.providerStore;
    this.providerStore?.setNotificationStore(this.notificationStore);
    setNotificationStore(this.notificationStore);
  }

  async run(): Promise<void> {
    this.renderer = await createCliRenderer({
      screenMode: "alternate-screen",
      backgroundColor: getTuiTheme(this.store.themeName()).background,
      exitOnCtrlC: false,
      useMouse: true,
      autoFocus: true,
      clearOnShutdown: true,
    });
    await render(
      () => (
        <TuiApp
          store={this.store}
          shutdown={() => this.shutdown()}
          providerStore={this.providerStore}
          notificationStore={this.notificationStore}
        />
      ),
      this.renderer,
    );
    while (!this.shutdownRequested) await Bun.sleep(100);
  }

  onAgentEvent(event: Parameters<TuiStore["onAgentEvent"]>[0]): void {
    this.store.onAgentEvent(event);
  }

  shutdown(): void {
    if (this.shutdownRequested) return;
    this.shutdownRequested = true;
    this.providerStore?.dispose();
    this.notificationStore.dispose();
    this.store.dispose();
    this.renderer?.destroy();
  }
}
