import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { sealProofBundle, verifyEvidenceProof } from "../../../application/evidence/public";

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
  private readonly projectRoot: string;
  private readonly evidenceDir: string;

  constructor(options: FilesystemEvidenceProofStorageOptions) {
    this.projectRoot = resolve(options.projectRoot);
    this.evidenceDir = resolve(options.evidenceDir ?? join(this.projectRoot, ".soba", "evidence"));
  }

  captureEvidenceChangedFiles(paths: string[]): Array<{
    path: string;
    operation: "created" | "modified" | "deleted" | "renamed" | "unknown";
    source: "git";
    added?: number;
    removed?: number;
    mutationIds: string[];
    remainsChanged: boolean;
  }> {
    const projectPaths = [...new Set(paths.flatMap((path) => {
      const normalized = normalizeProjectPath(this.projectRoot, path);
      return normalized ? [normalized] : [];
    }))];
    if (projectPaths.length === 0) return [];

    const status = parseGitStatus(runGit(this.projectRoot, [
      "-c",
      "core.quotepath=false",
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ...projectPaths,
    ]));
    const stats = mergeGitStats(
      parseGitNumstat(runGit(this.projectRoot, ["diff", "--numstat", "--", ...projectPaths])),
      parseGitNumstat(runGit(this.projectRoot, ["diff", "--cached", "--numstat", "--", ...projectPaths])),
    );

    return projectPaths.flatMap((path) => {
      const state = status.get(path);
      if (!state) return [];
      const stat = stats.get(path) ?? untrackedStats(this.projectRoot, path, state.code);
      return [{
        path,
        operation: operationFromGitStatus(state.code),
        source: "git" as const,
        added: stat?.added,
        removed: stat?.removed,
        mutationIds: [],
        remainsChanged: true,
      }];
    });
  }

  saveEvidenceBundle<TBundle extends PersistableEvidenceBundle>(bundle: TBundle): {
    saved: boolean;
    path?: string;
    proofId?: string;
    runId?: string;
    digest?: string;
    validation: {
      valid: boolean;
      accepted: boolean;
      outcome: "verified" | "partially_verified" | "unverified" | "blocked" | "invalid";
      reason: string;
      exitCode: 0 | 1 | 2 | 3 | 4;
      errors: number;
      warnings: number;
      issues: Array<{
        severity: "error" | "warning";
        code: string;
        path: string;
        message: string;
      }>;
    };
    error?: string;
  } {
    const sealed = sealProofBundle(bundle as Record<string, unknown>);
    const path = join(this.evidenceDir, this.filenameFor(sealed as PersistableEvidenceBundle));
    const verification = verifyEvidenceProof({ path, bundle: sealed });
    const validation = {
      valid: verification.valid,
      accepted: verification.accepted,
      outcome: verification.outcome,
      reason: verification.reason,
      exitCode: verification.exitCode,
      errors: verification.summary.errors,
      warnings: verification.summary.warnings,
      issues: verification.issues,
    };

    if (!verification.valid) {
      return {
        saved: false,
        validation,
        error: `Proof contract validation failed: ${verification.reason}`,
      };
    }

    mkdirSync(this.evidenceDir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(sealed, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
    chmodSync(path, 0o600);
    return {
      saved: true,
      path,
      proofId: sealed.proofId,
      runId: sealed.runId,
      digest: sealed.integrity.digest,
      validation,
    };
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

function normalizeProjectPath(projectRoot: string, path: string): string | null {
  const absolutePath = resolve(projectRoot, path);
  const projectPath = relative(projectRoot, absolutePath);
  if (!projectPath || projectPath.startsWith(`..${sep}`) || projectPath === ".." || isAbsolute(projectPath)) {
    return null;
  }
  return projectPath.split(sep).join("/");
}

function runGit(projectRoot: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.exitCode === 0 ? result.stdout.toString() : "";
}

function parseGitStatus(output: string): Map<string, { code: string }> {
  const result = new Map<string, { code: string }>();
  for (const line of output.split("\n").filter(Boolean)) {
    const code = line.slice(0, 2);
    const rawPath = line.slice(3);
    const path = rawPath.includes(" -> ") ? rawPath.slice(rawPath.lastIndexOf(" -> ") + 4) : rawPath;
    if (path) result.set(path, { code });
  }
  return result;
}

function parseGitNumstat(output: string): Map<string, { added: number; removed: number }> {
  const result = new Map<string, { added: number; removed: number }>();
  for (const line of output.split("\n").filter(Boolean)) {
    const [rawAdded, rawRemoved, path] = line.split("\t");
    if (!path) continue;
    result.set(path, {
      added: numericGitStat(rawAdded),
      removed: numericGitStat(rawRemoved),
    });
  }
  return result;
}

function mergeGitStats(
  first: Map<string, { added: number; removed: number }>,
  second: Map<string, { added: number; removed: number }>,
): Map<string, { added: number; removed: number }> {
  const merged = new Map(first);
  for (const [path, stat] of second) {
    const existing = merged.get(path);
    merged.set(path, {
      added: (existing?.added ?? 0) + stat.added,
      removed: (existing?.removed ?? 0) + stat.removed,
    });
  }
  return merged;
}

function numericGitStat(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function operationFromGitStatus(code: string): "created" | "modified" | "deleted" | "renamed" | "unknown" {
  if (code === "??" || code.includes("A")) return "created";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  if (code.trim()) return "modified";
  return "unknown";
}

function untrackedStats(
  projectRoot: string,
  path: string,
  code: string,
): { added: number; removed: number } | undefined {
  if (code !== "??") return undefined;
  try {
    const content = readFileSync(resolve(projectRoot, path), "utf-8");
    return { added: countTextLines(content), removed: 0 };
  } catch {
    return undefined;
  }
}

function countTextLines(content: string): number {
  if (!content) return 0;
  const lines = content.split(/\r?\n/);
  return lines.length - (lines.at(-1) === "" ? 1 : 0);
}
