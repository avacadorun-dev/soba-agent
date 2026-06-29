/**
 * Skill Drafts — Phase 2
 *
 * Manages draft skills during creation/editing.
 * Drafts are isolated from the main catalog until promoted.
 *
 * Spec: internal-design-notes § Drafts
 */

import type { SkillDiagnostic } from "./types";
import { validateSkill } from "./validator";

export interface DraftOptions {
  storage: DraftStorage;
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

export interface DraftStorage {
  createDraftDirectory(name: string): string;
  writeSkillContent(draftPath: string, content: string): void;
  writeEvalCases(draftPath: string, cases: EvalCase[]): void;
  readDraft(draftId: string): DraftSkill | null;
  listDraftIds(): string[];
  deleteDraft(draftId: string): boolean;
  writeDraft(draft: DraftSkill): void;
}

/**
 * Manages draft skills during creation and editing.
 */
export class DraftStore {
  private readonly storage: DraftStorage;

  constructor(options: DraftOptions) {
    this.storage = options.storage;
  }

  /**
   * Create a new draft skill.
   */
  create(name: string, content: string, evalCases?: EvalCase[]): DraftOperationResult {
    const draftPath = this.storage.createDraftDirectory(name);
    this.storage.writeSkillContent(draftPath, content);

    if (evalCases && evalCases.length > 0) {
      this.storage.writeEvalCases(draftPath, evalCases);
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
    this.storage.writeDraft(draft);

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

    this.storage.writeSkillContent(draft.skillPath, content);

    // Re-validate
    const validation = validateSkill(draft.skillPath);
    const diagnostics = [...validation.errors, ...validation.warnings];

    draft.updatedAt = new Date().toISOString();
    draft.status = validation.valid ? "draft" : "invalid";
    draft.diagnostics = diagnostics;

    this.storage.writeDraft(draft);

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

    this.storage.writeEvalCases(draft.skillPath, cases);

    draft.evalCases = cases;
    draft.updatedAt = new Date().toISOString();

    this.storage.writeDraft(draft);

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
    return this.storage.readDraft(draftId);
  }

  /**
   * List all drafts.
   */
  list(): DraftSkill[] {
    const drafts: DraftSkill[] = [];
    for (const draftId of this.storage.listDraftIds()) {
      const draft = this.get(draftId);
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
    return this.storage.deleteDraft(draftId);
  }
}
