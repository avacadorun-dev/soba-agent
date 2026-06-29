/**
 * Project Trust Store — Phase 2
 *
 * Manages project-level trust for skill discovery.
 * Project skills are only accessible after explicit trust approval.
 *
 * Spec: internal-design-notes § Project Trust
 */

import type { ProjectIdentity, ProjectTrustRecord } from "./types";

export interface ProjectTrustStoreOptions {
  storage: ProjectTrustStorage;
  identityResolver: ProjectIdentityResolver;
}

export interface TrustStoreData {
  version: 1;
  records: Record<string, ProjectTrustRecord>;
}

export interface ProjectTrustStorage {
  load(): TrustStoreData;
  save(data: TrustStoreData): void;
}

export interface ProjectIdentityResolver {
  computeProjectIdentity(projectPath: string): ProjectIdentity;
}

/**
 * Persistent storage for project trust records.
 * Trust records are stored in ~/.soba/project-trust.json.
 */
export class ProjectTrustStore {
  private readonly storage: ProjectTrustStorage;
  private readonly identityResolver: ProjectIdentityResolver;
  private data: TrustStoreData;

  constructor(options: ProjectTrustStoreOptions) {
    this.storage = options.storage;
    this.identityResolver = options.identityResolver;
    this.data = this.storage.load();
  }

  /**
   * Compute canonical project identity from a given path.
   */
  computeProjectIdentity(projectPath: string): ProjectIdentity {
    return this.identityResolver.computeProjectIdentity(projectPath);
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
    this.storage.save(this.data);

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
    this.storage.save(this.data);
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
    this.storage.save(this.data);
    return true;
  }

  /**
   * Get all trusted projects.
   */
  listTrusted(): ProjectTrustRecord[] {
    return Object.values(this.data.records);
  }
}
