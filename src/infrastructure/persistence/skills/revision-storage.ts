import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RevisionStorage, SkillRevision } from "../../../application/skills/revisions";

export interface FilesystemRevisionStorageOptions {
  revisionsPath: string;
}

export class FilesystemRevisionStorage implements RevisionStorage {
  private readonly revisionsPath: string;

  constructor(options: FilesystemRevisionStorageOptions) {
    this.revisionsPath = options.revisionsPath;
    if (!existsSync(this.revisionsPath)) {
      mkdirSync(this.revisionsPath, { recursive: true });
    }
  }

  createSnapshotPath(skillName: string, revisionId: string): string {
    const snapshotPath = join(this.revisionsPath, skillName, revisionId);
    mkdirSync(snapshotPath, { recursive: true });
    return snapshotPath;
  }

  computeContentHash(skillPath: string): string {
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

    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    for (const file of files) {
      hash.update(file.relativePath);
      hash.update(file.content);
    }

    return hash.digest("hex");
  }

  copySkillToSnapshot(skillPath: string, snapshotPath: string): void {
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

    walk(skillPath, skillPath);
  }

  readRevision(skillName: string, revisionId: string): SkillRevision | null {
    const revisionPath = join(this.revisionsPath, skillName, revisionId, ".revision.json");
    if (!existsSync(revisionPath)) return null;

    try {
      return JSON.parse(readFileSync(revisionPath, "utf-8")) as SkillRevision;
    } catch {
      return null;
    }
  }

  listRevisionIds(skillName: string): string[] {
    const skillRevisionsPath = join(this.revisionsPath, skillName);
    if (!existsSync(skillRevisionsPath)) return [];

    return readdirSync(skillRevisionsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  writeRevision(revision: SkillRevision): void {
    const revisionPath = join(revision.snapshotPath, ".revision.json");
    writeFileSync(revisionPath, JSON.stringify(revision, null, 2), "utf-8");
  }
}
