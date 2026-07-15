import { describe, expect, test } from "bun:test";
import type { KeyEvent } from "@opentui/core";
import {
  formatKeyBindings,
  keyMatchesAction,
  TUI_KEYMAP,
} from "../../../../src/ui/terminal/interactive/lib/keymap";

function key(partial: Partial<KeyEvent>): KeyEvent {
  return partial as KeyEvent;
}

describe("TUI keymap", () => {
  test("opens model selector with portable F2 and legacy Ctrl+M", () => {
    expect(keyMatchesAction(key({ name: "f2" }), "openModelSelector")).toBe(true);
    expect(keyMatchesAction(key({ name: "F2" }), "openModelSelector")).toBe(true);
    expect(keyMatchesAction(key({ name: "m", ctrl: true }), "openModelSelector")).toBe(true);
    expect(keyMatchesAction(key({ name: "return" }), "openModelSelector")).toBe(false);
    expect(keyMatchesAction(key({ name: "m" }), "openModelSelector")).toBe(false);
  });

  test("uses F3 for search and F6 for sidebar navigation", () => {
    expect(keyMatchesAction(key({ name: "f3" }), "openSearch")).toBe(true);
    expect(keyMatchesAction(key({ name: "f", ctrl: true }), "openSearch")).toBe(true);
    expect(keyMatchesAction(key({ name: "f6" }), "nextSidebarMode")).toBe(true);
    expect(keyMatchesAction(key({ name: "f6", shift: true }), "previousSidebarMode")).toBe(true);
    expect(keyMatchesAction(key({ name: "f6", shift: true }), "nextSidebarMode")).toBe(false);
  });

  test("keeps copy and cancel key chords distinct", () => {
    expect(keyMatchesAction(key({ name: "c", ctrl: true, shift: true }), "copyTranscript")).toBe(true);
    expect(keyMatchesAction(key({ name: "c", ctrl: true }), "cancelOrQuit")).toBe(true);
    expect(keyMatchesAction(key({ name: "c", ctrl: true }), "copyTranscript")).toBe(false);
  });

  test("leaves Ctrl+E available to the focused input editor", () => {
    const ctrlEIsGlobal = Object.values(TUI_KEYMAP)
      .flat()
      .some((binding) => binding.name === "e" && binding.ctrl);

    expect(ctrlEIsGlobal).toBe(false);
  });

  test("formats labels for help output", () => {
    expect(formatKeyBindings("openModelSelector")).toContain("F2");
    expect(formatKeyBindings("openSearch")).toContain("F3");
  });
});
