/**
 * Compaction module.
 *
 * Implements manual compaction via the OpenResponses compact endpoint
 * (or adapter equivalent). The flow:
 *
 *   1. Check if compaction is needed (shouldCompact)
 *   2. Find the cut point in the session (findCutPoint)
 *   3. Serialize items before the cut point
 *   4. Call client.compact() to get a CompactionSummaryItem
 *   5. Store CompactionEntry in the session
 *
 * After compaction, buildInput() automatically emits:
 *   [compactionItem, ...items after cut point]
 */

import type { OpenResponsesClient } from "../client/openresponses-client";
import type { CompactResponseParams, ItemParam } from "../client/types";
import type { SessionManager } from "../session/session-manager";
import { estimateItemTokens, estimateTokens } from "../session/session-manager";
import type { CompactionSummaryItemParam, SessionEntry, SessionItemEntry } from "../session/types";
import { isAssistantMessageItem, isUserMessageItem } from "../session/types";

// ─── Constants ───

/**
 * Default number of recent tokens to keep after compaction.
 * 20K tokens leaves plenty of room for the model's response
 * within a 128K context window.
 */
const DEFAULT_KEEP_RECENT_TOKENS = 20_000;

/**
 * Context window utilization threshold that triggers compaction recommendation.
 * 70% of 128K = ~89K tokens.
 */
const COMPACT_THRESHOLD = 0.7;

/**
 * Default context window size (tokens) for estimation purposes.
 */
const DEFAULT_CONTEXT_WINDOW = 128_000;

// ─── Types ───

export interface CompactionOptions {
  /** Number of recent tokens to keep (default: 20000) */
  keepRecentTokens?: number;
  /** Context window size for shouldCompact() (default: 128000) */
  contextWindow?: number;
  /** Optional custom instructions for the compactor */
  instructions?: string;
}

export interface CompactionResult {
  /** The compaction item produced */
  compactionItem: CompactionSummaryItemParam;
  /** ID of the compaction checkpoint in the session */
  compactionEntryId: string;
  /** Token count before compaction */
  tokensBefore: number;
  /** Token count of kept items after compaction */
  tokensKept: number;
  /** Items that were kept (after cut point) */
  keptItems: ItemParam[];
  /** Items that were compacted (before cut point) */
  compactedItems: ItemParam[];
}

// ─── Core Functions ───

/**
 * Find the cut point in an array of session entries.
 *
 * Walks backwards from the newest entry, accumulating token estimates.
 * Stops when accumulated tokens >= keepRecentTokens.
 *
 * Rules:
 * - Never cut at tool output items (they must stay with their tool call)
 * - Allowed cut points: user_message, assistant_message items
 * - If no suitable cut point is found, cuts at the earliest allowed entry
 *
 * Returns the index of the first entry to KEEP (entries before this are compacted).
 */
export function findCutPoint(entries: SessionEntry[], keepRecentTokens = DEFAULT_KEEP_RECENT_TOKENS): number {
  if (entries.length === 0) return 0;

  let accumulatedTokens = 0;
  let lastAllowedCutIdx = -1;

  // Walk backwards from newest
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];

    // Skip compaction entries themselves
    if (entry.type === "compaction") continue;

    if (entry.type === "item") {
      const item = entry.item;

      // Check if this is an allowed cut point (user or assistant message)
      // Allowing assistant messages as cut points ensures we can still compact
      // sessions with only a single user message at the start.
      if (isUserMessageItem(item) || isAssistantMessageItem(item)) {
        lastAllowedCutIdx = i;
      }

      // Accumulate tokens
      accumulatedTokens += estimateItemTokens(item);

      // If we've accumulated enough tokens, stop at the newest user boundary.
      // keepRecentTokens is an upper target: an oversized tool result before
      // that boundary should be compacted instead of retained in full.
      if (accumulatedTokens >= keepRecentTokens && lastAllowedCutIdx >= 0) {
        return lastAllowedCutIdx;
      }
    }
  }

  // If we didn't find a cut point with enough tokens,
  // return the earliest allowed cut point (or 0)
  if (lastAllowedCutIdx >= 0) {
    return lastAllowedCutIdx;
  }

  // No suitable cut point found — compact everything (keep nothing)
  return entries.length;
}

/**
 * Check if compaction is recommended based on current token usage.
 *
 * Returns true if current token count exceeds COMPACT_THRESHOLD of contextWindow.
 */
export function shouldCompact(entries: SessionEntry[], contextWindow = DEFAULT_CONTEXT_WINDOW): boolean {
  const items = entries.filter((e) => e.type === "item").map((e) => (e as SessionItemEntry).item);

  const tokens = estimateTokens(items);
  return tokens > contextWindow * COMPACT_THRESHOLD;
}

/**
 * Get the current token estimate for the session.
 */
export function getCurrentTokens(entries: SessionEntry[]): number {
  const items = entries.filter((e) => e.type === "item").map((e) => (e as SessionItemEntry).item);
  return estimateTokens(items);
}

// ─── Main Compaction Process ───

/**
 * Execute manual compaction on a session.
 *
 * 1. Gets all entries and finds cut point
 * 2. Serializes items before cut point (for context in compaction)
 * 3. Calls client.compact() to generate a summary
 * 4. Stores CompactionEntry in the session
 *
 * After this, buildInput() will emit: [compactionItem, ...items after cut]
 */
export async function compact(
  session: SessionManager,
  client: OpenResponsesClient,
  options: CompactionOptions = {},
): Promise<CompactionResult> {
  const keepRecentTokens = options.keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS;

  // Use effective input (buildInput handles previous compactions).
  // This avoids re-compacting items that are already behind a compaction checkpoint.
  const effectiveInput = session.buildInput();
  const effectiveItems = effectiveInput.items.filter((item) => item.type !== "compaction");

  if (effectiveItems.length === 0) {
    throw new Error("Cannot compact an empty session");
  }

  // Walk backwards from the newest effective item, accumulating tokens.
  // Cut at the first user message after accumulating enough recent tokens.
  let cutIdx = effectiveItems.length;
  let accumulatedTokens = 0;
  let lastUserMessageIdx = -1;

  for (let i = effectiveItems.length - 1; i >= 0; i--) {
    const item = effectiveItems[i];
    const isUserMessage = item.type === "message" && (item as { role: string }).role === "user";

    if (isUserMessage) {
      lastUserMessageIdx = i;
    }

    accumulatedTokens += estimateItemTokens(item);

    if (accumulatedTokens >= keepRecentTokens && lastUserMessageIdx >= 0) {
      cutIdx = lastUserMessageIdx;
      break;
    }
  }

  // Fallback: cut at the earliest user message
  if (cutIdx === effectiveItems.length && lastUserMessageIdx >= 0) {
    cutIdx = lastUserMessageIdx;
  }

  const compactedItems = effectiveItems.slice(0, cutIdx);
  const keptItems = effectiveItems.slice(cutIdx);

  const tokensBefore = estimateTokens(effectiveItems);
  const tokensKept = estimateTokens(keptItems);

  // Find firstKeptEntryId from the session branch.
  // buildInput() returns the same item objects stored in branch entries, so match
  // by identity. Structural matching can select an older duplicate and retain
  // almost the entire session after compaction.
  const branch = session.getBranch();
  let firstKeptEntryId = "root";

  if (keptItems.length > 0) {
    const firstKept = keptItems[0];
    for (const entry of branch) {
      if (entry.type === "item" && (entry as SessionItemEntry).item === firstKept) {
        firstKeptEntryId = entry.id;
        break;
      }
    }
  }

  // If nothing to compact (all items are kept), create a no-op compaction
  if (compactedItems.length === 0) {
    const noOpItem: CompactionSummaryItemParam = {
      type: "compaction",
      encrypted_content: "[No context to compact]",
    };

    const entryId = session.appendCompaction("noop", noOpItem, firstKeptEntryId, tokensBefore);

    return {
      compactionItem: noOpItem,
      compactionEntryId: entryId,
      tokensBefore,
      tokensKept: tokensBefore,
      keptItems: keptItems as ItemParam[],
      compactedItems: [],
    };
  }

  // Build compact request
  const instructions =
    options.instructions ??
    `Summarize the following conversation, preserving:
- Key decisions and their rationale
- Files that were modified and what changes were made
- Active tasks and their current status
- Important context that affects future decisions

Focus on what a developer would need to know to continue working. Be concise.`;

  const compactRequest: CompactResponseParams = {
    model: client.getConfig().model,
    input: compactedItems.length > 0 ? (compactedItems as ItemParam[]) : undefined,
    instructions,
    previous_response_id: effectiveInput.previousResponseId ?? undefined,
  };

  // Call compact endpoint
  const compactResponse = await client.compact(compactRequest);

  // Extract compaction item from response
  const compactionOutput = compactResponse.output.find((o) => o.type === "compaction");
  if (compactionOutput?.type !== "compaction") {
    throw new Error("Compact response did not contain a compaction item");
  }

  const compactionItem: CompactionSummaryItemParam = {
    type: "compaction",
    encrypted_content: compactionOutput.encrypted_content,
  };

  // Store in session
  const compactionEntryId = session.appendCompaction(
    compactResponse.id,
    compactionItem,
    firstKeptEntryId,
    tokensBefore,
  );

  return {
    compactionItem,
    compactionEntryId,
    tokensBefore,
    tokensKept,
    keptItems: keptItems as ItemParam[],
    compactedItems: compactedItems as ItemParam[],
  };
}

/**
 * Estimate the token savings from compaction.
 */
export function estimateCompactionSavings(
  entries: SessionEntry[],
  keepRecentTokens = DEFAULT_KEEP_RECENT_TOKENS,
): { totalTokens: number; compactedTokens: number; keptTokens: number; savingsPercent: number } {
  const items = entries.filter((e) => e.type === "item").map((e) => (e as SessionItemEntry).item);

  const totalTokens = estimateTokens(items);
  const firstKeptIdx = findCutPoint(entries, keepRecentTokens);
  const keptItems = entries
    .slice(firstKeptIdx)
    .filter((e) => e.type === "item")
    .map((e) => (e as SessionItemEntry).item);
  const keptTokens = estimateTokens(keptItems);
  const compactedTokens = totalTokens - keptTokens;
  const savingsPercent = totalTokens > 0 ? Math.round((compactedTokens / totalTokens) * 100) : 0;

  return { totalTokens, compactedTokens, keptTokens, savingsPercent };
}
