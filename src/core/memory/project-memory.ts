import { join, resolve } from "node:path";
import { CapsuleStore } from "./capsule-store";
import { EntityGraphStore } from "./entity-graph";
import { KnowledgeStore } from "./knowledge-store";
import type {
  CapsuleRelevanceQuery,
  CapsuleRelevanceResult,
  EntityGraph,
  KnowledgeDocument,
  MemoryCapsule,
  MemoryCapsuleInput,
  ProjectMemoryOptions,
} from "./types";

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
  private readonly knowledge: KnowledgeStore;
  private readonly capsules: CapsuleStore;
  private readonly graph: EntityGraphStore | null;

  constructor(options: ProjectMemoryOptions) {
    this.projectRoot = resolve(options.projectRoot);
    this.memoryDir = resolve(options.memoryDir ?? join(this.projectRoot, ".soba", "memory"));
    this.contextCapsuleLimit = options.contextCapsuleLimit ?? 10;
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
