/**
 * Pure Project Memory contracts.
 *
 * These types describe persisted project knowledge and are shared by engine
 * policies, infrastructure stores, and local tools without binding those
 * layers to each other.
 */

export const KNOWLEDGE_KEYS = ["architecture", "conventions", "known-errors", "dependencies"] as const;

export type KnowledgeKey = (typeof KNOWLEDGE_KEYS)[number];

export interface KnowledgeDocument {
  key: KnowledgeKey;
  filename: string;
  path: string;
  title: string;
  content: string;
  estimatedTokens: number;
}

export interface KnowledgeStoreOptions {
  /** Project root where .soba/memory lives. */
  projectRoot: string;
  /** Optional override for tests or future ProjectMemory composition. */
  memoryDir?: string;
}

export const CAPSULE_TYPES = ["decision", "error_fix", "discovery", "pattern", "blocker", "insight"] as const;

export type CapsuleType = (typeof CAPSULE_TYPES)[number];

export const CAPSULE_PRIORITIES = ["critical", "high", "medium", "low"] as const;

export type CapsulePriority = (typeof CAPSULE_PRIORITIES)[number];

export const MEMORY_SOURCE_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;

export type MemorySourceConfidence = (typeof MEMORY_SOURCE_CONFIDENCE_VALUES)[number];

export interface MemoryCapsuleSource {
  error?: string;
  fix?: string;
  file?: string;
  lines?: [number, number];
  commit?: string;
  confidence?: MemorySourceConfidence;
  lastVerified?: string;
  staleIfFilesChange?: string[];
}

export interface MemoryCapsule {
  id: string;
  type: CapsuleType;
  summary: string;
  detail: string;
  context: {
    task: string;
    sessionId: string;
    timestamp: string;
  };
  priority: CapsulePriority;
  tags: string[];
  related: string[];
  source?: MemoryCapsuleSource;
}

export interface MemoryCapsuleInput {
  id?: string;
  type: CapsuleType;
  summary: string;
  detail: string;
  context?: {
    task?: string;
    sessionId?: string;
    timestamp?: string;
  };
  priority: CapsulePriority;
  tags?: string[];
  related?: string[];
  source?: MemoryCapsuleSource;
}

export interface CapsuleStoreOptions {
  /** Project root where .soba/memory lives. */
  projectRoot: string;
  /** Optional override for tests or future ProjectMemory composition. */
  memoryDir?: string;
  /** Maximum stored non-critical capsules after pruning. */
  maxCapsules?: number;
  /** Deterministic clock for tests. */
  now?: () => Date;
  /** Deterministic id generator for tests. */
  idGenerator?: (capsule: Omit<MemoryCapsule, "id">) => string;
}

export interface CapsuleListFilters {
  type?: CapsuleType;
  tags?: string[];
  priority?: CapsulePriority | CapsulePriority[];
  from?: string;
  to?: string;
}

export interface CapsuleRelevanceQuery {
  text?: string;
  tags?: string[];
  limit?: number;
  now?: string;
}

export interface CapsuleRelevanceResult {
  capsule: MemoryCapsule;
  score: number;
}

export interface CapsulePruneResult {
  removedIds: string[];
  keptCount: number;
}

export const ENTITY_NODE_TYPES = ["file", "function", "class", "module", "error", "dependency"] as const;
export const ENTITY_EDGE_TYPES = ["depends_on", "contains", "fixes", "related_to", "imports"] as const;

export type EntityNodeType = (typeof ENTITY_NODE_TYPES)[number];
export type EntityEdgeType = (typeof ENTITY_EDGE_TYPES)[number];
export type EntityNeighborDirection = "outgoing" | "incoming" | "both";

export interface EntityNode {
  id: string;
  type: EntityNodeType;
  name: string;
  metadata: {
    path?: string;
    lineCount?: number;
    exports?: string[];
    description?: string;
  };
}

export interface EntityEdge {
  from: string;
  to: string;
  type: EntityEdgeType;
  weight?: number;
}

export interface EntityGraph {
  nodes: EntityNode[];
  edges: EntityEdge[];
}

export interface EntityGraphStoreOptions {
  /** Project root where .soba/memory lives. */
  projectRoot: string;
  /** Optional override for tests or future ProjectMemory composition. */
  memoryDir?: string;
}

export interface EntityNeighborFilters {
  direction?: EntityNeighborDirection;
  type?: EntityEdgeType;
}

export interface EntityNeighbor {
  node: EntityNode;
  edge: EntityEdge;
  direction: Exclude<EntityNeighborDirection, "both">;
}

export interface MemoryIndex {
  version: number;
  lastUpdated: string;
  capsuleCount: number;
  capsules: Array<{
    id: string;
    type: CapsuleType;
    summary: string;
    priority: CapsulePriority;
    tags: string[];
    timestamp: string;
  }>;
}

export interface ProjectMemoryOptions {
  /** Project root where .soba/memory lives. */
  projectRoot: string;
  /** Optional path to memory directory (<project-root>/.soba/memory by default). */
  memoryDir?: string;
  /** Maximum number of capsules to keep (default: 50) */
  maxCapsules?: number;
  /** Maximum capsules to load into context (default: 10) */
  contextCapsuleLimit?: number;
  /** Estimated tokens for knowledge files (default: 5000) */
  knowledgeTokenBudget?: number;
  /** Enable persisted entity graph layer (default: true). */
  enableGraph?: boolean;
  /** Deterministic clock for tests. */
  now?: () => Date;
  /** Deterministic capsule id generator for tests. */
  idGenerator?: (capsule: Omit<MemoryCapsule, "id">) => string;
}

export type MemoryDoctorStatus = "healthy" | "stale" | "broken";
export type MemoryDoctorIssueSeverity = "warning" | "error";

export type MemoryDoctorIssueCode =
  | "capsule_corrupted"
  | "capsule_source_invalid_lines"
  | "capsule_source_missing"
  | "capsule_source_newer"
  | "capsule_source_outside_project";

export interface MemoryDoctorIssue {
  code: MemoryDoctorIssueCode;
  severity: MemoryDoctorIssueSeverity;
  target: {
    kind: "capsule";
    id: string;
  };
  message: string;
  path?: string;
}

export type MemoryCapsuleSourceState = "fresh" | "stale" | "missing" | "outside_project" | "untracked" | "corrupted" | "invalid_source";

export interface MemoryDoctorKnowledgeEntry {
  key: KnowledgeKey;
  path: string;
  estimatedTokens: number;
  bytes: number;
}

export interface MemoryDoctorCapsuleEntry {
  id: string;
  type?: CapsuleType;
  priority?: CapsulePriority;
  timestamp?: string;
  sourceState: MemoryCapsuleSourceState;
  sourcePath?: string;
  sourceLines?: [number, number];
  sourceCommit?: string;
  sourceConfidence?: MemorySourceConfidence;
  lastVerified?: string;
  staleIfFilesChange?: string[];
}

export interface MemoryDoctorReport {
  status: MemoryDoctorStatus;
  generatedAt: string;
  memoryDir: string;
  summary: {
    knowledgeFiles: number;
    knowledgeTokens: number;
    capsules: number;
    freshCapsules: number;
    staleCapsules: number;
    brokenCapsules: number;
    untrackedCapsules: number;
    issues: number;
  };
  knowledge: MemoryDoctorKnowledgeEntry[];
  capsules: MemoryDoctorCapsuleEntry[];
  issues: MemoryDoctorIssue[];
}
