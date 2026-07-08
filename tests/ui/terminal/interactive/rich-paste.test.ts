import { describe, expect, test } from "bun:test";
import {
  blockFromPasteBytes,
  classifyPastedText,
  createImageComposerBlock,
  createTextComposerBlock,
  formatComposerBlock,
  MAX_DRAFT_IMAGE_BYTES,
  validateComposerBlock,
} from "../../../../src/ui/terminal/interactive/lib/rich-paste";

describe("rich paste helpers", () => {
  test("classifies small paste as inline and large paste as block", () => {
    expect(classifyPastedText("short text")).toBe("inline");
    expect(classifyPastedText("line\nline\nline\nline\nline\nline")).toBe("block");
    expect(classifyPastedText("x".repeat(800))).toBe("block");
  });

  test("strips ANSI sequences from pasted text blocks", () => {
    const block = createTextComposerBlock("\x1b[31mred\x1b[0m");
    expect(block).toMatchObject({ type: "text", text: "red", chars: 3, lines: 1 });
  });

  test("creates image blocks from image paste metadata", () => {
    const block = blockFromPasteBytes(new Uint8Array([1, 2, 3]), { mimeType: "image/png", kind: "binary" });
    expect(block).toMatchObject({ type: "image", mimeType: "image/png", bytes: 3 });
  });

  test("formats text and image summaries", () => {
    expect(formatComposerBlock({ id: 1, ...createTextComposerBlock("a\nb") })).toBe("[Pasted text · 2 lines · 3 chars]");
    expect(formatComposerBlock({ id: 2, ...createImageComposerBlock("image/png", new Uint8Array(1024)) })).toBe("[Image · image/png · 1 KB]");
  });

  test("validates image size and count limits", () => {
    const tooLarge = createImageComposerBlock("image/png", new Uint8Array(MAX_DRAFT_IMAGE_BYTES + 1));
    expect(validateComposerBlock(tooLarge, [])).toContain("too large");

    const existing = [1, 2, 3].map((id) => ({
      id,
      ...createImageComposerBlock("image/png", new Uint8Array([id])),
    }));
    expect(validateComposerBlock(createImageComposerBlock("image/png", new Uint8Array([4])), existing)).toContain("Too many images");
  });
});
