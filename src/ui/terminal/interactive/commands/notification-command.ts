/**
 * /notifications command — Phase 2.5 A2/A4.
 *
 * Registered in the SlashCommandRegistry so it's dispatched
 * through the unified command routing.
 */

import type { TranslationKey } from "../../../../core/i18n/types";
import type { NotificationStore } from "../model/notification-store";
import type { TuiMessageInput } from "../model/types";
import { notificationIcon } from "../ui/notification-item";
import { slashCommandRegistry } from "./registry";
import type { SlashCommand, SlashCommandContext } from "./types";

export interface NotificationCommandDeps {
  store: NotificationStore;
}

/**
 * Create the /notifications slash command bound to a notification store.
 */
export function createNotificationsCommand(deps: NotificationCommandDeps): SlashCommand {
  return {
    name: "notifications",
    description: deps.store.t("tui.notifications.commandDescription"),
    handler: (_args, ctx) => {
      const history = deps.store.history();
      const visible = deps.store.visible();

      if (history.length === 0 && visible.length === 0) {
        ctx.addMessage?.({
          type: "info",
          content: deps.store.t("tui.notifications.empty"),
        });
        return { handled: true };
      }

      ctx.addMessage?.({
        type: "info",
        content: deps.store.t("tui.notifications.title"),
      });

      // Show visible notifications first
      for (const n of visible) {
        const icon = notificationIcon(n.type);
        const age = formatAge(Date.now() - n.timestamp, deps.store.t.bind(deps.store));
        ctx.addMessage?.({
          type: n.type,
          content: `${icon} [${deps.store.t("tui.notifications.active")}] ${n.title}\n   ${n.message}\n   ${age}`,
        });
      }

      // Show history (capped at last 20)
      const recentHistory = history.slice(0, 20);
      for (const n of recentHistory) {
        const icon = notificationIcon(n.type);
        const age = formatAge(Date.now() - n.timestamp, deps.store.t.bind(deps.store));
        ctx.addMessage?.({
          type: n.type,
          content: `${icon} ${n.title}\n   ${n.message}\n   ${age}`,
        });
      }

      if (history.length > 20) {
        ctx.addMessage?.({
          type: "info",
          content: deps.store.t("tui.notifications.more", { count: history.length - 20 }),
        });
      }

      return { handled: true };
    },
  };
}

/**
 * Register /notifications in the global registry.
 * Called once during TUI initialization.
 */
export function registerNotificationsCommand(deps: NotificationCommandDeps): void {
  slashCommandRegistry.register(createNotificationsCommand(deps));
}

/**
 * Create the /clear slash command.
 * Clears all messages from the TUI display.
 */
export function createClearCommand(onClear: () => void): SlashCommand {
  return {
    name: "clear",
    description: "Clear the message display",
    handler: (_args, _ctx) => {
      onClear();
      return { handled: true };
    },
  };
}

/**
 * Register /clear in the global registry.
 * Called once during TUI initialization.
 */
export function registerClearCommand(onClear: () => void): void {
  slashCommandRegistry.register(createClearCommand(onClear));
}

function formatAge(
  ageMs: number,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) {
    return t("tui.notifications.ageSeconds", { count: seconds });
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return t("tui.notifications.ageMinutes", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("tui.notifications.ageHours", { count: hours });
  }
  const days = Math.floor(hours / 24);
  return t("tui.notifications.ageDays", { count: days });
}

// ─── Backward-compatible direct API (pre-registry) ─────────────────────────

export interface NotificationCommandOptions {
  store: NotificationStore;
  addMessage: (message: TuiMessageInput) => void;
}

/**
 * Backward-compatible direct call for /notifications.
 * @deprecated Use slashCommandRegistry.dispatch("/notifications", ctx) instead.
 */
export function handleNotificationsCommand(options: NotificationCommandOptions): void {
  const command = createNotificationsCommand({ store: options.store });
  const ctx: SlashCommandContext = {
    addMessage: options.addMessage,
  };
  command.handler?.([], ctx);
}
