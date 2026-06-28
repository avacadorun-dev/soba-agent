/**
 * Skill Commands — Phase 2
 *
 * CLI commands for skill management: new, edit, eval, history, rollback, remove.
 * Integrates with DraftStore, RevisionStore, and SkillEvaluator.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillCatalog } from "./catalog";
import type { DraftStore, EvalCase } from "./drafts";
import type { EvalOptions, SkillEvaluator } from "./evaluator";
import type { RevisionStore } from "./revisions";

export interface SkillCommandsOptions {
  draftStore: DraftStore;
  revisionStore: RevisionStore;
  evaluator: SkillEvaluator;
  catalog: SkillCatalog;
  userSkillsPath: string;
  projectSkillsPath?: string;
}

export interface SkillCommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * Manages skill CLI commands.
 */
export class SkillCommands {
  private readonly draftStore: DraftStore;
  private readonly revisionStore: RevisionStore;
  private readonly evaluator: SkillEvaluator;
  private readonly catalog: SkillCatalog;
  private readonly userSkillsPath: string;
  private readonly projectSkillsPath?: string;

  constructor(options: SkillCommandsOptions) {
    this.draftStore = options.draftStore;
    this.revisionStore = options.revisionStore;
    this.evaluator = options.evaluator;
    this.catalog = options.catalog;
    this.userSkillsPath = options.userSkillsPath;
    this.projectSkillsPath = options.projectSkillsPath;
  }

  /**
   * /skill new <name> - Create a new skill draft
   */
  async new(name: string, description?: string): Promise<SkillCommandResult> {
    // Generate template
    const content = `---
name: ${name}
description: ${description || "A new skill"}
---

# ${name}

## Instructions

Describe what this skill does and how to use it.

## Examples

Provide examples of how to invoke this skill.
`;

    // Create draft with sample eval case
    const evalCases: EvalCase[] = [
      {
        id: "case-1",
        description: "Basic usage",
        input: "Example input",
        expectedOutput: "Example output",
      },
    ];

    const result = this.draftStore.create(name, content, evalCases);

    if (!result.success || !result.draft) {
      return {
        success: false,
        message: `Failed to create draft: ${result.error}`,
      };
    }

    return {
      success: true,
      message: `Created draft skill '${name}' at ${result.draft.skillPath}`,
      data: result.draft,
    };
  }

  /**
   * /skill edit <name> [instructions] - Edit an existing skill
   */
  async edit(name: string, instructions?: string): Promise<SkillCommandResult> {
    // Find skill in catalog
    const skill = this.catalog.get(name);
    if (!skill) {
      return {
        success: false,
        message: `Skill '${name}' not found in catalog`,
      };
    }

    // Read current content
    const skillMdPath = join(skill.skillPath, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      return {
        success: false,
        message: `SKILL.md not found for skill '${name}'`,
      };
    }

    const currentContent = readFileSync(skillMdPath, "utf-8");

    // Create draft from current content
    const draftResult = this.draftStore.create(name, currentContent);
    if (!draftResult.success || !draftResult.draft) {
      return {
        success: false,
        message: `Failed to create edit draft: ${draftResult.error}`,
      };
    }

    return {
      success: true,
      message: `Created edit draft for '${name}' at ${draftResult.draft.skillPath}${instructions ? `\nInstructions: ${instructions}` : ""}`,
      data: draftResult.draft,
    };
  }

  /**
   * /skill eval <name> - Evaluate a skill draft
   */
  async eval(name: string, options?: EvalOptions): Promise<SkillCommandResult> {
    // Find draft
    const drafts = this.draftStore.list();
    const draft = drafts.find((d) => d.name === name);

    if (!draft) {
      return {
        success: false,
        message: `Draft for skill '${name}' not found`,
      };
    }

    // Create revision snapshot
    const revision = this.revisionStore.createSnapshot(name, draft.skillPath, "user");

    // Run evaluation
    try {
      const evalResult = await this.evaluator.evaluate(draft, revision.revisionId, options);

      // Attach eval result to revision
      this.revisionStore.attachEvalResult(revision.revisionId, name, evalResult);

      const summary = evalResult.summary;
      const message = `Evaluation complete for '${name}':\n` +
        `  Total: ${summary.total}, Passed: ${summary.passed}, Failed: ${summary.failed}, Skipped: ${summary.skipped}\n` +
        `  Pass rate: ${(summary.passRate * 100).toFixed(1)}%`;

      return {
        success: summary.failed === 0,
        message,
        data: evalResult,
      };
    } catch (error) {
      return {
        success: false,
        message: `Evaluation failed: ${error}`,
      };
    }
  }

  /**
   * /skill promote <name> - Promote a draft to user or project scope
   */
  async promote(name: string, scope: "user" | "project" = "user"): Promise<SkillCommandResult> {
    // Find draft
    const drafts = this.draftStore.list();
    const draft = drafts.find((d) => d.name === name);

    if (!draft) {
      return {
        success: false,
        message: `Draft for skill '${name}' not found`,
      };
    }

    // Check if draft is valid
    if (draft.status === "invalid") {
      return {
        success: false,
        message: `Cannot promote invalid draft. Fix validation errors first.`,
      };
    }

    // Find latest revision with eval
    const history = this.revisionStore.getHistory(name);
    const latestRevision = history.revisions[0];

    if (!latestRevision) {
      return {
        success: false,
        message: `No revision found for skill '${name}'. Run /skill eval first.`,
      };
    }

    if (!latestRevision.evalResult) {
      return {
        success: false,
        message: `No evaluation found for revision. Run /skill eval first.`,
      };
    }

    // Check eval passed
    if (latestRevision.evalResult.summary.failed > 0) {
      return {
        success: false,
        message: `Cannot promote skill with failed evaluations. Fix issues first.`,
      };
    }

    // Determine target path
    const targetPath = scope === "user" ? this.userSkillsPath : this.projectSkillsPath;
    if (!targetPath) {
      return {
        success: false,
        message: `Target path not configured for scope '${scope}'`,
      };
    }

    // Copy draft to target location
    const skillTargetPath = join(targetPath, name);
    mkdirSync(skillTargetPath, { recursive: true });

    const skillMdPath = join(draft.skillPath, "SKILL.md");
    const targetSkillMdPath = join(skillTargetPath, "SKILL.md");
    writeFileSync(targetSkillMdPath, readFileSync(skillMdPath, "utf-8"), "utf-8");

    // Copy evals if present
    const evalsPath = join(draft.skillPath, "evals");
    if (existsSync(evalsPath)) {
      const targetEvalsPath = join(skillTargetPath, "evals");
      mkdirSync(targetEvalsPath, { recursive: true });
      const casesPath = join(evalsPath, "cases.json");
      if (existsSync(casesPath)) {
        writeFileSync(join(targetEvalsPath, "cases.json"), readFileSync(casesPath, "utf-8"), "utf-8");
      }
    }

    // Mark revision as approved and promoted
    this.revisionStore.approve(latestRevision.revisionId, name);
    this.revisionStore.markPromoted(latestRevision.revisionId, name, scope);

    // Refresh catalog
    this.catalog.refresh();

    // Delete draft
    this.draftStore.delete(draft.id);

    return {
      success: true,
      message: `Promoted skill '${name}' to ${scope} scope at ${skillTargetPath}`,
      data: { revision: latestRevision, scope },
    };
  }

  /**
   * /skill history <name> - Show revision history
   */
  async history(name: string): Promise<SkillCommandResult> {
    const history = this.revisionStore.getHistory(name);

    if (history.revisions.length === 0) {
      return {
        success: true,
        message: `No revision history for skill '${name}'`,
        data: history,
      };
    }

    const lines = [`Revision history for '${name}':`];
    for (const rev of history.revisions) {
      const status = rev.approved ? "✓" : "○";
      const promoted = rev.promotedTo ? ` (promoted to ${rev.promotedTo})` : "";
      lines.push(`  ${status} ${rev.revisionId} - ${rev.createdAt}${promoted}`);
    }

    return {
      success: true,
      message: lines.join("\n"),
      data: history,
    };
  }

  /**
   * /skill rollback <name> <revision-id> - Rollback to a previous revision
   */
  async rollback(name: string, revisionId: string): Promise<SkillCommandResult> {
    const revision = this.revisionStore.getRevision(name, revisionId);

    if (!revision) {
      return {
        success: false,
        message: `Revision '${revisionId}' not found for skill '${name}'`,
      };
    }

    // Create rollback revision
    const rollbackRevision = this.revisionStore.rollback(name, revisionId);

    if (!rollbackRevision) {
      return {
        success: false,
        message: `Failed to create rollback revision`,
      };
    }

    return {
      success: true,
      message: `Rolled back '${name}' to revision '${revisionId}'. New revision: ${rollbackRevision.revisionId}`,
      data: rollbackRevision,
    };
  }

  /**
   * /skill remove <name> - Remove a skill
   */
  async remove(name: string, confirmed: boolean = false): Promise<SkillCommandResult> {
    if (!confirmed) {
      return {
        success: false,
        message: `Are you sure you want to remove skill '${name}'? Use --confirm to proceed.`,
      };
    }

    // Find skill in catalog
    const skill = this.catalog.get(name);
    if (!skill) {
      return {
        success: false,
        message: `Skill '${name}' not found in catalog`,
      };
    }
    if (skill.scope === "bundled") {
      return {
        success: false,
        message: `Bundled skill '${name}' cannot be removed`,
      };
    }

    // Remove skill directory
    const { rmSync } = await import("node:fs");
    rmSync(skill.skillPath, { recursive: true, force: true });

    // Refresh catalog
    this.catalog.refresh();

    return {
      success: true,
      message: `Removed skill '${name}'`,
    };
  }

  /**
   * /skill list - List all skills
   */
  async list(options?: { includeInvalid?: boolean; includeDisabled?: boolean }): Promise<SkillCommandResult> {
    const skills = this.catalog.list(options);

    if (skills.length === 0) {
      return {
        success: true,
        message: "No skills found",
        data: skills,
      };
    }

    const lines = ["Available skills:"];
    for (const skill of skills) {
      const status = skill.enabled ? "✓" : "✗";
      const scope = `[${skill.scope}]`;
      lines.push(`  ${status} ${skill.name} ${scope} - ${skill.description}`);
    }

    return {
      success: true,
      message: lines.join("\n"),
      data: skills,
    };
  }
}
