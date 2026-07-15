import type { KeyEvent } from "@opentui/core";

interface InputEditingTarget {
  selectAll(): boolean;
  gotoLineHome(): boolean;
  gotoLineEnd(): boolean;
}

function hasOnlyModifier(
  key: KeyEvent,
  modifier: "ctrl" | "ctrlShift" | "command",
): boolean {
  const command = Boolean(key.meta || key.super);
  return (
    !key.hyper &&
    (modifier === "ctrl"
      ? Boolean(key.ctrl) && !key.shift && !command
      : modifier === "ctrlShift"
        ? Boolean(key.ctrl) && Boolean(key.shift) && !command
        : command && !key.ctrl && !key.shift)
  );
}

/**
 * Apply input-local editing shortcuts before OpenTUI's global selection logic.
 * Command can arrive as `super` or `meta`, depending on the terminal.
 */
export function handleInputEditingShortcut(
  key: KeyEvent,
  target: InputEditingTarget,
  clearTerminalSelection: () => void,
): boolean {
  const name = key.name?.toLowerCase();

  if (
    name === "a" &&
    (hasOnlyModifier(key, "command") || hasOnlyModifier(key, "ctrlShift"))
  ) {
    key.preventDefault();
    clearTerminalSelection();
    target.selectAll();
    return true;
  }

  if (name === "a" && hasOnlyModifier(key, "ctrl")) {
    key.preventDefault();
    target.gotoLineHome();
    return true;
  }

  if (name === "e" && hasOnlyModifier(key, "ctrl")) {
    key.preventDefault();
    target.gotoLineEnd();
    return true;
  }

  return false;
}
