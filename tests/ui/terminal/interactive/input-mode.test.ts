import { describe, expect, test } from "bun:test";
import {
  isShellInput,
  parseTuiInput,
} from "../../../../src/ui/terminal/interactive/lib/input-mode";

describe("TUI input modes", () => {
  test("classifies regular, slash and shell input", () => {
    expect(parseTuiInput("hello")).toEqual({ mode: "message", content: "hello" });
    expect(parseTuiInput("/help")).toEqual({ mode: "slash-command", content: "/help" });
    expect(parseTuiInput("!pwd")).toEqual({ mode: "shell", content: "pwd" });
    expect(parseTuiInput("!!pwd")).toEqual({ mode: "shell-silent", content: "pwd" });
    expect(parseTuiInput("// local note")).toEqual({ mode: "message", content: "// local note" });
    expect(parseTuiInput("  ")).toEqual({ mode: "empty", content: "" });
  });

  test("normalizes repeated shell prefixes in multiline input", () => {
    expect(parseTuiInput("!pwd\n!git status\n  !!bun test")).toEqual({
      mode: "shell",
      content: "pwd\ngit status\n  bun test",
    });
    expect(parseTuiInput("!!pwd\n!!git status")).toEqual({
      mode: "shell-silent",
      content: "pwd\ngit status",
    });
  });

  test("preserves // syntax verbatim in multiline shell input", () => {
    expect(parseTuiInput("!pwd\n// inspect changes\n!git status")).toEqual({
      mode: "shell",
      content: "pwd\n// inspect changes\ngit status",
    });
  });

  test("recognizes large shell pastes so they stay editable inline", () => {
    const paste = Array.from({ length: 8 }, (_, index) => `!echo ${index}`).join("\n");
    expect(isShellInput(paste)).toBe(true);
  });
});
