import type { KeyEvent } from "@opentui/core";

export type TuiKeyAction =
  | "copyTranscript"
  | "cancelOrQuit"
  | "copyLastAssistant"
  | "openSearch"
  | "clearMessages"
  | "openModelSelector"
  | "toggleSidebar"
  | "nextSidebarMode"
  | "previousSidebarMode"
  | "openHelp"
  | "toggleToolResult"
  | "focusNextToolResult"
  | "focusPreviousToolResult";

export interface KeyBinding {
  name: string;
  label: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  super?: boolean;
}

export const TUI_KEYMAP: Record<TuiKeyAction, KeyBinding[]> = {
  copyTranscript: [
    { name: "c", label: "Cmd+C", meta: true },
    { name: "c", label: "Cmd+Shift+C", meta: true, shift: true },
    { name: "c", label: "Super+C", super: true },
    { name: "c", label: "Super+Shift+C", super: true, shift: true },
    { name: "c", label: "Ctrl+Shift+C", ctrl: true, shift: true },
  ],
  cancelOrQuit: [{ name: "c", label: "Ctrl+C", ctrl: true }],
  copyLastAssistant: [{ name: "y", label: "Ctrl+Y", ctrl: true }],
  openSearch: [
    { name: "f3", label: "F3" },
    { name: "f", label: "Ctrl+F", ctrl: true },
  ],
  clearMessages: [{ name: "l", label: "Ctrl+L", ctrl: true }],
  openModelSelector: [
    { name: "f2", label: "F2" },
    // Legacy alias. Ctrl+M is indistinguishable from Enter in many terminals.
    { name: "m", label: "Ctrl+M", ctrl: true },
  ],
  toggleSidebar: [{ name: "s", label: "Ctrl+Shift+S", ctrl: true, shift: true }],
  nextSidebarMode: [
    { name: "f6", label: "F6" },
    { name: "b", label: "Ctrl+B", ctrl: true },
  ],
  previousSidebarMode: [
    { name: "f6", label: "Shift+F6", shift: true },
    { name: "b", label: "Ctrl+Shift+B", ctrl: true, shift: true },
  ],
  openHelp: [
    { name: "f1", label: "F1" },
    { name: "h", label: "Ctrl+H", ctrl: true },
  ],
  toggleToolResult: [{ name: "e", label: "Ctrl+E", ctrl: true }],
  focusNextToolResult: [{ name: "down", label: "Ctrl+Down", ctrl: true }],
  focusPreviousToolResult: [{ name: "up", label: "Ctrl+Up", ctrl: true }],
};

export const TUI_KEYMAP_HELP_ORDER: TuiKeyAction[] = [
  "openHelp",
  "openModelSelector",
  "openSearch",
  "nextSidebarMode",
  "previousSidebarMode",
  "toggleSidebar",
  "clearMessages",
  "copyTranscript",
  "copyLastAssistant",
  "cancelOrQuit",
  "toggleToolResult",
  "focusNextToolResult",
  "focusPreviousToolResult",
];

export const TUI_KEYMAP_ACTION_LABELS: Record<TuiKeyAction, string> = {
  copyTranscript: "Copy transcript",
  cancelOrQuit: "Stop agent / quit",
  copyLastAssistant: "Copy last assistant",
  openSearch: "Search conversation",
  clearMessages: "Clear messages",
  openModelSelector: "Open model selector",
  toggleSidebar: "Collapse or expand sidebar",
  nextSidebarMode: "Next sidebar panel",
  previousSidebarMode: "Previous sidebar panel",
  openHelp: "Open help panel",
  toggleToolResult: "Toggle focused tool result",
  focusNextToolResult: "Focus next tool result",
  focusPreviousToolResult: "Focus previous tool result",
};

export function keyMatchesAction(key: KeyEvent, action: TuiKeyAction): boolean {
  return TUI_KEYMAP[action].some((binding) => keyMatchesBinding(key, binding));
}

export function formatKeyBindings(action: TuiKeyAction): string {
  return TUI_KEYMAP[action].map((binding) => binding.label).join(" / ");
}

export function getKeymapHelpRows(): string[] {
  return TUI_KEYMAP_HELP_ORDER.map((action) => `${formatKeyBindings(action)} - ${TUI_KEYMAP_ACTION_LABELS[action]}`);
}

function keyMatchesBinding(key: KeyEvent, binding: KeyBinding): boolean {
  return (
    key.name?.toLowerCase() === binding.name &&
    Boolean(key.ctrl) === Boolean(binding.ctrl) &&
    Boolean(key.shift) === Boolean(binding.shift) &&
    Boolean(key.meta) === Boolean(binding.meta) &&
    Boolean(key.super) === Boolean(binding.super)
  );
}
