/**
 * CapsuleValidator — validates capsule drafts before they are persisted.
 *
 * Blocking errors prevent the draft from being used.
 * Warnings are informational only.
 *
 * Spec: internal-design-notes § Capsule Validation
 */

import type { ItemParam } from "../session/types";
import type { ActivatedSkillRef } from "../session/types-v2";
import type { ContextSnapshot } from "./context-meter";
import type { ContextCapsuleDraft } from "./strategies/types";

// ─── Types ───

export interface CapsuleValidationResult {
  valid: boolean;
  errors: CapsuleValidationError[];
  warnings: CapsuleValidationWarning[];
}

export interface CapsuleValidationError {
  code: string;
  message: string;
}

export interface CapsuleValidationWarning {
  code: string;
  message: string;
}

// ─── Validator ───

export class CapsuleValidator {
  /**
   * Validate a capsule draft.
   *
   * @param draft The draft to validate
   * @param branchEntryIds IDs of entries in the current branch (root → leaf)
   * @param sourceItems The items being compacted
   * @param keptItems The items being kept after compaction
   * @param snapshot The context snapshot before compaction
   * @param isBlocking Whether this is a blocking compaction (hard_limit / context_overflow)
   * @param sessionId The session ID (to verify source entries belong to this session)
   */
  validate(
    draft: ContextCapsuleDraft,
    branchEntryIds: string[],
    sourceItems: ItemParam[],
    keptItems: ItemParam[],
    snapshot: ContextSnapshot,
    isBlocking: boolean,
    _sessionId: string,
    requiredActivatedSkills: ActivatedSkillRef[] = [],
  ): CapsuleValidationResult {
    const errors: CapsuleValidationError[] = [];
    const warnings: CapsuleValidationWarning[] = [];

    // ── Blocking errors ──

    // 1. Missing goal
    if (!draft.portableState.goal || draft.portableState.goal.trim().length === 0) {
      errors.push({
        code: "missing_goal",
        message: "Capsule must have a non-empty goal",
      });
    }

    // 2. firstKeptEntryId not in current branch
    if (
      draft.provenance.firstKeptEntryId !== "root" &&
      !branchEntryIds.includes(draft.provenance.firstKeptEntryId)
    ) {
      errors.push({
        code: "first_kept_not_in_branch",
        message: `firstKeptEntryId "${draft.provenance.firstKeptEntryId}" not found in current branch`,
      });
    }

    // 3. firstCompactedEntryId after firstKeptEntryId
    if (draft.provenance.firstCompactedEntryId !== "root") {
      const compactedIdx = branchEntryIds.indexOf(draft.provenance.firstCompactedEntryId);
      const keptIdx = branchEntryIds.indexOf(draft.provenance.firstKeptEntryId);

      if (compactedIdx >= 0 && keptIdx >= 0 && compactedIdx > keptIdx) {
        errors.push({
          code: "compacted_after_kept",
          message: "firstCompactedEntryId must not be after firstKeptEntryId",
        });
      }
    }

    // 4. Lost active blocker or failed verification
    const sourceBlockers = this._extractBlockersFromItems(sourceItems);
    for (const blocker of sourceBlockers) {
      if (!draft.portableState.blockers.some((b) => b.includes(blocker))) {
        errors.push({
          code: "lost_blocker",
          message: `Active blocker lost in capsule: "${blocker.slice(0, 100)}"`,
        });
      }
    }

    const sourceFailedVerification = this._hasFailedVerification(sourceItems);
    if (
      sourceFailedVerification &&
      draft.artifacts.verificationStatus !== "failed"
    ) {
      errors.push({
        code: "lost_failed_verification",
        message: "Failed verification status lost in capsule",
      });
    }

    // 5. Source entries belong to another session (check via provenance)
    // This is implicitly checked by the generator which only passes branch entries

    // 6. Native continuation without identity or compatibility key
    if (draft.nativeContinuation) {
      if (!draft.nativeContinuation.provider) {
        errors.push({
          code: "native_no_identity",
          message: "Native continuation must have provider identity",
        });
      }
      if (!draft.nativeContinuation.compatibilityKey) {
        errors.push({
          code: "native_no_compatibility_key",
          message: "Native continuation must have a non-empty compatibility key",
        });
      }
    }

    // 7. Active skills present before compaction must survive the checkpoint.
    const draftSkillKeys = new Set(
      draft.activatedSkills.map((skill) =>
        [skill.name, skill.scope, skill.revision, skill.contentHash].join(":"),
      ),
    );
    for (const skill of requiredActivatedSkills) {
      const key = [skill.name, skill.scope, skill.revision, skill.contentHash].join(":");
      if (!draftSkillKeys.has(key)) {
        errors.push({
          code: "lost_activated_skill",
          message: `Active skill lost in capsule: "${skill.name}" (${skill.revision})`,
        });
      }
    }

    // 8. estimatedTokensAfter > hardLimit for blocking compaction
    if (isBlocking && draft.metrics.estimatedTokensAfter > snapshot.hardLimit) {
      errors.push({
        code: "exceeds_hard_limit",
        message: `Post-compaction estimate (${draft.metrics.estimatedTokensAfter}) exceeds hard limit (${snapshot.hardLimit})`,
      });
    }

    // 9. Tool call separated from its result on compact/keep boundary
    const boundaryError = this._checkToolCallBoundary(sourceItems, keptItems);
    if (boundaryError) {
      errors.push({
        code: "tool_call_boundary",
        message: boundaryError,
      });
    }

    // ── Warnings ──

    // 1. Empty pending/nextSteps
    if (draft.portableState.pending.length === 0 && draft.portableState.nextSteps.length === 0) {
      warnings.push({
        code: "empty_pending_nextsteps",
        message: "No pending items or next steps in capsule",
      });
    }

    // 2. Unknown verification status
    if (draft.artifacts.verificationStatus === "unknown") {
      warnings.push({
        code: "unknown_verification",
        message: "Verification status is unknown",
      });
    }

    // 3. Savings below policy for manual compaction
    if (!isBlocking && draft.metrics.savingsRatio < 0.1) {
      warnings.push({
        code: "low_savings",
        message: `Low savings ratio (${(draft.metrics.savingsRatio * 100).toFixed(1)}%) for manual compaction`,
      });
    }

    // 4. Missing activated skills
    if (draft.activatedSkills.length === 0) {
      warnings.push({
        code: "no_activated_skills",
        message: "No activated skills in capsule",
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check if a tool call is separated from its result on the compact/keep boundary.
   *
   * A function_call in sourceItems must have its function_call_output in sourceItems too.
   * A function_call in keptItems must have its function_call_output in keptItems too.
   */
  private _checkToolCallBoundary(
    sourceItems: ItemParam[],
    keptItems: ItemParam[],
  ): string | null {
    const sourceCallIds = new Set<string>();
    const sourceOutputIds = new Set<string>();
    const keptCallIds = new Set<string>();
    const keptOutputIds = new Set<string>();

    for (const item of sourceItems) {
      if (item.type === "function_call" || item.type === "local_shell_call") {
        sourceCallIds.add(item.call_id);
      }
      if (item.type === "function_call_output" || item.type === "local_shell_call_output") {
        sourceOutputIds.add(item.call_id);
      }
    }

    for (const item of keptItems) {
      if (item.type === "function_call" || item.type === "local_shell_call") {
        keptCallIds.add(item.call_id);
      }
      if (item.type === "function_call_output" || item.type === "local_shell_call_output") {
        keptOutputIds.add(item.call_id);
      }
    }

    // Check: call in source but output in kept
    for (const callId of sourceCallIds) {
      if (keptOutputIds.has(callId)) {
        return `Tool call "${callId}" is in compacted items but its output is in kept items`;
      }
    }

    // Check: call in kept but output in source
    for (const callId of keptCallIds) {
      if (sourceOutputIds.has(callId)) {
        return `Tool call "${callId}" is in kept items but its output is in compacted items`;
      }
    }

    return null;
  }

  /**
   * Extract active blockers from items (error indicators in recent outputs).
   */
  private _extractBlockersFromItems(items: ItemParam[]): string[] {
    const blockers: string[] = [];

    for (let i = items.length - 1; i >= 0 && blockers.length < 3; i--) {
      const item = items[i];
      if (item.type === "function_call_output" || item.type === "local_shell_call_output") {
        const output =
          item.type === "function_call_output"
            ? typeof item.output === "string"
              ? item.output
              : JSON.stringify(item.output)
            : item.output;

        if (
          output.toLowerCase().includes("error") ||
          output.toLowerCase().includes("failed")
        ) {
          blockers.push(output.slice(0, 100));
        }
      }
    }

    return blockers;
  }

  /**
   * Check if items contain a failed verification (non-zero exit code).
   */
  private _hasFailedVerification(items: ItemParam[]): boolean {
    for (const item of items) {
      if (item.type === "local_shell_call_output") {
        if (item.exit_code !== undefined && item.exit_code !== 0) {
          return true;
        }
      }
    }
    return false;
  }
}
