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
