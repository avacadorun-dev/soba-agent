import { describe, expect, mock, test } from "bun:test";
import { copySelectedText } from "../../../../src/ui/terminal/interactive/hooks/use-copy-on-selection";

describe("copy on selection", () => {
  test("copies the exact selected text and reports success", () => {
    const copyToClipboardOSC52 = mock(() => true);
    const onCopied = mock(() => undefined);

    const copied = copySelectedText(
      "  selected text\nnext line  ",
      { copyToClipboardOSC52 },
      onCopied,
    );

    expect(copied).toBe(true);
    expect(copyToClipboardOSC52).toHaveBeenCalledWith("  selected text\nnext line  ");
    expect(onCopied).toHaveBeenCalledTimes(1);
  });

  test("ignores empty and whitespace-only selections", () => {
    const copyToClipboardOSC52 = mock(() => true);
    const onCopied = mock(() => undefined);

    expect(copySelectedText(" \n\t ", { copyToClipboardOSC52 }, onCopied)).toBe(false);
    expect(copyToClipboardOSC52).not.toHaveBeenCalled();
    expect(onCopied).not.toHaveBeenCalled();
  });

  test("does not report success when the terminal rejects clipboard copy", () => {
    const copyToClipboardOSC52 = mock(() => false);
    const onCopied = mock(() => undefined);

    expect(copySelectedText("selected", { copyToClipboardOSC52 }, onCopied)).toBe(false);
    expect(onCopied).not.toHaveBeenCalled();
  });
});
