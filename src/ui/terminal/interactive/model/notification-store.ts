/**
 * NotificationStore — Phase 2.5 A2.
 *
 * Solid-based reactive store for the notification system.
 * Manages visible notifications (max 3), auto-dismiss timers,
 * and notification history.
 *
 * Types:
 *  - success (✓): skill activated, compaction complete
 *  - warning (⚠): context approaching limit, trust change
 *  - error (✗): API error, compaction failed
 *  - info (ℹ): model switched, compaction started
 *
 * Behavior:
 *  - Auto-dismiss: 5s for success/info, 10s for warning/error
 *  - Max 3 visible notifications
 *  - Escape dismisses the oldest visible notification
 *  - Overflow: oldest pushed to history
 */

import { batch, createSignal } from "solid-js";
import type { TranslationKey } from "../../../../application/public";
import { I18n } from "../../../../application/public";

export type NotificationType = "success" | "warning" | "error" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  /** Timer handle for auto-dismiss. null when manually dismissed or already expired. */
  timer: ReturnType<typeof setTimeout> | null;
}

export interface NotificationStoreOptions {
  i18n?: I18n;
}

export class NotificationStore {
  private readonly i18n: I18n;
  private idCounter = 0;

  private readonly _visible: ReturnType<typeof createSignal<Notification[]>>;
  private readonly _history: ReturnType<typeof createSignal<Notification[]>>;

  constructor(options: NotificationStoreOptions = {}) {
    this.i18n = options.i18n ?? new I18n("en");
    this._visible = createSignal<Notification[]>([]);
    this._history = createSignal<Notification[]>([]);
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  visible = (): Notification[] => this._visible[0]();
  history = (): Notification[] => this._history[0]();

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Show a notification. If max visible (3) is exceeded, the oldest
   * visible notification is moved to history.
   *
   * Returns the notification id for manual dismissal.
   */
  notify(type: NotificationType, title: string, message: string): string {
    const id = String(++this.idCounter);
    const autoDismissMs = type === "success" || type === "info" ? 5000 : 10000;
    const timer = setTimeout(() => this.dismiss(id), autoDismissMs);

    const notification: Notification = {
      id,
      type,
      title,
      message,
      timestamp: Date.now(),
      timer,
    };

    this._visible[1]((prev) => {
      const next = [...prev, notification];
      if (next.length > 3) {
        const [overflowed, ...remaining] = next;
        this.archive(overflowed);
        return remaining;
      }
      return next;
    });

    return id;
  }

  /**
   * Dismiss a specific notification by id.
   * Clears the timer and removes from visible list.
   * Returns true if the notification was found and removed.
   */
  dismiss(id: string): boolean {
    return this.dismissBy((n) => n.id === id);
  }

  /**
   * Dismiss all visible notifications.
   * Clears all timers and archives the notifications.
   */
  dismissAll(): void {
    this._visible[1]((prev) => {
      batch(() => {
        for (const n of prev) {
          this.clearTimer(n);
        }
        this._history[1]((hist) => [...prev.map((n) => ({ ...n, timer: null })), ...hist]);
      });
      return [];
    });
  }

  /**
   * Dismiss the oldest visible notification (used by Escape key).
   * Returns true if a notification was dismissed.
   */
  dismissOldest(): boolean {
    return this.dismissByIndex(0);
  }

  /**
   * Dismiss the most recent visible notification.
   * Returns true if a notification was dismissed.
   */
  dismissNewest(): boolean {
    const visible = this._visible[0]();
    if (visible.length === 0) return false;
    return this.dismissByIndex(visible.length - 1);
  }

  /**
   * Clear notification history.
   */
  clearHistory(): void {
    this._history[1]([]);
  }

  // ── i18n ───────────────────────────────────────────────────────────────────

  t(key: TranslationKey, vars?: Record<string, string | number>): string {
    return this.i18n.t(key, vars);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private dismissBy(predicate: (n: Notification) => boolean): boolean {
    let found = false;
    this._visible[1]((prev) => {
      const result: Notification[] = [];
      for (const n of prev) {
        if (!found && predicate(n)) {
          found = true;
          this.clearTimer(n);
          this.archive(n);
        } else {
          result.push(n);
        }
      }
      return result;
    });
    return found;
  }

  private dismissByIndex(index: number): boolean {
    let found = false;
    let idx = 0;
    this._visible[1]((prev) => {
      const result: Notification[] = [];
      for (const n of prev) {
        if (!found && idx === index) {
          found = true;
          this.clearTimer(n);
          this.archive(n);
        } else {
          result.push(n);
        }
        idx++;
      }
      return result;
    });
    return found;
  }

  private archive(notification: Notification): void {
    const archived: Notification = { ...notification, timer: null };
    this._history[1]((prev) => [archived, ...prev]);
  }

  private clearTimer(notification: Notification): void {
    if (notification.timer !== null) {
      clearTimeout(notification.timer);
    }
  }

  /**
   * Clean up all timers. Call on TUI shutdown.
   */
  dispose(): void {
    this._visible[1]((prev) => {
      for (const n of prev) {
        this.clearTimer(n);
      }
      return [];
    });
  }
}
