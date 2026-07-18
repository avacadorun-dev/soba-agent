/**
 * TriggerPolicy — decides when compaction should run.
 *
 * Evaluates context snapshots against configured thresholds and
 * returns a trigger kind (or null if no compaction is needed).
 *
 * Spec: internal-design-notes § Trigger Policy
 */

import {
  type CapsuleTrigger,
  type CompactionConfig,
  DEFAULT_COMPACTION_CONFIG,
} from "../../kernel/compaction/config";
import type { ContextSnapshot } from "./context-meter";

// ─── Types ───

export type { CapsuleTrigger, CompactionConfig, ConfigValidationResult } from "../../kernel/compaction/config";
export { DEFAULT_COMPACTION_CONFIG, validateCompactionConfig } from "../../kernel/compaction/config";

export interface TriggerDecision {
  shouldCompact: boolean;
  trigger: CapsuleTrigger | null;
  reason: string;
  /** Estimated tokens that could be reclaimed */
  estimatedReclaimableTokens: number;
  /** Estimated savings ratio */
  estimatedSavingsRatio: number;
}

// ─── Config Validation ───

// ─── TriggerPolicy ───

export class TriggerPolicy {
  private config: CompactionConfig;

  constructor(config: Partial<CompactionConfig> = {}) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  }

  /**
   * Evaluate whether blocking compaction is needed before the next inference.
   *
   * Blocking compaction is required when effectiveTokens > hardLimit.
   * This cannot be disabled by auto: false.
   */
  evaluateHardLimit(snapshot: ContextSnapshot): TriggerDecision {
    if (snapshot.effectiveTokens > snapshot.hardLimit) {
      const reclaimable = snapshot.effectiveTokens - this.config.keepRecentTokens;
      const savingsRatio = snapshot.effectiveTokens > 0 ? reclaimable / snapshot.effectiveTokens : 0;
      return {
        shouldCompact: true,
        trigger: "hard_limit",
        reason: `Effective tokens (${snapshot.effectiveTokens}) exceed hard limit (${snapshot.hardLimit})`,
        estimatedReclaimableTokens: Math.max(0, reclaimable),
        estimatedSavingsRatio: Math.max(0, savingsRatio),
      };
    }
    return {
      shouldCompact: false,
      trigger: null,
      reason: "Effective tokens within hard limit",
      estimatedReclaimableTokens: 0,
      estimatedSavingsRatio: 0,
    };
  }

  /** Soft threshold used by every proactive trigger. */
  getSoftLimit(snapshot: ContextSnapshot): number {
    return Math.min(
      snapshot.hardLimit - 1,
      Math.max(
        this.config.minTokensForAutoCompact,
        Math.floor(snapshot.hardLimit * this.config.autoCompactThresholdRatio),
      ),
    );
  }

  evaluateAutoThreshold(snapshot: ContextSnapshot): TriggerDecision {
    if (!this.config.auto) {
      return this._skip("Auto-compact disabled");
    }
    return this._evaluateROI(snapshot, "auto_threshold");
  }

  /**
   * Evaluate whether background compaction should run after turn completion.
   *
   * Requires:
   * - auto: true and compactOnTurnComplete: true
   * - effectiveTokens >= minTokensForAutoCompact
   * - reclaimableTokens >= minReclaimableTokens
   * - savingsRatio >= minSavingsRatio
   */
  evaluateTurnComplete(snapshot: ContextSnapshot): TriggerDecision {
    if (!this.config.auto || !this.config.compactOnTurnComplete) {
      return {
        shouldCompact: false,
        trigger: null,
        reason: "Auto-compact disabled",
        estimatedReclaimableTokens: 0,
        estimatedSavingsRatio: 0,
      };
    }
    return this._evaluateROI(snapshot, "turn_complete");
  }

  /**
   * Evaluate whether background compaction should run on milestone.
   */
  evaluateMilestone(snapshot: ContextSnapshot): TriggerDecision {
    if (!this.config.auto || !this.config.compactOnMilestone) {
      return {
        shouldCompact: false,
        trigger: null,
        reason: "Milestone compact disabled",
        estimatedReclaimableTokens: 0,
        estimatedSavingsRatio: 0,
      };
    }
    return this._evaluateROI(snapshot, "milestone");
  }

  /**
   * Evaluate user-requested compaction (/compact command).
   *
   * Ignores auto-compaction minima (user explicitly requested it).
   * Returns no-op (shouldCompact: false) only if estimatedTokensAfter >= effectiveTokensBefore
   * (i.e., nothing to reclaim).
   */
  evaluateUserRequest(snapshot: ContextSnapshot): TriggerDecision {
    const reclaimable = snapshot.effectiveTokens - this.config.keepRecentTokens;
    if (reclaimable <= 0) {
      return {
        shouldCompact: false,
        trigger: null,
        reason: "No reclaimable context (estimatedTokensAfter >= effectiveTokensBefore)",
        estimatedReclaimableTokens: 0,
        estimatedSavingsRatio: 0,
      };
    }
    const savingsRatio = snapshot.effectiveTokens > 0 ? reclaimable / snapshot.effectiveTokens : 0;
    return {
      shouldCompact: true,
      trigger: "user_request",
      reason: "User requested compaction",
      estimatedReclaimableTokens: reclaimable,
      estimatedSavingsRatio: savingsRatio,
    };
  }

  /**
   * Evaluate context_overflow recovery (after provider returns overflow error).
   *
   * Always triggers compaction regardless of auto setting.
   * This is an emergency recovery path.
   */
  evaluateContextOverflow(snapshot: ContextSnapshot): TriggerDecision {
    const reclaimable = snapshot.effectiveTokens - this.config.keepRecentTokens;
    const savingsRatio = snapshot.effectiveTokens > 0 ? reclaimable / snapshot.effectiveTokens : 0;
    return {
      shouldCompact: true,
      trigger: "context_overflow",
      reason: "Provider returned context overflow error",
      estimatedReclaimableTokens: Math.max(0, reclaimable),
      estimatedSavingsRatio: Math.max(0, savingsRatio),
    };
  }

  /**
   * Get the current config.
   */
  getConfig(): CompactionConfig {
    return { ...this.config };
  }

  /**
   * Update the auto-compact flag at runtime (for /auto-compact on|off command).
   * Does NOT persist to config file.
   */
  setAuto(enabled: boolean): void {
    this.config = { ...this.config, auto: enabled };
  }

  // ─── Private ───

  private _evaluateROI(snapshot: ContextSnapshot, trigger: CapsuleTrigger): TriggerDecision {
    const softLimit = this.getSoftLimit(snapshot);
    if (snapshot.effectiveTokens < softLimit) {
      return {
        shouldCompact: false,
        trigger: null,
        reason: `Effective tokens (${snapshot.effectiveTokens}) below soft limit (${softLimit})`,
        estimatedReclaimableTokens: 0,
        estimatedSavingsRatio: 0,
      };
    }

    const reclaimable = snapshot.effectiveTokens - this.config.keepRecentTokens;
    const savingsRatio = snapshot.effectiveTokens > 0 ? reclaimable / snapshot.effectiveTokens : 0;

    if (reclaimable < this.config.minReclaimableTokens) {
      return {
        shouldCompact: false,
        trigger: null,
        reason: `Reclaimable tokens (${reclaimable}) below minReclaimableTokens (${this.config.minReclaimableTokens})`,
        estimatedReclaimableTokens: reclaimable,
        estimatedSavingsRatio: savingsRatio,
      };
    }

    if (savingsRatio < this.config.minSavingsRatio) {
      return {
        shouldCompact: false,
        trigger: null,
        reason: `Savings ratio (${savingsRatio.toFixed(2)}) below minSavingsRatio (${this.config.minSavingsRatio})`,
        estimatedReclaimableTokens: reclaimable,
        estimatedSavingsRatio: savingsRatio,
      };
    }

    return {
      shouldCompact: true,
      trigger,
      reason: `ROI check passed: ${Math.round(savingsRatio * 100)}% savings estimated`,
      estimatedReclaimableTokens: reclaimable,
      estimatedSavingsRatio: savingsRatio,
    };
  }

  private _skip(reason: string): TriggerDecision {
    return {
      shouldCompact: false,
      trigger: null,
      reason,
      estimatedReclaimableTokens: 0,
      estimatedSavingsRatio: 0,
    };
  }
}
