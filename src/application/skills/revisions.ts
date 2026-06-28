/**
 * Skill Revisions — Phase 2
 *
 * Manages immutable revision snapshots for skills.
 * Supports history, rollback, and promotion flows.
 *
 * Spec: internal-design-notes § Revisions
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalResult } from "./evaluator";

export interface RevisionOptions {
  revisionsPath: string;
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

/**
 * Manages immutable revision snapshots for skills.
 */
export class RevisionStore {
  private readonly revisionsPath: string;

  constructor(options: RevisionOptions) {
    this.revisionsPath = options.revisionsPath;
    if (!existsSync(this.revisionsPath)) {
      mkdirSync(this.revisionsPath, { recursive: true });
    }
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
    const snapshotPath = join(this.revisionsPath, skillName, revisionId);
    mkdirSync(snapshotPath, { recursive: true });

    // Copy skill content to snapshot
    this.copySkillToSnapshot(skillPath, snapshotPath);

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
    const revisionPath = join(this.revisionsPath, skillName, revisionId, ".revision.json");

    if (!existsSync(revisionPath)) {
      return null;
    }

    try {
      const data = JSON.parse(readFileSync(revisionPath, "utf-8"));
      return data as SkillRevision;
    } catch {
      return null;
    }
  }

  /**
   * Get history for a skill.
   */
  getHistory(skillName: string): RevisionHistory {
    const skillRevisionsPath = join(this.revisionsPath, skillName);

    if (!existsSync(skillRevisionsPath)) {
      return {
        skillName,
        revisions: [],
        currentRevision: null,
      };
    }

    const revisions: SkillRevision[] = [];
    const entries = readdirSync(skillRevisionsPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const revision = this.getRevision(skillName, entry.name);
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
    const hash = createHash("sha256");
    const files: Array<{ relativePath: string; content: Buffer }> = [];

    const walk = (dir: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const relativePath = fullPath.slice(skillPath.length + 1);
          const content = readFileSync(fullPath);
          files.push({ relativePath, content });
        }
      }
    };

    walk(skillPath);

    // Sort by relative path for deterministic hashing
    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    for (const file of files) {
      hash.update(file.relativePath);
      hash.update(file.content);
    }

    return hash.digest("hex");
  }

  /**
   * Copy skill content to snapshot directory.
   */
  private copySkillToSnapshot(sourcePath: string, snapshotPath: string): void {
    const walk = (dir: string, relativeTo: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = fullPath.slice(relativeTo.length + 1);
        const targetPath = join(snapshotPath, relativePath);

        if (entry.isDirectory()) {
          mkdirSync(targetPath, { recursive: true });
          walk(fullPath, relativeTo);
        } else if (entry.isFile()) {
          const content = readFileSync(fullPath);
          writeFileSync(targetPath, content);
        }
      }
    };

    walk(sourcePath, sourcePath);
  }

  /**
   * Save revision metadata.
   */
  private saveRevision(revision: SkillRevision): void {
    const revisionPath = join(revision.snapshotPath, ".revision.json");
    writeFileSync(revisionPath, JSON.stringify(revision, null, 2), "utf-8");
  }
}
