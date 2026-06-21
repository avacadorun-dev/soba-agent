/**
 * Project Trust Store — Phase 2
 *
 * Manages project-level trust for skill discovery.
 * Project skills are only accessible after explicit trust approval.
 *
 * Spec: internal-design-notes § Project Trust
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectIdentity, ProjectTrustRecord } from "./types";

const TRUST_STORE_FILENAME = "project-trust.json";

export interface ProjectTrustStoreOptions {
  sobaDir: string;
}

interface TrustStoreData {
  version: 1;
  records: Record<string, ProjectTrustRecord>;
}

/**
 * Persistent storage for project trust records.
 * Trust records are stored in ~/.soba/project-trust.json.
 */
export class ProjectTrustStore {
  private readonly storePath: string;
  private data: TrustStoreData;

  constructor(options: ProjectTrustStoreOptions) {
    this.storePath = join(options.sobaDir, TRUST_STORE_FILENAME);
    this.data = this.load();
  }

  /**
   * Compute canonical project identity from a given path.
   * Uses git root if available, otherwise uses realpath of the path.
   */
  static computeProjectIdentity(projectPath: string): ProjectIdentity {
    const realPath = realpathSync(projectPath);
    const gitCommonDir = this.findGitCommonDir(realPath);

    if (gitCommonDir) {
      return {
        canonicalRoot: realpathSync(dirname(gitCommonDir)),
        gitCommonDir,
      };
    }

    return {
      canonicalRoot: realPath,
    };
  }

  /**
   * Find .git directory by walking up from the given path.
   */
  private static findGitCommonDir(startPath: string): string | undefined {
    let current = startPath;
    const visited = new Set<string>();

    while (!visited.has(current)) {
      visited.add(current);
      const gitDir = join(current, ".git");

      if (existsSync(gitDir)) {
        return gitDir;
      }

      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }

    return undefined;
  }

  /**
   * Generate a unique key for a project identity.
   */
  private identityKey(identity: ProjectIdentity): string {
    const parts = [identity.canonicalRoot];
    if (identity.gitCommonDir) {
      parts.push(identity.gitCommonDir);
    }
    return parts.join("|");
  }

  /**
   * Load trust store from disk.
   */
  private load(): TrustStoreData {
    if (!existsSync(this.storePath)) {
      return { version: 1, records: {} };
    }

    try {
      const content = readFileSync(this.storePath, "utf-8");
      const parsed = JSON.parse(content);

      if (parsed.version !== 1 || typeof parsed.records !== "object") {
        console.warn(`Invalid trust store format, resetting: ${this.storePath}`);
        return { version: 1, records: {} };
      }

      return parsed;
    } catch (error) {
      console.warn(`Failed to load trust store, resetting: ${this.storePath}`, error);
      return { version: 1, records: {} };
    }
  }

  /**
   * Save trust store to disk.
   */
  private save(): void {
    const dir = dirname(this.storePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  /**
   * Check if a project is trusted.
   */
  isTrusted(identity: ProjectIdentity): boolean {
    const key = this.identityKey(identity);
    return key in this.data.records;
  }

  /**
   * Get trust record for a project.
   */
  getRecord(identity: ProjectIdentity): ProjectTrustRecord | undefined {
    const key = this.identityKey(identity);
    return this.data.records[key];
  }

  /**
   * Approve a project and save trust record.
   */
  approve(identity: ProjectIdentity, skillsFingerprint: string): ProjectTrustRecord {
    const key = this.identityKey(identity);
    const record: ProjectTrustRecord = {
      project: identity,
      trustedAt: new Date().toISOString(),
      skillsFingerprint,
    };

    this.data.records[key] = record;
    this.save();

    return record;
  }

  /**
   * Revoke trust for a project.
   */
  revoke(identity: ProjectIdentity): boolean {
    const key = this.identityKey(identity);
    if (!(key in this.data.records)) {
      return false;
    }

    delete this.data.records[key];
    this.save();
    return true;
  }

  /**
   * Update skills fingerprint for a trusted project.
   */
  updateFingerprint(identity: ProjectIdentity, skillsFingerprint: string): boolean {
    const key = this.identityKey(identity);
    const record = this.data.records[key];

    if (!record) {
      return false;
    }

    record.skillsFingerprint = skillsFingerprint;
    this.save();
    return true;
  }

  /**
   * Get all trusted projects.
   */
  listTrusted(): ProjectTrustRecord[] {
    return Object.values(this.data.records);
  }
}
