/**
 * Skill Revisions — Phase 2
 *
 * Manages immutable revision snapshots for skills.
 * Supports history, rollback, and promotion flows.
 *
 * Spec: internal-design-notes § Revisions
 */

import type { EvalResult } from "./evaluator";

export interface RevisionOptions {
  storage: RevisionStorage;
}

export interface SkillRevision {
  revisionId: string;
  skillName: string;
  scope: "project" | "user" | "bundled";
  contentHash: string;
  createdAt: string;
  snapshotPath: string;
  evalResult?: EvalResult;
  approved: boolean;
  approvedAt?: string;
  promotedTo?: string;
  parentRevision?: string;
  metadata?: Record<string, string>;
}

export interface RevisionHistory {
  skillName: string;
  revisions: SkillRevision[];
  currentRevision: string | null;
}

export interface RevisionStorage {
  createSnapshotPath(skillName: string, revisionId: string): string;
  computeContentHash(skillPath: string): string;
  copySkillToSnapshot(skillPath: string, snapshotPath: string): void;
  readRevision(skillName: string, revisionId: string): SkillRevision | null;
  listRevisionIds(skillName: string): string[];
  writeRevision(revision: SkillRevision): void;
}

/**
 * Manages immutable revision snapshots for skills.
 */
export class RevisionStore {
  private readonly storage: RevisionStorage;

  constructor(options: RevisionOptions) {
    this.storage = options.storage;
  }

  /**
   * Create an immutable revision snapshot.
   */
  createSnapshot(
    skillName: string,
    skillPath: string,
    scope: "project" | "user" | "bundled",
    parentRevision?: string,
  ): SkillRevision {
    const contentHash = this.computeContentHash(skillPath);
    const revisionId = `rev_${contentHash.slice(0, 12)}_${Date.now().toString(36)}`;

    // Create snapshot directory
    const snapshotPath = this.storage.createSnapshotPath(skillName, revisionId);

    // Copy skill content to snapshot
    this.storage.copySkillToSnapshot(skillPath, snapshotPath);

    const revision: SkillRevision = {
      revisionId,
      skillName,
      scope,
      contentHash,
      createdAt: new Date().toISOString(),
      snapshotPath,
      approved: false,
      parentRevision,
    };

    this.saveRevision(revision);

    return revision;
  }

  /**
   * Mark a revision as approved.
   */
  approve(revisionId: string, skillName: string): SkillRevision | null {
    const revision = this.getRevision(skillName, revisionId);
    if (!revision) {
      return null;
    }

    revision.approved = true;
    revision.approvedAt = new Date().toISOString();

    this.saveRevision(revision);

    return revision;
  }

  /**
   * Mark a revision as promoted to a target scope.
   */
  markPromoted(revisionId: string, skillName: string, promotedTo: string): SkillRevision | null {
    const revision = this.getRevision(skillName, revisionId);
    if (!revision) {
      return null;
    }

    revision.promotedTo = promotedTo;
    this.saveRevision(revision);

    return revision;
  }

  /**
   * Attach eval result to a revision.
   */
  attachEvalResult(revisionId: string, skillName: string, evalResult: EvalResult): SkillRevision | null {
    const revision = this.getRevision(skillName, revisionId);
    if (!revision) {
      return null;
    }

    revision.evalResult = evalResult;
    this.saveRevision(revision);

    return revision;
  }

  /**
   * Get a specific revision.
   */
  getRevision(skillName: string, revisionId: string): SkillRevision | null {
    return this.storage.readRevision(skillName, revisionId);
  }

  /**
   * Get history for a skill.
   */
  getHistory(skillName: string): RevisionHistory {
    const revisions: SkillRevision[] = [];
    for (const revisionId of this.storage.listRevisionIds(skillName)) {
      const revision = this.getRevision(skillName, revisionId);
      if (revision) {
        revisions.push(revision);
      }
    }

    // Sort by creation time (newest first)
    revisions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // Find current approved revision
    const current = revisions.find((r) => r.approved && r.promotedTo);

    return {
      skillName,
      revisions,
      currentRevision: current?.revisionId || null,
    };
  }

  /**
   * Get the latest approved revision for a skill.
   */
  getLatestApproved(skillName: string): SkillRevision | null {
    const history = this.getHistory(skillName);
    return history.revisions.find((r) => r.approved && r.promotedTo) || null;
  }

  /**
   * Rollback to a previous revision.
   * Creates a new revision based on an old snapshot.
   */
  rollback(skillName: string, targetRevisionId: string): SkillRevision | null {
    const target = this.getRevision(skillName, targetRevisionId);
    if (!target) {
      return null;
    }

    // Get current revision as parent
    const history = this.getHistory(skillName);
    const parentRevision = history.currentRevision || undefined;

    // Create new revision from snapshot
    const newRevision = this.createSnapshot(
      skillName,
      target.snapshotPath,
      target.scope,
      parentRevision,
    );

    return newRevision;
  }

  /**
   * Compute content hash for a skill directory.
   */
  private computeContentHash(skillPath: string): string {
    return this.storage.computeContentHash(skillPath);
  }

  /**
   * Save revision metadata.
   */
  private saveRevision(revision: SkillRevision): void {
    this.storage.writeRevision(revision);
  }
}
