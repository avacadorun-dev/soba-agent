import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { SkillValidationOptions, ValidationResult } from "../../../application/skills/types";
import {
  computeSkillContentHash,
  type SkillFilesystemEntry,
  type SkillValidationFilesystem,
  validateSkill,
} from "../../../application/skills/validator";

export class FilesystemSkillValidationFilesystem implements SkillValidationFilesystem {
  exists(path: string): boolean {
    return existsSync(path);
  }

  isDirectory(path: string): boolean {
    return statSync(path).isDirectory();
  }

  basename(path: string): string {
    return basename(path);
  }

  join(...parts: string[]): string {
    return join(...parts);
  }

  relative(from: string, to: string): string {
    return relative(from, to);
  }

  realpath(path: string): string {
    return realpathSync(path);
  }

  readText(path: string): string {
    return readFileSync(path, "utf-8");
  }

  readBytes(path: string): Uint8Array {
    return readFileSync(path);
  }

  listEntries(path: string): SkillFilesystemEntry[] {
    return readdirSync(path).map((name) => {
      const entryPath = join(path, name);
      const stat = lstatSync(entryPath);
      const kind: SkillFilesystemEntry["kind"] = stat.isSymbolicLink()
        ? "symlink"
        : stat.isDirectory()
          ? "directory"
          : stat.isFile()
            ? "file"
            : "other";
      return { name, kind };
    });
  }
}

export function validateSkillOnDisk(
  skillPath: string,
  options: Omit<SkillValidationOptions, "files"> = {},
): ValidationResult {
  return validateSkill(skillPath, { ...options, files: new FilesystemSkillValidationFilesystem() });
}

export function computeSkillContentHashOnDisk(skillPath: string): string {
  return computeSkillContentHash(skillPath, new FilesystemSkillValidationFilesystem());
}
