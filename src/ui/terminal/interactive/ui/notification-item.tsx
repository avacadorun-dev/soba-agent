import type { Notification, NotificationType } from "../model/notification-store";
import type { TuiTheme } from "../lib/theme";

export interface NotificationItemProps {
  notification: Notification;
  theme: TuiTheme;
}

/**
 * Get the icon character for a notification type.
 */
export function notificationIcon(type: NotificationType): string {
  switch (type) {
    case "success":
      return "✓";
    case "warning":
      return "⚠";
    case "error":
      return "✗";
    case "info":
      return "ℹ";
  }
}

/**
 * Single notification item rendered in the NotificationCenter.
 * Shows icon, title, and message with theme-aware color-coded type.
 */
export function NotificationItem(props: NotificationItemProps) {
  const { notification, theme } = props;
  const icon = notificationIcon(notification.type);
  const fg = colorForType(notification.type, theme);

  return (
    <box style={{ flexDirection: "column", paddingTop: 0, paddingBottom: 0 }}>
      <box style={{ flexDirection: "row", flexGrow: 0 }}>
        <text fg={fg}>{icon}</text>
        <text fg={fg}>
          <b>
            {" "}
            {notification.title}
          </b>
        </text>
      </box>
      <text wrapMode="word">{notification.message}</text>
    </box>
  );
}

/**
 * Map notification type to a theme-aware color from TuiTheme palette.
 * Colors are taken directly from the active theme definition.
 */
function colorForType(type: NotificationType, theme: TuiTheme): string {
  switch (type) {
    case "success":
      return theme.success;
    case "warning":
      return theme.warning;
    case "error":
      return theme.error;
    case "info":
      return theme.secondary;
  }
}
