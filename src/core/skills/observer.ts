/**
 * Workflow Observer — Phase 2
 *
 * Observes user workflows and suggests skills based on repeated patterns.
 * Tracks tool usage sequences and aggregates outcomes.
 *
 * Spec: internal-design-notes § Observer
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ObserverOptions {
  observationsPath: string;
  threshold?: number; // Number of repetitions before suggesting skill
}

export interface ToolSequence {
  tools: string[];
  outcome: "success" | "failure" | "partial";
  timestamp: string;
}

export interface WorkflowPattern {
  patternId: string;
  toolSequence: string[];
  occurrences: number;
  lastSeen: string;
  outcomes: {
    success: number;
    failure: number;
    partial: number;
  };
  suggestedSkillName?: string;
  suppressed?: boolean;
}

export interface ObservationConfig {
  enabled: boolean;
  threshold: number;
  salt?: string;
}

/**
 * Observes user workflows and suggests skills based on patterns.
 */
export class WorkflowObserver {
  private readonly observationsPath: string;
  private readonly threshold: number;
  private readonly salt: string;
  private patterns: Map<string, WorkflowPattern> = new Map();
  private config: ObservationConfig;

  constructor(options: ObserverOptions) {
    this.observationsPath = options.observationsPath;
    this.threshold = options.threshold || 3;
    this.salt = this.generateSalt();

    this.config = {
      enabled: true,
      threshold: this.threshold,
      salt: this.salt,
    };

    if (!existsSync(this.observationsPath)) {
      mkdirSync(this.observationsPath, { recursive: true });
    }

    this.loadPatterns();
  }

  /**
   * Record a tool sequence from an accepted turn.
   */
  recordSequence(sequence: ToolSequence): void {
    if (!this.config.enabled) {
      return;
    }

    // Hash tool sequence for privacy
    const patternKey = this.hashSequence(sequence.tools);

    let pattern = this.patterns.get(patternKey);

    if (!pattern) {
      pattern = {
        patternId: patternKey,
        toolSequence: sequence.tools,
        occurrences: 0,
        lastSeen: new Date().toISOString(),
        outcomes: {
          success: 0,
          failure: 0,
          partial: 0,
        },
      };
    }

    pattern.occurrences++;
    pattern.lastSeen = new Date().toISOString();
    pattern.outcomes[sequence.outcome]++;

    this.patterns.set(patternKey, pattern);
    this.savePatterns();
  }

  /**
   * Get patterns that meet the threshold for skill suggestion.
   */
  getSuggestedPatterns(): WorkflowPattern[] {
    const suggestions: WorkflowPattern[] = [];

    for (const pattern of this.patterns.values()) {
      if (pattern.occurrences >= this.threshold && !pattern.suppressed) {
        suggestions.push(pattern);
      }
    }

    return suggestions.sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Suggest a skill for a pattern.
   */
  suggestSkill(patternId: string, skillName: string): boolean {
    const pattern = this.patterns.get(patternId);
    if (!pattern) {
      return false;
    }

    pattern.suggestedSkillName = skillName;
    this.savePatterns();

    return true;
  }

  /**
   * Suppress a pattern (user rejected suggestion).
   */
  suppressPattern(patternId: string): boolean {
    const pattern = this.patterns.get(patternId);
    if (!pattern) {
      return false;
    }

    pattern.suppressed = true;
    this.savePatterns();

    return true;
  }

  /**
   * Enable or disable observation.
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.saveConfig();
  }

  /**
   * Check if observation is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Update threshold.
   */
  setThreshold(threshold: number): void {
    this.config.threshold = threshold;
    this.saveConfig();
  }

  /**
   * Get current configuration.
   */
  getConfig(): ObservationConfig {
    return { ...this.config };
  }

  /**
   * Clear all observations (opt-out cleanup).
   */
  clear(): void {
    this.patterns.clear();
    this.savePatterns();
  }

  /**
   * Get all patterns (for debugging/testing).
   */
  getAllPatterns(): WorkflowPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Hash tool sequence for privacy.
   */
  private hashSequence(tools: string[]): string {
    const hash = createHash("sha256");
    hash.update(this.salt);
    hash.update(tools.join(","));
    return hash.digest("hex").slice(0, 16);
  }

  /**
   * Generate random salt for hashing.
   */
  private generateSalt(): string {
    return createHash("sha256")
      .update(`${Date.now()}-${Math.random()}`)
      .digest("hex")
      .slice(0, 32);
  }

  /**
   * Load patterns from disk.
   */
  private loadPatterns(): void {
    const patternsPath = join(this.observationsPath, "patterns.json");
    const configPath = join(this.observationsPath, "config.json");

    if (existsSync(configPath)) {
      try {
        const data = JSON.parse(readFileSync(configPath, "utf-8"));
        this.config = data;
      } catch {
        // Use default config
      }
    }

    if (existsSync(patternsPath)) {
      try {
        const data = JSON.parse(readFileSync(patternsPath, "utf-8"));
        const patterns = data.patterns || [];
        for (const pattern of patterns) {
          this.patterns.set(pattern.patternId, pattern);
        }
      } catch {
        // Start with empty patterns
      }
    }
  }

  /**
   * Save patterns to disk.
   */
  private savePatterns(): void {
    const patternsPath = join(this.observationsPath, "patterns.json");
    const data = {
      patterns: Array.from(this.patterns.values()),
    };
    writeFileSync(patternsPath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Save configuration to disk.
   */
  private saveConfig(): void {
    const configPath = join(this.observationsPath, "config.json");
    writeFileSync(configPath, JSON.stringify(this.config, null, 2), "utf-8");
  }
}
