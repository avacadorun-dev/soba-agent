/**
 * Reasoning collapse helpers.
 *
 * Pure logic for deciding whether a completed agent thought should be
 * collapsed in the transcript and for building its compact preview.
 * Kept separate from the Solid component so it can be unit-tested in
 * isolation and reused by the message list + tests.
 */

/** A completed thought longer than this (chars) auto-collapses. */
export const REASONING_COLLAPSE_THRESHOLD_CHARS = 280;
/** A completed thought with more lines than this auto-collapses. */
export const REASONING_COLLAPSE_THRESHOLD_LINES = 4;
/** Maximum characters kept from the first line(s) for the collapsed preview. */
export const REASONING_PREVIEW_MAX_CHARS = 96;

export interface ReasoningLike {
  content: string;
  streaming: boolean;
}

/**
 * A completed thought is collapsible when it is no longer streaming and
 * exceeds either the character or the line threshold. Short thoughts stay
 * expanded; streaming thoughts are never collapsible.
 */
export function isReasoningCollapsible(message: ReasoningLike): boolean {
  if (message.streaming) return false;
  if (!message.content) return false;
  const lineCount = message.content.split("\n").length;
  return message.content.length > REASONING_COLLAPSE_THRESHOLD_CHARS || lineCount > REASONING_COLLAPSE_THRESHOLD_LINES;
}

/**
 * Build a single-line preview for the collapsed header: the first non-empty
 * line, truncated to REASONING_PREVIEW_MAX_CHARS with an ellipsis when needed.
 */
export function buildReasoningPreview(content: string): string {
  const trimmed = content.replace(/\r/g, "");
  const firstLine = trimmed.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  if (firstLine.length <= REASONING_PREVIEW_MAX_CHARS) return firstLine;
  return `${firstLine.slice(0, REASONING_PREVIEW_MAX_CHARS - 1)}…`;
}

/**
 * Decide whether a reasoning block renders expanded.
 *
 *  - An explicit user override (from clicking / Enter) always wins.
 *  - Streaming thoughts stay expanded so the live text stays visible.
 *  - Short completed thoughts stay expanded.
 *  - Long completed thoughts collapse by default.
 */
export function computeReasoningExpanded(message: ReasoningLike, override?: boolean): boolean {
  if (override !== undefined) return override;
  if (message.streaming || !isReasoningCollapsible(message)) return true;
  return false;
}
