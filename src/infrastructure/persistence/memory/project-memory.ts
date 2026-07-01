import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type {
  CapsuleRelevanceQuery,
  CapsuleRelevanceResult,
  EntityGraph,
  KnowledgeDocument,
  MemoryCapsule,
  MemoryCapsuleInput,
  MemoryCapsuleSourceState,
  MemoryDoctorCapsuleEntry,
  MemoryDoctorIssue,
  MemoryDoctorReport,
  MemoryDoctorStatus,
  MemorySourceConfidence,
  ProjectMemoryOptions,
} from "../../../kernel/memory/types";
import { CapsuleStore } from "./capsule-store";
import { EntityGraphStore } from "./entity-graph";
import { KnowledgeStore } from "./knowledge-store";

export type ProjectMemoryErrorCode = "initialize_failed" | "load_failed" | "save_failed" | "knowledge_store_failed" | "capsule_store_failed" | "graph_store_failed";

export interface ProjectMemoryLoadResult {
  knowledgeFiles: KnowledgeDocument[];
  graph: EntityGraph | null;
}

export interface ProjectMemorySaveResult {
  prunedCapsuleIds: string[];
  keptCapsuleCount: number;
  graphSaved: boolean;
}

export interface ProjectMemoryStores {
  knowledge: KnowledgeStore;
  capsules: CapsuleStore;
  graph: EntityGraphStore | null;
}

export class ProjectMemoryError extends Error {
  readonly code: ProjectMemoryErrorCode;
  readonly layer: "project" | "knowledge" | "capsules" | "graph";
  readonly cause?: unknown;

  constructor(
    code: ProjectMemoryErrorCode,
    message: string,
    options: {
      layer?: "project" | "knowledge" | "capsules" | "graph";
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "ProjectMemoryError";
    this.code = code;
    this.layer = options.layer ?? "project";
    this.cause = options.cause;
  }
}

export class ProjectMemory {
  private readonly projectRoot: string;
  private readonly memoryDir: string;
  private readonly contextCapsuleLimit: number;
  private readonly now: () => Date;
  private readonly knowledge: KnowledgeStore;
  private readonly capsules: CapsuleStore;
  private readonly graph: EntityGraphStore | null;

  constructor(options: ProjectMemoryOptions) {
    this.projectRoot = resolve(options.projectRoot);
    this.memoryDir = resolve(options.memoryDir ?? join(this.projectRoot, ".soba", "memory"));
    this.contextCapsuleLimit = options.contextCapsuleLimit ?? 10;
    this.now = options.now ?? (() => new Date());
    this.knowledge = new KnowledgeStore({
      projectRoot: this.projectRoot,
      memoryDir: this.memoryDir,
    });
    this.capsules = new CapsuleStore({
      projectRoot: this.projectRoot,
      memoryDir: this.memoryDir,
      maxCapsules: options.maxCapsules,
      now: options.now,
      idGenerator: options.idGenerator,
    });
    this.graph =
      options.enableGraph === false
        ? null
        : new EntityGraphStore({
            projectRoot: this.projectRoot,
            memoryDir: this.memoryDir,
          });
  }

  initialize(): void {
    this.withProjectError("initialize_failed", "initialize", () => {
      this.withLayerError("knowledge_store_failed", "knowledge", "initialize", () => this.knowledge.init());
      this.withLayerError("capsule_store_failed", "capsules", "initialize", () => this.capsules.init());
      this.withLayerError("graph_store_failed", "graph", "load", () => this.graph?.load());
    });
  }

  load(): ProjectMemoryLoadResult {
    return this.withProjectError("load_failed", "load", () => {
      this.initialize();
      return {
        knowledgeFiles: this.getKnowledgeFiles(),
        graph: this.getGraph(),
      };
    });
  }

  save(): ProjectMemorySaveResult {
    return this.withProjectError("save_failed", "save", () => {
      const pruneResult = this.withLayerError("capsule_store_failed", "capsules", "prune", () => this.capsules.prune());
      const graphSaved = this.withLayerError("graph_store_failed", "graph", "save", () => {
        if (!this.graph) {
          return false;
        }

        this.graph.save();
        return true;
      });

      return {
        prunedCapsuleIds: pruneResult.removedIds,
        keptCapsuleCount: pruneResult.keptCount,
        graphSaved,
      };
    });
  }

  getKnowledgeFiles(): KnowledgeDocument[] {
    return this.withLayerError("knowledge_store_failed", "knowledge", "load knowledge files", () => this.knowledge.loadAll());
  }

  getRelevantCapsules(query: string | CapsuleRelevanceQuery): CapsuleRelevanceResult[] {
    const normalizedQuery = typeof query === "string" ? query : { limit: this.contextCapsuleLimit, ...query };
    return this.withLayerError("capsule_store_failed", "capsules", "get relevant capsules", () => this.capsules.getRelevant(normalizedQuery));
  }

  addCapsule(input: MemoryCapsuleInput): MemoryCapsule {
    return this.withLayerError("capsule_store_failed", "capsules", "add capsule", () => this.capsules.add(input));
  }

  getGraph(): EntityGraph | null {
    return this.withLayerError("graph_store_failed", "graph", "load graph", () => {
      if (!this.graph) {
        return null;
      }

      return this.graph.load();
    });
  }

  doctor(): MemoryDoctorReport {
    return this.withProjectError("load_failed", "doctor", () => {
      this.initialize();
      const generatedAt = this.now().toISOString();
      const knowledge = this.getKnowledgeFiles().map((document) => ({
        key: document.key,
        path: document.path,
        estimatedTokens: document.estimatedTokens,
        bytes: Buffer.byteLength(document.content, "utf-8"),
      }));
      const issues: MemoryDoctorIssue[] = [];
      const inspectedCapsules = this.withLayerError("capsule_store_failed", "capsules", "inspect capsules", () => this.capsules.inspectFiles());
      const capsules = [
        ...inspectedCapsules.capsules.map((capsule) => inspectCapsuleSource(capsule, this.projectRoot, issues)),
        ...inspectedCapsules.corruptions.map((corruption) => {
          issues.push({
            code: "capsule_corrupted",
            severity: "error",
            target: { kind: "capsule", id: corruption.id },
            message: corruption.message,
            path: corruption.path,
          });
          return {
            id: corruption.id,
            sourceState: "corrupted" as const,
          };
        }),
      ];

      const staleCapsules = capsules.filter((capsule) => capsule.sourceState === "stale").length;
      const brokenCapsules = capsules.filter((capsule) =>
        capsule.sourceState === "missing" ||
        capsule.sourceState === "outside_project" ||
        capsule.sourceState === "invalid_source" ||
        capsule.sourceState === "corrupted",
      ).length;
      const untrackedCapsules = capsules.filter((capsule) => capsule.sourceState === "untracked").length;
      const status: MemoryDoctorStatus = brokenCapsules > 0
        ? "broken"
        : staleCapsules > 0
          ? "stale"
          : "healthy";

      return {
        status,
        generatedAt,
        memoryDir: this.memoryDir,
        summary: {
          knowledgeFiles: knowledge.length,
          knowledgeTokens: knowledge.reduce((sum, document) => sum + document.estimatedTokens, 0),
          capsules: capsules.length,
          freshCapsules: capsules.filter((capsule) => capsule.sourceState === "fresh").length,
          staleCapsules,
          brokenCapsules,
          untrackedCapsules,
          issues: issues.length,
        },
        knowledge,
        capsules,
        issues,
      };
    });
  }

  getMemoryDir(): string {
    return this.memoryDir;
  }

  getStores(): ProjectMemoryStores {
    return {
      knowledge: this.knowledge,
      capsules: this.capsules,
      graph: this.graph,
    };
  }

  private withProjectError<T>(code: Extract<ProjectMemoryErrorCode, "initialize_failed" | "load_failed" | "save_failed">, operation: string, run: () => T): T {
    try {
      return run();
    } catch (error) {
      if (error instanceof ProjectMemoryError) {
        throw error;
      }

      throw new ProjectMemoryError(code, `ProjectMemory failed to ${operation}: ${formatCause(error)}`, {
        cause: error,
      });
    }
  }

  private withLayerError<T>(
    code: Exclude<ProjectMemoryErrorCode, "initialize_failed" | "load_failed" | "save_failed">,
    layer: "knowledge" | "capsules" | "graph",
    operation: string,
    run: () => T,
  ): T {
    try {
      return run();
    } catch (error) {
      if (error instanceof ProjectMemoryError) {
        throw error;
      }

      throw new ProjectMemoryError(code, `ProjectMemory ${layer} store failed during ${operation}: ${formatCause(error)}`, {
        layer,
        cause: error,
      });
    }
  }
}

function formatCause(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function inspectCapsuleSource(capsule: MemoryCapsule, projectRoot: string, issues: MemoryDoctorIssue[]): MemoryDoctorCapsuleEntry {
  const source = capsule.source;
  if (!source) {
    return capsuleDoctorEntry(capsule, "untracked");
  }

  const sourcePaths = sourcePathsForInspection(source.file, source.staleIfFilesChange);
  if (sourcePaths.length === 0) {
    return capsuleDoctorEntry(capsule, "untracked");
  }

  const sourcePath = source.file;
  const referenceMs = Date.parse(source.lastVerified ?? capsule.context.timestamp);
  let stale = false;
  let brokenState: Extract<MemoryCapsuleSourceState, "missing" | "outside_project" | "invalid_source"> | undefined;

  for (const inspectedPath of sourcePaths) {
    const resolvedSourcePath = resolveSourcePath(projectRoot, inspectedPath);
    if (!isInsideProject(projectRoot, resolvedSourcePath)) {
      issues.push({
        code: "capsule_source_outside_project",
        severity: "error",
        target: { kind: "capsule", id: capsule.id },
        message: `Memory capsule ${capsule.id} references a source outside the project root.`,
        path: inspectedPath,
      });
      brokenState = brokenState ?? "outside_project";
      continue;
    }

    if (!existsSync(resolvedSourcePath)) {
      issues.push({
        code: "capsule_source_missing",
        severity: "error",
        target: { kind: "capsule", id: capsule.id },
        message: `Memory capsule ${capsule.id} references a source file that no longer exists.`,
        path: inspectedPath,
      });
      brokenState = brokenState ?? "missing";
      continue;
    }

    if (inspectedPath === sourcePath && source.lines && !sourceLinesWithinFile(resolvedSourcePath, source.lines)) {
      issues.push({
        code: "capsule_source_invalid_lines",
        severity: "error",
        target: { kind: "capsule", id: capsule.id },
        message: `Memory capsule ${capsule.id} references source lines outside the current file.`,
        path: inspectedPath,
      });
      brokenState = brokenState ?? "invalid_source";
    }

    const modifiedAtMs = statSync(resolvedSourcePath).mtimeMs;
    if (modifiedAtMs > referenceMs + 1000) {
      issues.push({
        code: "capsule_source_newer",
        severity: "warning",
        target: { kind: "capsule", id: capsule.id },
        message: `Memory capsule ${capsule.id} may be stale because its source file changed after the capsule was verified.`,
        path: inspectedPath,
      });
      stale = true;
    }
  }

  if (brokenState) {
    return capsuleDoctorEntry(capsule, brokenState, sourcePath);
  }
  if (stale) {
    return capsuleDoctorEntry(capsule, "stale", sourcePath);
  }

  return capsuleDoctorEntry(capsule, "fresh", sourcePath);
}

function sourcePathsForInspection(sourcePath: string | undefined, staleIfFilesChange: string[] | undefined): string[] {
  return [...new Set([...(sourcePath ? [sourcePath] : []), ...(staleIfFilesChange ?? [])])];
}

function sourceLinesWithinFile(path: string, lines: [number, number]): boolean {
  const lineCount = readFileSync(path, "utf-8").split(/\r?\n/).length;
  return lines[0] <= lineCount && lines[1] <= lineCount;
}

function capsuleDoctorEntry(capsule: MemoryCapsule, sourceState: MemoryCapsuleSourceState, sourcePath?: string): MemoryDoctorCapsuleEntry {
  const source = capsule.source;
  return {
    id: capsule.id,
    type: capsule.type,
    priority: capsule.priority,
    timestamp: capsule.context.timestamp,
    sourceState,
    ...(sourcePath ? { sourcePath } : {}),
    ...(source?.lines ? { sourceLines: source.lines } : {}),
    ...(source?.commit ? { sourceCommit: source.commit } : {}),
    ...(source?.confidence ? { sourceConfidence: source.confidence as MemorySourceConfidence } : {}),
    ...(source?.lastVerified ? { lastVerified: source.lastVerified } : {}),
    ...(source?.staleIfFilesChange ? { staleIfFilesChange: [...source.staleIfFilesChange] } : {}),
  };
}

function resolveSourcePath(projectRoot: string, sourcePath: string): string {
  return isAbsolute(sourcePath) ? resolve(sourcePath) : resolve(projectRoot, sourcePath);
}

function isInsideProject(projectRoot: string, targetPath: string): boolean {
  const relativePath = relative(resolve(projectRoot), resolve(targetPath));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
