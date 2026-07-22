/**
 * ContextMeter — measures effective token usage for context management.
 *
 * Tracks provider usage watermarks and estimates trailing tokens.
 * Spec: internal-design-notes § Context Meter
 */

import { buildContextCapsuleInput } from "../../kernel/session/context-capsule-input";
import { estimateTokens } from "../../kernel/session/estimation";
import type { ItemParam, SessionEntry, SessionItemEntry } from "../../kernel/transcript/types";
import type { ContextCapsuleEntry } from "../../kernel/transcript/types-v2";
import { isContextCapsuleEntry } from "../../kernel/transcript/types-v2";

// ─── Types ───

export interface ContextMeasurementWatermark {
  measuredThroughEntryId: string | null;
  requestFingerprint: string;
}

/**
 * A snapshot of the current context state.
 *
 * When source = "provider_usage":
 *   effectiveTokens = providerInputTokens + estimatedTrailingTokens
 *
 * When source = "estimated":
 *   providerInputTokens = 0
 *   estimatedTrailingTokens = full local estimate of the effective request
 *   effectiveTokens = estimatedTrailingTokens
 */
export interface ContextSnapshot {
  source: "provider_usage" | "estimated";
  providerInputTokens: number;
  estimatedTrailingTokens: number;
  effectiveTokens: number;
  historicalTokens: number;
  systemPromptTokens: number;
  toolSchemaTokens: number;
  contextWindow: number;
  maxOutputTokens: number;
  safetyReserveTokens: number;
  hardLimit: number;
  watermark?: ContextMeasurementWatermark;
}

// ─── ContextMeter ───

export class ContextMeter {
  private _providerInputTokens: number;
  private _watermark: ContextMeasurementWatermark | undefined;
  private _contextWindow: number;
  private _maxOutputTokens: number;
  private _safetyReserveTokens: number;
  private _providerCompatibilityKey?: string;

  constructor(
    contextWindow: number,
    maxOutputTokens: number,
    safetyReserveTokens: number,
    providerCompatibilityKey?: string,
  ) {
    this._providerInputTokens = 0;
    this._watermark = undefined;
    this._contextWindow = contextWindow;
    this._maxOutputTokens = maxOutputTokens;
    this._safetyReserveTokens = safetyReserveTokens;
    this._providerCompatibilityKey = providerCompatibilityKey;
  }

  /**
   * Record provider usage from a completed inference.
   *
   * @param inputTokens Actual input tokens reported by provider
   * @param measuredThroughEntryId The last session entry ID included in this request
   * @param requestFingerprint Hash of system prompt + tools + skills (non-session parts)
   */
  recordProviderUsage(inputTokens: number, measuredThroughEntryId: string | null, requestFingerprint: string): void {
    this._providerInputTokens = inputTokens;
    this._watermark = { measuredThroughEntryId, requestFingerprint };
  }

  /**
   * Invalidate the provider watermark (e.g., when system prompt or tools change).
   * Next snapshot will use "estimated" source.
   */
  invalidateWatermark(): void {
    this._watermark = undefined;
    this._providerInputTokens = 0;
  }

  /** Apply limits for a newly selected model or refreshed provider profile. */
  updateLimits(contextWindow: number, maxOutputTokens: number): void {
    this._contextWindow = Math.max(1, Math.trunc(contextWindow));
    this._maxOutputTokens = Math.max(1, Math.trunc(maxOutputTokens));
    this.invalidateWatermark();
  }

  /**
   * Compute a context snapshot for the current session branch.
   *
   * @param branch Current session branch entries (root → leaf)
   * @param currentFingerprint Current request fingerprint
   * @param systemPromptTokens Estimated system prompt tokens
   * @param toolSchemaTokens Estimated tool schema tokens
   * @param additionalNonSessionTokens Extra non-session tokens (skill messages, etc.)
   */
  snapshot(
    branch: SessionEntry[],
    currentFingerprint: string,
    systemPromptTokens: number,
    toolSchemaTokens: number,
    additionalNonSessionTokens = 0,
  ): ContextSnapshot {
    const hardLimit = this._contextWindow - this._maxOutputTokens - this._safetyReserveTokens;

    // Historical tokens: estimate all conversation tree entries
    const historicalTokens = this._estimateHistoricalTokens(branch);

    // Check if provider watermark is valid
    const watermarkValid =
      this._watermark !== undefined && this._watermark.requestFingerprint === currentFingerprint;

    if (watermarkValid && this._watermark) {
      // Provider-based measurement: find trailing items after watermark
      const trailingTokens = this._estimateTrailingTokens(branch, this._watermark.measuredThroughEntryId);

      return {
        source: "provider_usage",
        providerInputTokens: this._providerInputTokens,
        estimatedTrailingTokens: trailingTokens,
        effectiveTokens: this._providerInputTokens + trailingTokens,
        historicalTokens,
        systemPromptTokens,
        toolSchemaTokens,
        contextWindow: this._contextWindow,
        maxOutputTokens: this._maxOutputTokens,
        safetyReserveTokens: this._safetyReserveTokens,
        hardLimit,
        watermark: this._watermark,
      };
    }

    // Estimated: full local estimate of the effective request
    const effectiveItems = this._getEffectiveItems(branch);
    const sessionTokens = estimateTokens(effectiveItems);
    const estimatedTotal = systemPromptTokens + toolSchemaTokens + additionalNonSessionTokens + sessionTokens;

    return {
      source: "estimated",
      providerInputTokens: 0,
      estimatedTrailingTokens: estimatedTotal,
      effectiveTokens: estimatedTotal,
      historicalTokens,
      systemPromptTokens,
      toolSchemaTokens,
      contextWindow: this._contextWindow,
      maxOutputTokens: this._maxOutputTokens,
      safetyReserveTokens: this._safetyReserveTokens,
      hardLimit,
      watermark: this._watermark,
    };
  }

  // ─── Private helpers ───

  /**
   * Estimate tokens for all conversation entries (for audit / historicalTokens).
   * Does not include sidecar entries (debug, cursor, migration).
   */
  private _estimateHistoricalTokens(branch: SessionEntry[]): number {
    const items: ItemParam[] = [];
    for (const entry of branch) {
      if (entry.type === "item") {
        items.push((entry as SessionItemEntry).item);
      } else if (isContextCapsuleEntry(entry as { type: string })) {
        // Capsule contributes its metrics to historical
        const capsule = entry as unknown as ContextCapsuleEntry;
        // Use the estimated tokens after as a proxy for the capsule's "size"
        // (the actual items it replaced are no longer in the branch)
        items.push({
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: `[Context Capsule ${capsule.checkpointId}]`,
            },
          ],
        });
      }
    }
    return estimateTokens(items);
  }

  /**
   * Estimate trailing tokens: items added after the watermark entry.
   */
  private _estimateTrailingTokens(branch: SessionEntry[], measuredThroughEntryId: string | null): number {
    if (measuredThroughEntryId === null) {
      // No watermark entry: all items are trailing
      return estimateTokens(this._getEffectiveItems(branch));
    }

    const watermarkIdx = branch.findIndex((e) => e.id === measuredThroughEntryId);
    if (watermarkIdx === -1) {
      // Watermark entry not in current branch: full estimate
      return estimateTokens(this._getEffectiveItems(branch));
    }

    const trailingEntries = branch.slice(watermarkIdx + 1);
    const trailingItems = trailingEntries
      .filter((e) => e.type === "item")
      .map((e) => (e as SessionItemEntry).item);

    return estimateTokens(trailingItems);
  }

  /**
   * Get the effective items from the branch, respecting context capsule boundaries.
   *
   * If a context capsule exists in the branch, only items from firstKeptEntryId
   * onwards are returned (items before the capsule were already compacted).
   * This mirrors the logic in SessionManager.buildInput().
   *
   * Without this, after compaction the meter would still count ALL items in the
   * branch (including those already compacted), causing effective tokens to never
   * decrease and the agent to get stuck in a "hard limit exceeded" loop.
   */
  private _getEffectiveItems(branch: SessionEntry[]): ItemParam[] {
    // Find the last context capsule in the branch
    let lastCapsule: ContextCapsuleEntry | null = null;
    for (let i = branch.length - 1; i >= 0; i--) {
      if (isContextCapsuleEntry(branch[i] as { type: string })) {
        lastCapsule = branch[i] as unknown as ContextCapsuleEntry;
        break;
      }
    }

    if (!lastCapsule) {
      // No capsule: return all items
      return branch.filter((e) => e.type === "item").map((e) => (e as SessionItemEntry).item);
    }

    const items = buildContextCapsuleInput(lastCapsule, this._providerCompatibilityKey);

    // Capsule found: prepend its exact model input, then retain items from firstKeptEntryId onwards.
    const firstKeptEntryId = lastCapsule.provenance?.firstKeptEntryId;
    if (!firstKeptEntryId || firstKeptEntryId === "root") {
      // No kept entries specified — capsule compacted everything except its own continuation state.
      return items;
    }

    const firstKeptIdx = branch.findIndex((e) => e.id === firstKeptEntryId);
    if (firstKeptIdx === -1) {
      // firstKeptEntryId not found in branch — fall back to all items after capsule
      const capsuleIdx = branch.findIndex((e) => e.id === (lastCapsule as ContextCapsuleEntry).id);
      if (capsuleIdx === -1) {
        return branch.filter((e) => e.type === "item").map((e) => (e as SessionItemEntry).item);
      }
      items.push(...branch
        .slice(capsuleIdx + 1)
        .filter((e) => e.type === "item")
        .map((e) => (e as SessionItemEntry).item));
      return items;
    }

    items.push(...branch
      .slice(firstKeptIdx)
      .filter((e) => e.type === "item")
      .map((e) => (e as SessionItemEntry).item));
    return items;
  }

  // ─── Getters ───

  get contextWindow(): number {
    return this._contextWindow;
  }

  get maxOutputTokens(): number {
    return this._maxOutputTokens;
  }

  get safetyReserveTokens(): number {
    return this._safetyReserveTokens;
  }

  get hardLimit(): number {
    return this._contextWindow - this._maxOutputTokens - this._safetyReserveTokens;
  }

  get watermark(): ContextMeasurementWatermark | undefined {
    return this._watermark;
  }
}
