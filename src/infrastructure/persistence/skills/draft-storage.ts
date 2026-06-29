import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { DraftSkill, DraftStorage, EvalCase } from "../../../application/skills/drafts";

export interface FilesystemDraftStorageOptions {
  draftsPath: string;
}

export class FilesystemDraftStorage implements DraftStorage {
  private readonly draftsPath: string;

  constructor(options: FilesystemDraftStorageOptions) {
    this.draftsPath = options.draftsPath;
    if (!existsSync(this.draftsPath)) {
      mkdirSync(this.draftsPath, { recursive: true });
    }
  }

  createDraftDirectory(name: string): string {
    const draftPath = join(this.draftsPath, name);
    mkdirSync(draftPath, { recursive: true });
    return draftPath;
  }

  writeSkillContent(draftPath: string, content: string): void {
    writeFileSync(join(draftPath, "SKILL.md"), content, "utf-8");
  }

  writeEvalCases(draftPath: string, cases: EvalCase[]): void {
    const evalsDir = join(draftPath, "evals");
    mkdirSync(evalsDir, { recursive: true });
    writeFileSync(join(evalsDir, "cases.json"), JSON.stringify({ cases }, null, 2), "utf-8");
  }

  readDraft(draftId: string): DraftSkill | null {
    const metadataPath = join(this.draftsPath, draftId, ".draft.json");
    if (!existsSync(metadataPath)) {
      return null;
    }

    try {
      return JSON.parse(readFileSync(metadataPath, "utf-8")) as DraftSkill;
    } catch {
      return null;
    }
  }

  listDraftIds(): string[] {
    if (!existsSync(this.draftsPath)) {
      return [];
    }

    return readdirSync(this.draftsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  deleteDraft(draftId: string): boolean {
    const draftPath = join(this.draftsPath, draftId);
    if (!existsSync(draftPath)) {
      return false;
    }

    rmSync(draftPath, { recursive: true, force: true });
    return true;
  }

  writeDraft(draft: DraftSkill): void {
    writeFileSync(join(draft.skillPath, ".draft.json"), JSON.stringify(draft, null, 2), "utf-8");
  }
}

/**
 * Isolated filesystem facade for draft operations.
 * Prevents access to files outside the draft directory.
 */
export class DraftFilesystemFacade {
  private readonly draftPath: string;

  constructor(draftPath: string) {
    this.draftPath = resolve(draftPath);
  }

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

  exists(relativePath: string): boolean {
    const fullPath = this.resolveSafe(relativePath);
    return fullPath !== null && existsSync(fullPath);
  }

  private resolveSafe(relativePath: string): string | null {
    if (isAbsolute(relativePath)) {
      return null;
    }

    const fullPath = resolve(this.draftPath, relativePath);
    const fromDraft = relative(this.draftPath, fullPath);
    if (fromDraft === "" || (!fromDraft.startsWith("..") && !isAbsolute(fromDraft))) {
      return fullPath;
    }

    return null;
  }
}
