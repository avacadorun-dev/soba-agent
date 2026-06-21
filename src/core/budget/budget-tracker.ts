/**
 * Budget Tracker.
 *
 * Tracks token usage across turns and provides budget warnings.
 * Integrates with AgentLoop to provide budget_update events.
 */

// ─── Types ───

export interface BudgetConfig {
  /** Total token budget (0 = unlimited) */
  totalBudget: number;
  /** Warning threshold percentages */
  warningThresholds: number[];
}

export interface BudgetStatus {
  usedTokens: number;
  totalBudget: number;
  percentage: number;
  isExceeded: boolean;
  isWarning: boolean;
  warningLevel?: number; // which threshold was crossed (0, 1, 2...)
  remainingTokens: number;
}

// ─── Defaults ───

const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  totalBudget: 0,
  warningThresholds: [80, 90, 95],
};

// ─── Budget Tracker ───

export class BudgetTracker {
  private config: BudgetConfig;
  private usedTokens = 0;
  private lastWarningLevel = -1;

  constructor(config?: Partial<BudgetConfig>) {
    this.config = { ...DEFAULT_BUDGET_CONFIG, ...config };
  }

  /** Reset usage to zero */
  reset(): void {
    this.usedTokens = 0;
    this.lastWarningLevel = -1;
  }

  /** Add tokens from a response */
  addUsage(inputTokens: number, outputTokens: number): BudgetStatus {
    this.usedTokens += inputTokens + outputTokens;
    return this.getStatus();
  }

  /** Get current budget status */
  getStatus(): BudgetStatus {
    if (this.config.totalBudget <= 0) {
      return {
        usedTokens: this.usedTokens,
        totalBudget: 0,
        percentage: 0,
        isExceeded: false,
        isWarning: false,
        remainingTokens: Number.POSITIVE_INFINITY,
      };
    }

    const percentage = Math.round((this.usedTokens / this.config.totalBudget) * 100);
    const isExceeded = this.usedTokens >= this.config.totalBudget;

    // Find highest warning threshold that has been crossed
    let isWarning = false;
    let warningLevel: number | undefined;

    for (let i = this.config.warningThresholds.length - 1; i >= 0; i--) {
      if (percentage >= this.config.warningThresholds[i]) {
        if (i > this.lastWarningLevel) {
          this.lastWarningLevel = i;
          warningLevel = i;
        }
        isWarning = true;
        break;
      }
    }

    // Reset warning level if usage drops below thresholds
    if (!isWarning) {
      this.lastWarningLevel = -1;
    }

    return {
      usedTokens: this.usedTokens,
      totalBudget: this.config.totalBudget,
      percentage,
      isExceeded,
      isWarning: isWarning && this.lastWarningLevel >= 0,
      warningLevel,
      remainingTokens: Math.max(0, this.config.totalBudget - this.usedTokens),
    };
  }

  /** Update the budget limit */
  setBudget(totalBudget: number): void {
    this.config.totalBudget = totalBudget;
  }

  /** Format token count as human-readable string */
  static formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
    return String(tokens);
  }

  /** Get a human-readable budget status message */
  getStatusMessage(): string {
    const status = this.getStatus();

    if (status.totalBudget <= 0) {
      return `${BudgetTracker.formatTokens(status.usedTokens)} tokens used`;
    }

    const pct = status.percentage;
    if (status.isExceeded) {
      return `⚠️  Budget exceeded: ${BudgetTracker.formatTokens(status.usedTokens)}/${BudgetTracker.formatTokens(status.totalBudget)} (${pct}%)`;
    }
    if (pct >= 95) {
      return `🔴 ${BudgetTracker.formatTokens(status.usedTokens)}/${BudgetTracker.formatTokens(status.totalBudget)} (${pct}%) — critical!`;
    }
    if (pct >= 90) {
      return `🟡 ${BudgetTracker.formatTokens(status.usedTokens)}/${BudgetTracker.formatTokens(status.totalBudget)} (${pct}%) — nearing limit`;
    }
    if (pct >= 80) {
      return `🔵 ${BudgetTracker.formatTokens(status.usedTokens)}/${BudgetTracker.formatTokens(status.totalBudget)} (${pct}%)`;
    }
    return `${BudgetTracker.formatTokens(status.usedTokens)}/${BudgetTracker.formatTokens(status.totalBudget)} (${pct}%)`;
  }
}
