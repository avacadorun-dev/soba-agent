/**
 * Skills System Types — Phase 2
 *
 * Defines contracts for skill discovery, validation, catalog, and trust.
 * Spec: internal-design-notes § Skills Contract
 */

// ─── Skill Metadata ───

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  soba?: SobaSkillMetadata;
  allowedTools?: string[];
}

export type SobaSkillMemoryPolicy = "none" | "read" | "write" | "read-write";

export interface SobaSkillMetadata {
  version?: number;
  triggers?: string[];
  requiredSections?: string[];
  disableModelInvocation?: boolean;
  memoryPolicy?: SobaSkillMemoryPolicy;
}

export interface SkillDiagnostic {
  code: string;
  severity: "warning" | "error";
  message: string;
  path?: string;
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  location: string;
  scope: "project" | "user" | "bundled";
  trusted: boolean;
  enabled: boolean;
  revision?: string;
  contentHash?: string;
  modelInvocable: boolean;
  diagnostics: SkillDiagnostic[];
  /** Absolute path to skill directory */
  skillPath: string;
  /** Parsed frontmatter */
  frontmatter: SkillFrontmatter;
}

// ─── Project Trust ───

export interface ProjectIdentity {
  /** Canonical realpath of project root (git root or cwd) */
  canonicalRoot: string;
  /** Git common directory if in a git repository */
  gitCommonDir?: string;
}

export interface ProjectTrustRecord {
  project: ProjectIdentity;
  trustedAt: string;
  /** Content hash of skill tree at approval time */
  skillsFingerprint: string;
}

// ─── Discovery ───

export interface SkillLocation {
  path: string;
  scope: "project" | "user" | "bundled";
}

export interface DiscoveryResult {
  skills: SkillCatalogEntry[];
  diagnostics: SkillDiagnostic[];
}

// ─── Validation ───

export interface ValidationResult {
  valid: boolean;
  errors: SkillDiagnostic[];
  warnings: SkillDiagnostic[];
  frontmatter?: SkillFrontmatter;
}

export interface SkillValidationOptions {
  scope?: "project" | "user" | "bundled";
  files?: import("./validator").SkillValidationFilesystem;
}

// ─── Activation ───

export interface ActivateSkillArgs {
  name: string;
  revision?: string;
}

export interface ActivationResult {
  success: boolean;
  skill?: SkillCatalogEntry;
  error?: string;
  diagnostics: SkillDiagnostic[];
}

// ─── Constants ───

/** Valid skill name pattern: lowercase-hyphen-name */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
export const MAX_COMPATIBILITY_LENGTH = 500;

/** SOBA-specific metadata prefix */
export const SOBA_METADATA_PREFIX = "soba.";
