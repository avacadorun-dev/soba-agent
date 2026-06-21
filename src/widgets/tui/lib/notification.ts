/**
 * Public API for the notification system — Phase 2.5 A2.
 *
 * This module exports a singleton NotificationStore and convenience
 * functions. When no store has been set, calls are no-ops (safe to
 * call before TUI initialization).
 */

import type { NotificationType } from "../model/notification-store";
import { NotificationStore } from "../model/notification-store";

let store: NotificationStore | null = null;

/**
 * Set the active notification store instance. Called during TUI
 * initialization. Passing null disables notifications.
 */
export function setNotificationStore(s: NotificationStore | null): void {
  store = s;
}

/**
 * Get the current notification store instance, or null.
 */
export function getNotificationStore(): NotificationStore | null {
  return store;
}

/**
 * Show a notification. No-op when no store is set.
 */
export function notify(type: NotificationType, title: string, message: string): string {
  return store?.notify(type, title, message) ?? "";
}

/**
 * Dismiss a specific notification by id. No-op when no store is set.
 */
export function dismiss(id: string): boolean {
  return store?.dismiss(id) ?? false;
}

/**
 * Dismiss all visible notifications. No-op when no store is set.
 */
export function dismissAll(): void {
  store?.dismissAll();
}
