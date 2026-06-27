import { describe, expect, test } from "bun:test";
import { buildToolOutputPreview, sanitizeToolOutputForTui } from "../../../../src/ui/terminal/interactive/lib/tool-output-preview";

describe("tool output TUI preview", () => {
  test("escapes ANSI and unsafe terminal control characters", () => {
    const result = sanitizeToolOutputForTui("\x1b[31mred\x1b[0m\x1b]2;title\x07\nbad\x07bell\x08backspace");

    expect(result.text).toBe("red\nbad�bell�backspace");
    expect(result.hadUnsafeControlChars).toBe(true);
  });

  test("keeps small output intact after sanitizing", () => {
    const preview = buildToolOutputPreview("one\ntwo\nthree");

    expect(preview.lines).toEqual(["one", "two", "three"]);
    expect(preview.omittedLines).toBe(0);
    expect(preview.totalLines).toBe(3);
  });

  test("limits large output to bounded head and tail preview", () => {
    const output = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join("\n");
    const preview = buildToolOutputPreview(output);

    expect(preview.totalLines).toBe(200);
    expect(preview.lines).toHaveLength(81);
    expect(preview.lines[0]).toBe("line 1");
    expect(preview.lines[39]).toBe("line 40");
    expect(preview.lines[40]).toBe("... 120 lines omitted from TUI preview ...");
    expect(preview.lines[41]).toBe("line 161");
    expect(preview.lines.at(-1)).toBe("line 200");
    expect(preview.omittedLines).toBe(120);
  });

  test("truncates individual very long lines", () => {
    const preview = buildToolOutputPreview("x".repeat(500));

    expect(preview.lines[0].length).toBe(240);
    expect(preview.lines[0].endsWith("…")).toBe(true);
  });
});
