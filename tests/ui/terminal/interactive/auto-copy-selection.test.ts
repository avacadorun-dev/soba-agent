import { describe, expect, test, vi } from "bun:test";
import { copyCompletedSelection } from "../../../../src/ui/terminal/interactive/hooks/use-auto-copy-selection";

function selection(input: {
  anchor?: { x: number; y: number };
  focus?: { x: number; y: number };
  text?: string;
}) {
  return {
    anchor: input.anchor ?? { x: 3, y: 4 },
    focus: input.focus ?? { x: 8, y: 4 },
    getSelectedText: () => input.text ?? "selected text",
  };
}

describe("TUI auto-copy selection", () => {
  test("copies the exact selected text after a drag completes", () => {
    const copyToClipboardOSC52 = vi.fn(() => true);
    const onCopied = vi.fn();

    const copied = copyCompletedSelection(
      selection({ text: "first line\nsecond line  " }),
      { copyToClipboardOSC52 },
      onCopied,
    );

    expect(copied).toBe(true);
    expect(copyToClipboardOSC52).toHaveBeenCalledWith("first line\nsecond line  ");
    expect(onCopied).toHaveBeenCalledTimes(1);
  });

  test("does not overwrite the clipboard on a plain click", () => {
    const copyToClipboardOSC52 = vi.fn(() => true);
    const onCopied = vi.fn();

    const copied = copyCompletedSelection(
      selection({ anchor: { x: 5, y: 7 }, focus: { x: 5, y: 7 }, text: "x" }),
      { copyToClipboardOSC52 },
      onCopied,
    );

    expect(copied).toBe(false);
    expect(copyToClipboardOSC52).not.toHaveBeenCalled();
    expect(onCopied).not.toHaveBeenCalled();
  });

  test("ignores an empty completed selection", () => {
    const copyToClipboardOSC52 = vi.fn(() => true);
    const onCopied = vi.fn();

    expect(copyCompletedSelection(selection({ text: "" }), { copyToClipboardOSC52 }, onCopied)).toBe(false);
    expect(copyToClipboardOSC52).not.toHaveBeenCalled();
    expect(onCopied).not.toHaveBeenCalled();
  });

  test("does not report success when the terminal rejects OSC52", () => {
    const copyToClipboardOSC52 = vi.fn(() => false);
    const onCopied = vi.fn();

    expect(copyCompletedSelection(selection({ text: "selected" }), { copyToClipboardOSC52 }, onCopied)).toBe(false);
    expect(copyToClipboardOSC52).toHaveBeenCalledWith("selected");
    expect(onCopied).not.toHaveBeenCalled();
  });
});
