/**
 * CapsuleInvariantChecker — validates capsule invariants for endurance benchmarks.
 *
 * Checks:
 * - Goal preservation (non-empty, consistent across compactions)
 * - Blocker preservation (active blockers not lost)
 * - Artifact ledger validation (files, verification status)
 * - Continuity across multiple compactions
 *
 * Spec: internal-design-notes § Endurance Acceptance
 */

import type { ContextCapsuleEntry } from "../../src/kernel/transcript/types-v2";

// ─── Types ───

export interface CapsuleInvariantViolation {
  /** Field that violated the invariant */
  field: string;
  /** Severity: error = blocking, warning = informational */
  severity: "error" | "warning";
  /** Human-readable message */
  message: string;
  /** Checkpoint ID where violation occurred */
  checkpointId: string;
}

// ─── CapsuleInvariantChecker ───

export class CapsuleInvariantChecker {
  /**
   * Check a single capsule for invariant violations.
   */
  checkCapsule(capsule: ContextCapsuleEntry): CapsuleInvariantViolation[] {
    const violations: CapsuleInvariantViolation[] = [];

    // Check goal
    if (!capsule.portableState.goal || capsule.portableState.goal.trim() === "") {
      violations.push({
        field: "goal",
        severity: "error",
        message: "Goal is empty",
        checkpointId: capsule.checkpointId,
      });
    }

    // Check blockers are preserved
    if (capsule.portableState.blockers.length > 0) {
      // Blockers should be non-empty if present
      for (const blocker of capsule.portableState.blockers) {
        if (!blocker || blocker.trim() === "") {
          violations.push({
            field: "blockers",
            severity: "error",
            message: "Empty blocker found",
            checkpointId: capsule.checkpointId,
          });
        }
      }
    }

    // Check artifact ledger
    if (capsule.artifacts.modifiedFiles.length > 0) {
      // If files were modified, they should be listed
      for (const file of capsule.artifacts.modifiedFiles) {
        if (!file || file.trim() === "") {
          violations.push({
            field: "artifacts.modifiedFiles",
            severity: "error",
            message: "Empty modified file path",
            checkpointId: capsule.checkpointId,
          });
        }
      }
    }

    // Check verification status
    if (capsule.artifacts.verificationStatus === "unknown") {
      violations.push({
        field: "artifacts.verificationStatus",
        severity: "warning",
        message: "Verification status is unknown",
        checkpointId: capsule.checkpointId,
      });
    }

    // Check provenance
    if (!capsule.provenance.firstCompactedEntryId) {
      violations.push({
        field: "provenance.firstCompactedEntryId",
        severity: "error",
        message: "First compacted entry ID is missing",
        checkpointId: capsule.checkpointId,
      });
    }

    if (!capsule.provenance.firstKeptEntryId) {
      violations.push({
        field: "provenance.firstKeptEntryId",
        severity: "error",
        message: "First kept entry ID is missing",
        checkpointId: capsule.checkpointId,
      });
    }

    // Check metrics
    if (capsule.metrics.effectiveTokensBefore <= 0) {
      violations.push({
        field: "metrics.effectiveTokensBefore",
        severity: "error",
        message: "Effective tokens before must be positive",
        checkpointId: capsule.checkpointId,
      });
    }

    if (capsule.metrics.savingsRatio < 0 || capsule.metrics.savingsRatio > 1) {
      violations.push({
        field: "metrics.savingsRatio",
        severity: "error",
        message: "Savings ratio must be between 0 and 1",
        checkpointId: capsule.checkpointId,
      });
    }

    return violations;
  }

  /**
   * Check continuity across a sequence of capsules.
   * Verifies that important state is preserved across compactions.
   */
  checkContinuity(capsules: ContextCapsuleEntry[]): CapsuleInvariantViolation[] {
    const violations: CapsuleInvariantViolation[] = [];

    if (capsules.length === 0) {
      return violations;
    }

    // Check each capsule against the previous one
    for (let i = 1; i < capsules.length; i++) {
      const prev = capsules[i - 1];
      const curr = capsules[i];

      // Goal should be preserved (or evolve, but not disappear)
      if (prev.portableState.goal && !curr.portableState.goal) {
        violations.push({
          field: "continuity.goal",
          severity: "error",
          message: `Goal lost between ${prev.checkpointId} and ${curr.checkpointId}`,
          checkpointId: curr.checkpointId,
        });
      }

      // Blockers should be preserved unless explicitly resolved
      // (We can't detect resolution, so we just check if they disappear)
      const prevBlockers = new Set(prev.portableState.blockers);
      const currBlockers = new Set(curr.portableState.blockers);

      for (const blocker of prevBlockers) {
        if (!currBlockers.has(blocker)) {
          // Blocker disappeared — this might be intentional (resolved)
          // so we log it as a warning, not an error
          violations.push({
            field: "continuity.blockers",
            severity: "warning",
            message: `Blocker "${blocker.slice(0, 50)}..." disappeared between ${prev.checkpointId} and ${curr.checkpointId}`,
            checkpointId: curr.checkpointId,
          });
        }
      }

      // Completed items should accumulate
      const prevCompleted = new Set(prev.portableState.completed);
      const currCompleted = new Set(curr.portableState.completed);

      // Items in prev.completed should still be in curr.completed
      // (unless the goal changed significantly)
      let completedLost = 0;
      for (const item of prevCompleted) {
        if (!currCompleted.has(item)) {
          completedLost++;
        }
      }

      if (completedLost > prevCompleted.size * 0.5) {
        // More than 50% of completed items lost
        violations.push({
          field: "continuity.completed",
          severity: "warning",
          message: `${completedLost} completed items lost between ${prev.checkpointId} and ${curr.checkpointId}`,
          checkpointId: curr.checkpointId,
        });
      }

      // Checkpoint IDs should be unique
      if (prev.checkpointId === curr.checkpointId) {
        violations.push({
          field: "continuity.checkpointId",
          severity: "error",
          message: `Duplicate checkpoint ID: ${curr.checkpointId}`,
          checkpointId: curr.checkpointId,
        });
      }
    }

    return violations;
  }

  /**
   * Check all capsules in a session for both individual and continuity violations.
   */
  checkAll(capsules: ContextCapsuleEntry[]): CapsuleInvariantViolation[] {
    const violations: CapsuleInvariantViolation[] = [];

    // Check individual capsules
    for (const capsule of capsules) {
      violations.push(...this.checkCapsule(capsule));
    }

    // Check continuity
    violations.push(...this.checkContinuity(capsules));

    return violations;
  }

  /**
   * Generate a summary report of violations.
   */
  summarizeViolations(violations: CapsuleInvariantViolation[]): {
    errors: number;
    warnings: number;
    criticalFields: string[];
  } {
    const errors = violations.filter((v) => v.severity === "error").length;
    const warnings = violations.filter((v) => v.severity === "warning").length;

    const criticalFields = Array.from(
      new Set(violations.filter((v) => v.severity === "error").map((v) => v.field)),
    );

    return { errors, warnings, criticalFields };
  }
}
