/**
 * Skill Discovery — Phase 2
 *
 * Scans project, user, and bundled locations for skills.
 * Respects project trust and precedence rules.
 * Spec: internal-design-notes § Skills Contract
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ProjectTrustStore } from "./project-trust-store";
import type {
  DiscoveryResult,
  SkillCatalogEntry,
  SkillDiagnostic,
  SkillLocation,
} from "./types";
import { computeSkillContentHash, validateSkill } from "./validator";

export interface SkillDiscoveryOptions {
  /** Project root path */
  projectPath: string;
  /** User skills directory (~/.soba/skills) */
  userSkillsPath: string;
  /** Bundled skills directory */
  bundledSkillsPath?: string;
  /** Project trust store */
  trustStore: ProjectTrustStore;
}

/**
 * Discovers skills from all configured locations.
 */
export class SkillDiscovery {
  private readonly options: SkillDiscoveryOptions;

  constructor(options: SkillDiscoveryOptions) {
    this.options = options;
  }

  /**
   * Scan all locations and return discovered skills.
   */
  discover(): DiscoveryResult {
    const skills: SkillCatalogEntry[] = [];
    const diagnostics: SkillDiagnostic[] = [];

    // Check project trust
    const projectIdentity = ProjectTrustStore.computeProjectIdentity(this.options.projectPath);
    const isProjectTrusted = this.options.trustStore.isTrusted(projectIdentity);

    // Discover from each location with precedence: bundled < user < project
    const locations: SkillLocation[] = [];

    // Bundled skills (lowest precedence)
    if (this.options.bundledSkillsPath && existsSync(this.options.bundledSkillsPath)) {
      locations.push({ path: this.options.bundledSkillsPath, scope: "bundled" });
    }

    // User skills
    if (this.options.userSkillsPath && existsSync(this.options.userSkillsPath)) {
      locations.push({ path: this.options.userSkillsPath, scope: "user" });
    }

    // Project skills (highest precedence, only if trusted)
    if (isProjectTrusted) {
      const projectSkillsPath = join(this.options.projectPath, ".soba", "skills");
      if (existsSync(projectSkillsPath)) {
        locations.push({ path: projectSkillsPath, scope: "project" });
      }

      // Also check .agents/skills for cross-agent compatibility
      const agentsSkillsPath = join(this.options.projectPath, ".agents", "skills");
      if (existsSync(agentsSkillsPath)) {
        locations.push({ path: agentsSkillsPath, scope: "project" });
      }
    } else {
      // Report untrusted project skills without reading them
      const projectSkillsPath = join(this.options.projectPath, ".soba", "skills");
      const agentsSkillsPath = join(this.options.projectPath, ".agents", "skills");

      if (existsSync(projectSkillsPath) || existsSync(agentsSkillsPath)) {
        diagnostics.push({
          code: "PROJECT_NOT_TRUSTED",
          severity: "warning",
          message: "Project skills detected but project is not trusted. Use /project-trust approve to enable.",
          path: this.options.projectPath,
        });
      }
    }

    // Discover skills from each location
    const skillsByName = new Map<string, SkillCatalogEntry>();

    for (const location of locations) {
      const discovered = this.discoverInLocation(location);

      for (const skill of discovered.skills) {
        const existing = skillsByName.get(skill.name);

        if (existing) {
          // Collision: higher precedence wins
          const precedence = { bundled: 0, user: 1, project: 2 };
          if (precedence[skill.scope] > precedence[existing.scope]) {
            skillsByName.set(skill.name, skill);
            diagnostics.push({
              code: "SKILL_COLLISION",
              severity: "warning",
              message: `Skill '${skill.name}' found in multiple scopes. Using ${skill.scope} version from ${skill.location}`,
              path: skill.skillPath,
            });
          } else {
            diagnostics.push({
              code: "SKILL_COLLISION",
              severity: "warning",
              message: `Skill '${skill.name}' found in multiple scopes. Using ${existing.scope} version from ${existing.location}`,
              path: existing.skillPath,
            });
          }
        } else {
          skillsByName.set(skill.name, skill);
        }
      }

      diagnostics.push(...discovered.diagnostics);
    }

    skills.push(...skillsByName.values());

    return { skills, diagnostics };
  }

  /**
   * Discover skills in a specific location.
   */
  private discoverInLocation(location: SkillLocation): DiscoveryResult {
    const skills: SkillCatalogEntry[] = [];
    const diagnostics: SkillDiagnostic[] = [];

    if (!existsSync(location.path)) {
      return { skills, diagnostics };
    }

    const stat = statSync(location.path);
    if (!stat.isDirectory()) {
      diagnostics.push({
        code: "INVALID_LOCATION",
        severity: "error",
        message: `Skill location is not a directory: ${location.path}`,
        path: location.path,
      });
      return { skills, diagnostics };
    }

    const entries = readdirSync(location.path, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillPath = join(location.path, entry.name);
      const skillMdPath = join(skillPath, "SKILL.md");

      // Skip if no SKILL.md
      if (!existsSync(skillMdPath)) {
        continue;
      }

      // Validate skill
      const validation = validateSkill(skillPath, { scope: location.scope });

      if (!validation.valid) {
        diagnostics.push(...validation.errors);
        diagnostics.push(...validation.warnings);

        // Add to catalog with errors for /skill list --invalid
        if (validation.frontmatter) {
          skills.push({
            name: validation.frontmatter.name,
            description: validation.frontmatter.description,
            location: location.path,
            scope: location.scope,
            trusted: location.scope !== "project" || this.isProjectTrusted(),
            enabled: false,
            modelInvocable: false,
            diagnostics: [...validation.errors, ...validation.warnings],
            skillPath,
            frontmatter: validation.frontmatter,
          });
        }
        continue;
      }

      // Compute content hash for valid skills
      let contentHash: string | undefined;
      let revision: string | undefined;

      try {
        contentHash = computeSkillContentHash(skillPath);
        revision = `external_${contentHash.slice(0, 12)}`;
      } catch (error) {
        diagnostics.push({
          code: "HASH_ERROR",
          severity: "warning",
          message: `Failed to compute content hash for ${skillPath}: ${error}`,
          path: skillPath,
        });
      }

      const frontmatter = validation.frontmatter!;
      const isModelInvocable = this.isModelInvocable(frontmatter);

      skills.push({
        name: frontmatter.name,
        description: frontmatter.description,
        location: location.path,
        scope: location.scope,
        trusted: location.scope !== "project" || this.isProjectTrusted(),
        enabled: true,
        revision,
        contentHash,
        modelInvocable: isModelInvocable,
        diagnostics: validation.warnings,
        skillPath,
        frontmatter,
      });
    }

    return { skills, diagnostics };
  }

  /**
   * Check if project is trusted.
   */
  private isProjectTrusted(): boolean {
    const projectIdentity = ProjectTrustStore.computeProjectIdentity(this.options.projectPath);
    return this.options.trustStore.isTrusted(projectIdentity);
  }

  /**
   * Compute a fingerprint of the skill tree at a given project root.
   * The fingerprint is a SHA-256 hash of sorted skill names and their content hashes.
   * Used to detect skill changes since trust approval.
   */
  computeFingerprint(projectRoot: string): string {
    const hash = createHash("sha256");
    ProjectTrustStore.computeProjectIdentity(projectRoot);

    // Collect all skill entries from all locations (ignoring trust for fingerprint)
    const locations: SkillLocation[] = [];

    if (this.options.bundledSkillsPath && existsSync(this.options.bundledSkillsPath)) {
      locations.push({ path: this.options.bundledSkillsPath, scope: "bundled" });
    }

    if (this.options.userSkillsPath && existsSync(this.options.userSkillsPath)) {
      locations.push({ path: this.options.userSkillsPath, scope: "user" });
    }

    // Always include project skills for fingerprint computation
    const projectSkillsPath = join(projectRoot, ".soba", "skills");
    if (existsSync(projectSkillsPath)) {
      locations.push({ path: projectSkillsPath, scope: "project" });
    }

    const agentsSkillsPath = join(projectRoot, ".agents", "skills");
    if (existsSync(agentsSkillsPath)) {
      locations.push({ path: agentsSkillsPath, scope: "project" });
    }

    // Collect skill fingerprints
    const skillFingerprints: string[] = [];

    for (const location of locations) {
      if (!existsSync(location.path)) continue;

      const entries = readdirSync(location.path, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillDir = join(location.path, entry.name);
        const skillMdPath = join(skillDir, "SKILL.md");

        if (!existsSync(skillMdPath)) continue;

        try {
          const contentHash = computeSkillContentHash(skillDir);
          skillFingerprints.push(`${entry.name}:${contentHash}`);
        } catch {
          skillFingerprints.push(`${entry.name}:no-hash`);
        }
      }
    }

    // Sort for deterministic output
    skillFingerprints.sort();

    // Hash the combined fingerprint
    hash.update(skillFingerprints.join("\n"));
    return hash.digest("hex");
  }

  /**
   * Check if skill is model-invocable.
   * Skills with soba.disable-model-invocation metadata are not model-invocable.
   */
  private isModelInvocable(frontmatter: SkillCatalogEntry["frontmatter"]): boolean {
    if (frontmatter.soba?.disableModelInvocation === true) {
      return false;
    }

    const disableFlag = frontmatter.metadata?.["soba.disable-model-invocation"];
    return disableFlag !== "true";
  }
}
