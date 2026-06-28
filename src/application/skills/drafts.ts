/**
 * Skill Drafts — Phase 2
 *
 * Manages draft skills during creation/editing.
 * Drafts are isolated from the main catalog until promoted.
 *
 * Spec: internal-design-notes § Drafts
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillDiagnostic } from "./types";
import { validateSkill } from "./validator";

export interface DraftOptions {
  draftsPath: string;
}

export interface DraftSkill {
  id: string;
  name: string;
  skillPath: string;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "evaluating" | "ready" | "invalid";
  diagnostics: SkillDiagnostic[];
  evalCases?: EvalCase[];
}

export interface EvalCase {
  id: string;
  description: string;
  input: string;
  expectedOutput?: string;
  expectedTools?: string[];
  dangerous?: boolean;
}

export interface DraftOperationResult {
  success: boolean;
  draft?: DraftSkill;
  error?: string;
  diagnostics: SkillDiagnostic[];
}

/**
 * Manages draft skills during creation and editing.
 */
export class DraftStore {
  private readonly draftsPath: string;

  constructor(options: DraftOptions) {
    this.draftsPath = options.draftsPath;
    if (!existsSync(this.draftsPath)) {
      mkdirSync(this.draftsPath, { recursive: true });
    }
  }

  /**
   * Create a new draft skill.
   */
  create(name: string, content: string, evalCases?: EvalCase[]): DraftOperationResult {
    // Use skill name as directory name for validation compatibility
    const draftPath = join(this.draftsPath, name);

    // Create draft directory
    mkdirSync(draftPath, { recursive: true });

    // Write SKILL.md
    const skillMdPath = join(draftPath, "SKILL.md");
    writeFileSync(skillMdPath, content, "utf-8");

    // Write eval cases if provided
    if (evalCases && evalCases.length > 0) {
      const evalsDir = join(draftPath, "evals");
      mkdirSync(evalsDir, { recursive: true });
      const casesPath = join(evalsDir, "cases.json");
      writeFileSync(casesPath, JSON.stringify({ cases: evalCases }, null, 2), "utf-8");
    }

    // Validate draft
    const validation = validateSkill(draftPath);
    const diagnostics = [...validation.errors, ...validation.warnings];

    const status: DraftSkill["status"] = validation.valid ? "draft" : "invalid";

    const draftId = name; // Use name as ID for simplicity

    const draft: DraftSkill = {
      id: draftId,
      name,
      skillPath: draftPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status,
      diagnostics,
      evalCases,
    };

    // Save draft metadata
    this.saveDraftMetadata(draft);

    return {
      success: true,
      draft,
      diagnostics,
    };
  }

  /**
   * Update an existing draft.
   */
  update(draftId: string, content: string): DraftOperationResult {
    const draft = this.get(draftId);
    if (!draft) {
      return {
        success: false,
        error: `Draft '${draftId}' not found`,
        diagnostics: [],
      };
    }

    // Update SKILL.md
    const skillMdPath = join(draft.skillPath, "SKILL.md");
    writeFileSync(skillMdPath, content, "utf-8");

    // Re-validate
    const validation = validateSkill(draft.skillPath);
    const diagnostics = [...validation.errors, ...validation.warnings];

    draft.updatedAt = new Date().toISOString();
    draft.status = validation.valid ? "draft" : "invalid";
    draft.diagnostics = diagnostics;

    this.saveDraftMetadata(draft);

    return {
      success: true,
      draft,
      diagnostics,
    };
  }

  /**
   * Update eval cases for a draft.
   */
  updateEvalCases(draftId: string, cases: EvalCase[]): DraftOperationResult {
    const draft = this.get(draftId);
    if (!draft) {
      return {
        success: false,
        error: `Draft '${draftId}' not found`,
        diagnostics: [],
      };
    }

    const evalsDir = join(draft.skillPath, "evals");
    mkdirSync(evalsDir, { recursive: true });
    const casesPath = join(evalsDir, "cases.json");
    writeFileSync(casesPath, JSON.stringify({ cases }, null, 2), "utf-8");

    draft.evalCases = cases;
    draft.updatedAt = new Date().toISOString();

    this.saveDraftMetadata(draft);

    return {
      success: true,
      draft,
      diagnostics: draft.diagnostics,
    };
  }

  /**
   * Get a draft by ID.
   */
  get(draftId: string): DraftSkill | null {
    const draftPath = join(this.draftsPath, draftId);
    const metadataPath = join(draftPath, ".draft.json");

    if (!existsSync(metadataPath)) {
      return null;
    }

    try {
      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
      return metadata as DraftSkill;
    } catch {
      return null;
    }
  }

  /**
   * List all drafts.
   */
  list(): DraftSkill[] {
    if (!existsSync(this.draftsPath)) {
      return [];
    }

    const drafts: DraftSkill[] = [];
    const entries = readdirSync(this.draftsPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const draft = this.get(entry.name);
      if (draft) {
        drafts.push(draft);
      }
    }

    return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Delete a draft.
   */
  delete(draftId: string): boolean {
    const draftPath = join(this.draftsPath, draftId);
    if (!existsSync(draftPath)) {
      return false;
    }

    rmSync(draftPath, { recursive: true, force: true });
    return true;
  }

  /**
   * Save draft metadata.
   */
  private saveDraftMetadata(draft: DraftSkill): void {
    const metadataPath = join(draft.skillPath, ".draft.json");
    writeFileSync(metadataPath, JSON.stringify(draft, null, 2), "utf-8");
  }
}

/**
 * Isolated filesystem facade for draft operations.
 * Prevents access to files outside the draft directory.
 */
export class DraftFilesystemFacade {
  private readonly draftPath: string;

  constructor(draftPath: string) {
    this.draftPath = draftPath;
  }

  /**
   * Read a file within the draft directory.
   */
  readFile(relativePath: string): string | null {
    const fullPath = this.resolveSafe(relativePath);
    if (!fullPath || !existsSync(fullPath)) {
      return null;
    }

    const stat = statSync(fullPath);
    if (!stat.isFile()) {
      return null;
    }

    return readFileSync(fullPath, "utf-8");
  }

  /**
   * Write a file within the draft directory.
   */
  writeFile(relativePath: string, content: string): boolean {
    const fullPath = this.resolveSafe(relativePath);
    if (!fullPath) {
      return false;
    }

    try {
      writeFileSync(fullPath, content, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a file exists within the draft directory.
   */
  exists(relativePath: string): boolean {
    const fullPath = this.resolveSafe(relativePath);
    return fullPath !== null && existsSync(fullPath);
  }

  /**
   * Safely resolve a path within the draft directory.
   * Returns null if the path would escape the draft directory.
   */
  private resolveSafe(relativePath: string): string | null {
    // Prevent path traversal
    if (relativePath.includes("..") || relativePath.startsWith("/")) {
      return null;
    }

    const fullPath = join(this.draftPath, relativePath);

    // Verify the resolved path is within the draft directory
    if (!fullPath.startsWith(this.draftPath)) {
      return null;
    }

    return fullPath;
  }
}
