import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  type ProjectIdentityResolver,
  type ProjectTrustStorage,
  ProjectTrustStore,
  type TrustStoreData,
} from "../../../application/skills/project-trust-store";
import type { ProjectIdentity } from "../../../application/skills/types";

const TRUST_STORE_FILENAME = "project-trust.json";

export interface FilesystemProjectTrustStorageOptions {
  sobaDir: string;
}

export class FilesystemProjectTrustStorage implements ProjectTrustStorage {
  private readonly storePath: string;

  constructor(options: FilesystemProjectTrustStorageOptions) {
    this.storePath = join(options.sobaDir, TRUST_STORE_FILENAME);
  }

  load(): TrustStoreData {
    if (!existsSync(this.storePath)) {
      return { version: 1, records: {} };
    }

    try {
      const parsed = JSON.parse(readFileSync(this.storePath, "utf-8"));
      if (parsed.version !== 1 || typeof parsed.records !== "object") {
        console.warn(`Invalid trust store format, resetting: ${this.storePath}`);
        return { version: 1, records: {} };
      }
      return parsed as TrustStoreData;
    } catch (error) {
      console.warn(`Failed to load trust store, resetting: ${this.storePath}`, error);
      return { version: 1, records: {} };
    }
  }

  save(data: TrustStoreData): void {
    const dir = dirname(this.storePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(this.storePath, JSON.stringify(data, null, 2), "utf-8");
  }
}

export class FilesystemProjectIdentityResolver implements ProjectIdentityResolver {
  computeProjectIdentity(projectPath: string): ProjectIdentity {
    const realPath = realpathSync(projectPath);
    const gitCommonDir = this.findGitCommonDir(realPath);

    if (gitCommonDir) {
      return {
        canonicalRoot: realpathSync(dirname(gitCommonDir)),
        gitCommonDir,
      };
    }

    return {
      canonicalRoot: realPath,
    };
  }

  private findGitCommonDir(startPath: string): string | undefined {
    let current = startPath;
    const visited = new Set<string>();

    while (!visited.has(current)) {
      visited.add(current);
      const gitPath = join(current, ".git");

      if (existsSync(gitPath)) {
        return resolveGitCommonDir(gitPath);
      }

      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }

    return undefined;
  }
}

function resolveGitCommonDir(gitPath: string): string | undefined {
  try {
    const stat = statSync(gitPath);
    if (stat.isDirectory()) return realpathSync(gitPath);
    if (!stat.isFile()) return undefined;

    const gitdir = parseGitdirFile(gitPath);
    if (!gitdir) return undefined;

    const commondirFile = join(gitdir, "commondir");
    if (existsSync(commondirFile)) {
      const common = readFileSync(commondirFile, "utf-8").trim();
      if (!common) return realpathSync(gitdir);
      return realpathSync(isAbsolute(common) ? common : resolve(gitdir, common));
    }

    return realpathSync(gitdir);
  } catch {
    return undefined;
  }
}

function parseGitdirFile(gitFilePath: string): string | undefined {
  const contents = readFileSync(gitFilePath, "utf-8");
  for (const line of contents.split(/\r?\n/)) {
    const match = /^gitdir:\s*(.+)$/i.exec(line.trim());
    if (!match?.[1]) continue;
    const raw = match[1].trim();
    return realpathSync(isAbsolute(raw) ? raw : resolve(dirname(gitFilePath), raw));
  }
  return undefined;
}

export function createFilesystemProjectTrustStore(options: FilesystemProjectTrustStorageOptions): ProjectTrustStore {
  return new ProjectTrustStore({
    storage: new FilesystemProjectTrustStorage(options),
    identityResolver: new FilesystemProjectIdentityResolver(),
  });
}
