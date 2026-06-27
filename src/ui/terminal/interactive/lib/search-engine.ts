/**
 * SearchEngine — Phase 2.5 B4.
 *
 * Pure-function O(n) text search over TuiMessage arrays.
 * Returns match positions and preview text for rendering in the overlay.
 */

import type { TuiMessage } from "../model/types";
import { formatTuiEvidenceSummary } from "./evidence-summary";

export interface SearchMatch {
  /** Start offset in the extracted text (code-units). */
  start: number;
  /** End offset in the extracted text (code-units, exclusive). */
  end: number;
}

export interface SearchResult {
  /** Index in the original messages array. */
  messageIndex: number;
  /** The matched message. */
  message: TuiMessage;
  /**
   * Match character offsets within the extracted text.
   * The search overlay uses these to highlight matched spans.
   */
  matches: SearchMatch[];
  /** SNIPPET_LENGTH-char preview centred around the first match. */
  preview: string;
}

const SNIPPET_LENGTH = 80;

/**
 * Extract searchable text from a TuiMessage, filtering out control
 * sequences and other non-printable characters.
 */
export function extractSearchText(msg: TuiMessage): string {
  // Strip ANSI escape sequences so the search is against plain text.
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\u001b/g, "");
  switch (msg.type) {
    case "user":
    case "assistant":
    case "reasoning":
    case "narration":
    case "info":
    case "success":
    case "warning":
    case "error":
      return stripAnsi(msg.content);
    case "evidence":
      return stripAnsi(formatTuiEvidenceSummary(msg.summary));
    case "tool-start":
      return stripAnsi(msg.summary);
    case "tool-result":
      // Include both summary and content for tool-result
      return stripAnsi([msg.summary, ...(msg.details ?? []), msg.content].join(" "));
    case "tool-end":
      return stripAnsi(msg.toolName);
    default:
      return "";
  }
}

/**
 * Search messages array for `query`.  Returns results sorted by
 * message index (ascending).  An empty query returns an empty array.
 * Case-insensitive.
 */
export function searchMessages(messages: TuiMessage[], query: string): SearchResult[] {
  const q = query.trim();
  if (q.length === 0 || messages.length === 0) return [];

  const results: SearchResult[] = [];
  const lowerQ = q.toLowerCase();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const text = extractSearchText(msg);
    if (text.length === 0) continue;

    const matches = findAllMatches(text, lowerQ);
    if (matches.length === 0) continue;

    results.push({
      messageIndex: i,
      message: msg,
      matches,
      preview: buildPreview(text, matches[0], SNIPPET_LENGTH),
    });
  }

  return results;
}

/**
 * Find all non-overlapping occurrences of `lowerQ` in `text`.
 * Respects word boundaries for multi-word queries (both find full phrase
 * and individual words).
 */
function findAllMatches(text: string, lowerQ: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const lowerText = text.toLowerCase();
  let pos = 0;

  while (pos < lowerText.length) {
    const idx = lowerText.indexOf(lowerQ, pos);
    if (idx === -1) break;
    matches.push({ start: idx, end: idx + lowerQ.length });
    pos = idx + 1; // allow overlapping matches
  }

  return matches;
}

/**
 * Build a preview string of at most `maxLen` characters centred on
 * the first match.
 */
function buildPreview(text: string, firstMatch: SearchMatch, maxLen: number): string {
  if (text.length <= maxLen) return text;

  const matchCentre = Math.floor((firstMatch.start + firstMatch.end) / 2);
  const half = Math.floor(maxLen / 2);
  let start = Math.max(0, matchCentre - half);
  let end = start + maxLen;

  if (end > text.length) {
    end = text.length;
    start = Math.max(0, end - maxLen);
  }

  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end) + suffix;
}
