import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  PortableCapsuleService,
  PortableCapsuleServiceError,
  type PortableCapsuleServiceFactory,
  type PortableCapsuleStorage,
} from "../../../application/capsules/service";

const CAPSULE_FILE_EXTENSION = ".capsule.md";

export interface FilesystemPortableCapsuleStorageOptions {
  cwd: string;
  capsulesDir?: string;
  allowOutsideCwd?: boolean;
}

export class FilesystemPortableCapsuleStorage implements PortableCapsuleStorage {
  private readonly cwd: string;
  private readonly capsulesDir: string;
  private readonly allowOutsideCwd: boolean;

  constructor(options: FilesystemPortableCapsuleStorageOptions) {
    this.cwd = resolve(options.cwd);
    this.capsulesDir = resolve(options.capsulesDir ?? join(this.cwd, ".soba", "capsules"));
    this.allowOutsideCwd = options.allowOutsideCwd ?? false;
  }

  getCapsulesDir(): string {
    return this.capsulesDir;
  }

  getDefaultCapsulePath(fileName: string): string {
    return join(this.capsulesDir, fileName);
  }

  resolveOutputFilePath(path: string): string {
    const resolved = resolveRelativeToCwd(this.cwd, path);
    this.assertAllowedPath(resolved);
    return resolved;
  }

  resolveInputFilePath(path: string): string {
    const resolved = resolveRelativeToCwd(this.cwd, path);
    this.assertAllowedPath(resolved);
    return resolved;
  }

  exists(path: string): boolean {
    return existsSync(path);
  }

  writeExclusive(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { encoding: "utf-8", flag: "wx" });
  }

  read(path: string): { content: string; sizeBytes: number } {
    const stats = statSync(path);
    return {
      content: readFileSync(path, "utf-8"),
      sizeBytes: stats.size,
    };
  }

  listStoredCapsulePaths(): string[] {
    if (!existsSync(this.capsulesDir)) {
      return [];
    }

    return readdirSync(this.capsulesDir)
      .filter((fileName) => fileName.endsWith(CAPSULE_FILE_EXTENSION))
      .map((fileName) => join(this.capsulesDir, fileName));
  }

  private assertAllowedPath(path: string): void {
    if (this.allowOutsideCwd) return;
    if (!isPathInside(this.cwd, path)) {
      throw new PortableCapsuleServiceError("invalid_destination", `Path is outside project cwd: ${path}`);
    }
  }
}

export const createFilesystemPortableCapsuleService: PortableCapsuleServiceFactory = (session) =>
  new PortableCapsuleService({
    storage: new FilesystemPortableCapsuleStorage({ cwd: session.getCwd() }),
  });

function resolveRelativeToCwd(cwd: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

function isPathInside(base: string, path: string): boolean {
  const rel = relative(base, path);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`) && !isAbsolute(rel));
}
