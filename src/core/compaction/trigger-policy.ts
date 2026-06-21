/**
 * TriggerPolicy — decides when compaction should run.
 *
 * Evaluates context snapshots against configured thresholds and
 * returns a trigger kind (or null if no compaction is needed).
 *
 * Spec: internal-design-notes § Trigger Policy
 */

import type { ContextSnapshot } from "./context-meter";

// ─── Types ───

export type CapsuleTrigger =
  | "hard_limit"
  | "context_overflow"
  | "user_request"
  | "turn_complete"
  | "milestone"
  | "plan_pivot";

export interface CompactionConfig {
  /** Enable proactive (background) compaction triggers */
  auto: boolean;
  /** Run background compaction after turn completion */
  compactOnTurnComplete: boolean;
  /** Run background compaction on milestone checkpoint */
  compactOnMilestone: boolean;
  /** Minimum effective tokens before auto-compact is considered */
  minTokensForAutoCompact: number;
  /** Minimum tokens that must be reclaimable for ROI to pass */
  minReclaimableTokens: number;
  /** Minimum savings ratio for ROI to pass */
  minSavingsRatio: number;
  /** Tokens to keep after compaction (recent context window) */
  keepRecentTokens: number;
  /** Safety reserve tokens (subtracted from context window to get hard limit) */
  safetyReserveTokens: number;
  /** Timeout for background compaction operations in ms */
  backgroundTimeoutMs: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  auto: true,
  compactOnTurnComplete: true,
  compactOnMilestone: true,
  minTokensForAutoCompact: 32_000,
  minReclaimableTokens: 12_000,
  minSavingsRatio: 0.25,
  keepRecentTokens: 20_000,
  safetyReserveTokens: 8_192,
  backgroundTimeoutMs: 15_000,
};

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

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate compaction config invariants.
 * Spec requirements:
 *   contextWindow > 0
 *   maxOutputTokens > 0
 *   safetyReserveTokens >= 0
 *   maxOutputTokens + safetyReserveTokens < contextWindow
 *   keepRecentTokens < hardLimit
 */
export function validateCompactionConfig(
  config: CompactionConfig,
  contextWindow: number,
  maxOutputTokens: number,
): ConfigValidationResult {
  const errors: string[] = [];

  if (contextWindow <= 0) {
    errors.push("contextWindow must be > 0");
  }
  if (maxOutputTokens <= 0) {
    errors.push("maxOutputTokens must be > 0");
  }
  if (config.safetyReserveTokens < 0) {
    errors.push("safetyReserveTokens must be >= 0");
  }
  if (contextWindow > 0 && maxOutputTokens > 0 && maxOutputTokens + config.safetyReserveTokens >= contextWindow) {
    errors.push("maxOutputTokens + safetyReserveTokens must be < contextWindow");
  }

  const hardLimit = contextWindow - maxOutputTokens - config.safetyReserveTokens;
  if (hardLimit > 0 && config.keepRecentTokens >= hardLimit) {
    errors.push("keepRecentTokens must be < hardLimit (contextWindow - maxOutputTokens - safetyReserveTokens)");
  }

  return { valid: errors.length === 0, errors };
}

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
    if (snapshot.effectiveTokens < this.config.minTokensForAutoCompact) {
      return {
        shouldCompact: false,
        trigger: null,
        reason: `Effective tokens (${snapshot.effectiveTokens}) below minTokensForAutoCompact (${this.config.minTokensForAutoCompact})`,
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
}
