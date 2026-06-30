import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface FilesystemEvidenceProofStorageOptions {
  projectRoot: string;
  evidenceDir?: string;
}

interface PersistableEvidenceBundle {
  sessionId?: unknown;
  turnId?: unknown;
  createdAt?: unknown;
}

export interface EvidenceProofFile {
  path: string;
  bundle: Record<string, unknown>;
}

export class FilesystemEvidenceProofStorage {
  private readonly evidenceDir: string;

  constructor(options: FilesystemEvidenceProofStorageOptions) {
    const projectRoot = resolve(options.projectRoot);
    this.evidenceDir = resolve(options.evidenceDir ?? join(projectRoot, ".soba", "evidence"));
  }

  saveEvidenceBundle<TBundle extends PersistableEvidenceBundle>(bundle: TBundle): { path: string } {
    mkdirSync(this.evidenceDir, { recursive: true });
    const path = join(this.evidenceDir, this.filenameFor(bundle));
    writeFileSync(path, `${JSON.stringify(bundle, null, 2)}\n`, "utf-8");
    return { path };
  }

  getEvidenceDir(): string {
    return this.evidenceDir;
  }

  readEvidenceBundle(path: string): EvidenceProofFile {
    const resolvedPath = resolve(path);
    const parsed = JSON.parse(readFileSync(resolvedPath, "utf-8")) as unknown;
    if (!isRecord(parsed)) {
      throw new Error(`Evidence proof is not a JSON object: ${resolvedPath}`);
    }
    return {
      path: resolvedPath,
      bundle: parsed,
    };
  }

  readLatestEvidenceBundle(): EvidenceProofFile | null {
    const latestPath = this.latestEvidencePath();
    return latestPath ? this.readEvidenceBundle(latestPath) : null;
  }

  latestEvidencePath(): string | null {
    if (!existsSync(this.evidenceDir)) return null;
    const candidates = readdirSync(this.evidenceDir)
      .filter((name) => name.endsWith(".soba-proof.json"))
      .map((name) => {
        const path = join(this.evidenceDir, name);
        const stat = statSync(path);
        return { path, name, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));

    return candidates[0]?.path ?? null;
  }

  private filenameFor(bundle: PersistableEvidenceBundle): string {
    const createdAt = typeof bundle.createdAt === "string" ? bundle.createdAt : new Date().toISOString();
    const timestamp = sanitizeFilenamePart(createdAt.replace(/\.\d{3}Z$/, "Z"));
    const sessionId = sanitizeFilenamePart(typeof bundle.sessionId === "string" ? bundle.sessionId : "session");
    const turnId = sanitizeFilenamePart(typeof bundle.turnId === "string" ? bundle.turnId : "turn");
    return `${timestamp}-${sessionId}-${turnId}.soba-proof.json`;
  }
}

function sanitizeFilenamePart(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
