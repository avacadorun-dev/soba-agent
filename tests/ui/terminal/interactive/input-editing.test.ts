import { describe, expect, mock, test } from "bun:test";
import type { KeyEvent } from "@opentui/core";
import { handleInputEditingShortcut } from "../../../../src/ui/terminal/interactive/lib/input-editing";

function key(partial: Partial<KeyEvent>): KeyEvent {
  return {
    name: "",
    preventDefault: mock(() => undefined),
    ...partial,
  } as KeyEvent;
}

function target() {
  return {
    selectAll: mock(() => true),
    gotoLineHome: mock(() => true),
    gotoLineEnd: mock(() => true),
  };
}

describe("input editing shortcuts", () => {
  test("Command+A selects only the input and clears terminal selection", () => {
    const input = target();
    const clearTerminalSelection = mock(() => undefined);
    const event = key({ name: "a", super: true });

    expect(handleInputEditingShortcut(event, input, clearTerminalSelection)).toBe(true);
    expect(clearTerminalSelection).toHaveBeenCalledTimes(1);
    expect(input.selectAll).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  test("accepts terminals that report Command as Meta", () => {
    const input = target();

    expect(handleInputEditingShortcut(key({ name: "A", meta: true }), input, () => undefined)).toBe(true);
    expect(input.selectAll).toHaveBeenCalledTimes(1);
  });

  test("Ctrl+Shift+A selects the input when Command is owned by the terminal", () => {
    const input = target();
    const clearTerminalSelection = mock(() => undefined);

    expect(
      handleInputEditingShortcut(
        key({ name: "a", ctrl: true, shift: true }),
        input,
        clearTerminalSelection,
      ),
    ).toBe(true);
    expect(clearTerminalSelection).toHaveBeenCalledTimes(1);
    expect(input.selectAll).toHaveBeenCalledTimes(1);
  });

  test("Ctrl+A and Ctrl+E move to the current line boundaries", () => {
    const input = target();

    expect(handleInputEditingShortcut(key({ name: "a", ctrl: true }), input, () => undefined)).toBe(true);
    expect(input.gotoLineHome).toHaveBeenCalledTimes(1);
    expect(handleInputEditingShortcut(key({ name: "e", ctrl: true }), input, () => undefined)).toBe(true);
    expect(input.gotoLineEnd).toHaveBeenCalledTimes(1);
    expect(input.selectAll).not.toHaveBeenCalled();
  });

  test("does not steal unrelated modified or unmodified keys", () => {
    const input = target();

    expect(handleInputEditingShortcut(key({ name: "a", ctrl: true, meta: true }), input, () => undefined)).toBe(false);
    expect(handleInputEditingShortcut(key({ name: "a" }), input, () => undefined)).toBe(false);
    expect(input.selectAll).not.toHaveBeenCalled();
    expect(input.gotoLineHome).not.toHaveBeenCalled();
  });
});
