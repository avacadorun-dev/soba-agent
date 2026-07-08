/**
 * Collapse completed agent thoughts — pure logic tests.
 *
 * Covers the threshold/preview helpers in lib/reasoning-collapse.ts:
 *  - short completed thought is not collapsible
 *  - long completed thought (chars or lines) is collapsible
 *  - streaming thought is never collapsible
 *  - preview is a single truncated first line
 */

import { describe, expect, test } from "bun:test";
import {
  buildReasoningPreview,
  computeReasoningExpanded,
  isReasoningCollapsible,
  REASONING_COLLAPSE_THRESHOLD_CHARS,
  REASONING_COLLAPSE_THRESHOLD_LINES,
  REASONING_PREVIEW_MAX_CHARS,
} from "../../../../src/ui/terminal/interactive/lib/reasoning-collapse";

describe("Collapse completed agent thoughts — logic", () => {
  describe("isReasoningCollapsible", () => {
    test("short completed thought is not collapsible", () => {
      expect(isReasoningCollapsible({ content: "Let me check the file.", streaming: false })).toBe(false);
    });

    test("long completed thought (by chars) is collapsible", () => {
      const long = "x".repeat(REASONING_COLLAPSE_THRESHOLD_CHARS + 1);
      expect(isReasoningCollapsible({ content: long, streaming: false })).toBe(true);
    });

    test("long completed thought (by lines) is collapsible", () => {
      const manyLines = Array.from({ length: REASONING_COLLAPSE_THRESHOLD_LINES + 1 }, (_, i) => `line ${i}`).join("\n");
      expect(isReasoningCollapsible({ content: manyLines, streaming: false })).toBe(true);
    });

    test("streaming thought is never collapsible even when long", () => {
      const long = "x".repeat(REASONING_COLLAPSE_THRESHOLD_CHARS + 1);
      expect(isReasoningCollapsible({ content: long, streaming: true })).toBe(false);
    });

    test("empty completed thought is not collapsible", () => {
      expect(isReasoningCollapsible({ content: "", streaming: false })).toBe(false);
    });

    test("threshold boundary is not collapsible (strictly greater)", () => {
      const exact = "x".repeat(REASONING_COLLAPSE_THRESHOLD_CHARS);
      expect(isReasoningCollapsible({ content: exact, streaming: false })).toBe(false);
    });
  });

  describe("buildReasoningPreview", () => {
    test("returns the first non-empty line as-is when short", () => {
      expect(buildReasoningPreview("First line\nSecond line")).toBe("First line");
    });

    test("skips leading blank lines", () => {
      expect(buildReasoningPreview("\n\n  Actual first line\nSecond")).toBe("Actual first line");
    });

    test("truncates a long first line with an ellipsis", () => {
      const long = "a".repeat(REASONING_PREVIEW_MAX_CHARS + 40);
      const preview = buildReasoningPreview(long);
      expect(preview.length).toBe(REASONING_PREVIEW_MAX_CHARS);
      expect(preview.endsWith("…")).toBe(true);
      expect(preview.startsWith("a")).toBe(true);
    });

    test("returns empty string for empty content", () => {
      expect(buildReasoningPreview("")).toBe("");
    });
  });

  describe("computeReasoningExpanded", () => {
    test("streaming thought stays expanded", () => {
      const long = "x".repeat(REASONING_COLLAPSE_THRESHOLD_CHARS + 1);
      expect(computeReasoningExpanded({ content: long, streaming: true })).toBe(true);
    });

    test("short completed thought stays expanded", () => {
      expect(computeReasoningExpanded({ content: "quick thought", streaming: false })).toBe(true);
    });

    test("long completed thought collapses by default", () => {
      const long = "x".repeat(REASONING_COLLAPSE_THRESHOLD_CHARS + 1);
      expect(computeReasoningExpanded({ content: long, streaming: false })).toBe(false);
    });

    test("user override to expanded wins over the collapsed default", () => {
      const long = "x".repeat(REASONING_COLLAPSE_THRESHOLD_CHARS + 1);
      expect(computeReasoningExpanded({ content: long, streaming: false }, true)).toBe(true);
    });

    test("user override to collapsed wins over the expanded default", () => {
      expect(computeReasoningExpanded({ content: "short", streaming: false }, false)).toBe(false);
    });

    test("many-line completed thought collapses by default", () => {
      const manyLines = Array.from({ length: REASONING_COLLAPSE_THRESHOLD_LINES + 1 }, (_, i) => `line ${i}`).join("\n");
      expect(computeReasoningExpanded({ content: manyLines, streaming: false })).toBe(false);
    });
  });
});
