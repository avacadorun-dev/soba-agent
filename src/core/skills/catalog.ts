/**
 * Skill Catalog — Phase 2
 *
 * Manages the catalog of discovered skills and provides lookup/activation.
 * Spec: internal-design-notes § Catalog Entry
 */

import type { SkillDiscovery } from "./discovery";
import type {
  ActivationResult,
  SkillCatalogEntry,
  SkillDiagnostic,
} from "./types";

export interface SkillCatalogOptions {
  discovery: SkillDiscovery;
}

/**
 * Manages the skill catalog and provides activation/deactivation.
 */
export class SkillCatalog {
  private readonly discovery: SkillDiscovery;
  private skills: Map<string, SkillCatalogEntry> = new Map();
  private diagnostics: SkillDiagnostic[] = [];
  private lastScanAt: string | null = null;

  constructor(options: SkillCatalogOptions) {
    this.discovery = options.discovery;
  }

  /**
   * Scan and refresh the catalog.
   */
  refresh(): void {
    const result = this.discovery.discover();
    this.skills.clear();

    for (const skill of result.skills) {
      this.skills.set(skill.name, skill);
    }

    this.diagnostics = result.diagnostics;
    this.lastScanAt = new Date().toISOString();
  }

  /**
   * Get a skill by name.
   */
  get(name: string): SkillCatalogEntry | undefined {
    return this.skills.get(name);
  }

  /**
   * List all skills in the catalog.
   */
  list(options?: { includeInvalid?: boolean; includeDisabled?: boolean }): SkillCatalogEntry[] {
    const allSkills = Array.from(this.skills.values());

    if (options?.includeInvalid && options?.includeDisabled) {
      return allSkills;
    }

    return allSkills.filter((skill) => {
      if (!options?.includeInvalid && !skill.enabled) {
        return false;
      }
      if (!options?.includeDisabled && !skill.enabled) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get catalog diagnostics.
   */
  getDiagnostics(): SkillDiagnostic[] {
    return [...this.diagnostics];
  }

  /**
   * Get last scan timestamp.
   */
  getLastScanAt(): string | null {
    return this.lastScanAt;
  }

  /**
   * Activate a skill by name.
   * Returns activation result with skill details.
   */
  activate(name: string, revision?: string): ActivationResult {
    const skill = this.skills.get(name);

    if (!skill) {
      return {
        success: false,
        error: `Skill '${name}' not found in catalog`,
        diagnostics: [],
      };
    }

    if (!skill.enabled) {
      return {
        success: false,
        error: `Skill '${name}' is disabled due to validation errors`,
        diagnostics: skill.diagnostics,
      };
    }

    if (!skill.trusted) {
      return {
        success: false,
        error: `Skill '${name}' requires project trust`,
        diagnostics: [],
      };
    }

    // Check revision match if specified
    if (revision && skill.revision && skill.revision !== revision) {
      return {
        success: false,
        error: `Requested revision '${revision}' does not match available revision '${skill.revision}'`,
        diagnostics: [],
      };
    }

    return {
      success: true,
      skill,
      diagnostics: skill.diagnostics,
    };
  }

  /**
   * Get skills that are model-invocable (for system prompt).
   */
  getModelInvocable(): SkillCatalogEntry[] {
    return this.list().filter((skill) => skill.modelInvocable);
  }

  /**
   * Get catalog summary for system prompt.
   */
  getSummary(): string {
    const invocable = this.getModelInvocable();

    if (invocable.length === 0) {
      return "No skills available.";
    }

    const lines = ["Available skills:"];

    for (const skill of invocable) {
      lines.push(`- ${skill.name}: ${skill.description}`);
    }

    return lines.join("\n");
  }
}
