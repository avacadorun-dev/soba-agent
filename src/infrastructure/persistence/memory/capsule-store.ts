import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  CapsuleListFilters,
  CapsulePriority,
  CapsulePruneResult,
  CapsuleRelevanceQuery,
  CapsuleRelevanceResult,
  CapsuleStoreOptions,
  CapsuleType,
  MemoryCapsule,
  MemoryCapsuleInput,
  MemoryIndex,
  MemorySourceConfidence,
} from "../../../kernel/memory/types";
import {
  CAPSULE_PRIORITIES,
  CAPSULE_TYPES,
  MEMORY_SOURCE_CONFIDENCE_VALUES,
} from "../../../kernel/memory/types";

const CAPSULE_STORE_VERSION = 1;
const DEFAULT_MAX_CAPSULES = 50;
const LOW_PRIORITY_PRUNE_DAYS = 30;
const CAPSULE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export type CapsuleStoreErrorCode =
  | "unknown_capsule"
  | "invalid_capsule"
  | "invalid_capsule_id"
  | "corrupted_capsule"
  | "corrupted_index";

export interface CapsuleStoreCorruption {
  id: string;
  path: string;
  message: string;
}

export interface CapsuleStoreInspection {
  capsules: MemoryCapsule[];
  corruptions: CapsuleStoreCorruption[];
}

export class CapsuleStoreError extends Error {
  readonly code: CapsuleStoreErrorCode;

  constructor(code: CapsuleStoreErrorCode, message: string) {
    super(message);
    this.name = "CapsuleStoreError";
    this.code = code;
  }
}

export class CapsuleStore {
  private readonly projectRoot: string;
  private readonly memoryDir: string;
  private readonly capsulesDir: string;
  private readonly indexPath: string;
  private readonly maxCapsules: number;
  private readonly now: () => Date;
  private readonly idGenerator?: (capsule: Omit<MemoryCapsule, "id">) => string;

  constructor(options: CapsuleStoreOptions) {
    this.projectRoot = resolve(options.projectRoot);
    this.memoryDir = resolve(options.memoryDir ?? join(this.projectRoot, ".soba", "memory"));
    this.capsulesDir = join(this.memoryDir, "capsules");
    this.indexPath = join(this.capsulesDir, "index.json");
    this.maxCapsules = options.maxCapsules ?? DEFAULT_MAX_CAPSULES;
    this.now = options.now ?? (() => new Date());
    this.idGenerator = options.idGenerator;
  }

  init(): void {
    mkdirSync(this.capsulesDir, { recursive: true });

    if (!existsSync(this.indexPath)) {
      this.writeIndex(this.createIndex([]));
      return;
    }

    try {
      this.readIndex();
    } catch {
      this.rebuildIndex();
    }
  }

  getCapsulesDir(): string {
    return this.capsulesDir;
  }

  getIndexPath(): string {
    return this.indexPath;
  }

  add(input: MemoryCapsuleInput): MemoryCapsule {
    this.init();

    const timestamp = input.context?.timestamp ?? this.now().toISOString();
    const capsuleWithoutId: Omit<MemoryCapsule, "id"> = {
      type: input.type,
      summary: input.summary,
      detail: input.detail,
      context: {
        task: input.context?.task ?? "",
        sessionId: input.context?.sessionId ?? "",
        timestamp,
      },
      priority: input.priority,
      tags: normalizeTags(input.tags ?? []),
      related: [...(input.related ?? [])],
      ...(input.source ? { source: input.source } : {}),
    };
    const capsule: MemoryCapsule = {
      id: input.id ?? this.createCapsuleId(capsuleWithoutId),
      ...capsuleWithoutId,
    };

    validateCapsule(capsule);
    writeFileSync(this.pathForId(capsule.id), `${JSON.stringify(capsule, null, 2)}\n`, "utf-8");
    this.writeIndex(this.createIndex(this.readAllCapsules()));

    return capsule;
  }

  get(id: string): MemoryCapsule {
    this.init();
    return this.readCapsuleFile(id);
  }

  list(filters: CapsuleListFilters = {}): MemoryCapsule[] {
    this.init();
    return this.readAllCapsules()
      .filter((capsule) => matchesFilters(capsule, filters))
      .sort(compareByTimestampDescThenId);
  }

  inspectFiles(): CapsuleStoreInspection {
    this.init();
    return this.inspectCapsuleFiles();
  }

  getRelevant(query: string | CapsuleRelevanceQuery): CapsuleRelevanceResult[] {
    const normalizedQuery = normalizeRelevanceQuery(query, this.now().toISOString());

    return this.list()
      .filter(isEligibleForAutomaticRetrieval)
      .map((capsule) => ({
        capsule,
        score: scoreCapsule(capsule, normalizedQuery),
      }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || compareByTimestampDescThenId(a.capsule, b.capsule))
      .slice(0, normalizedQuery.limit);
  }

  prune(maxCapsules = this.maxCapsules): CapsulePruneResult {
    this.init();

    const capsules = this.readAllCapsules();
    const now = this.now();
    const forcedLowPriority = capsules
      .filter((capsule) => shouldPruneLowPriority(capsule, now))
      .sort(compareByTimestampAscThenPriority);

    const removeIds = new Set<string>();
    for (const capsule of forcedLowPriority) {
      removeIds.add(capsule.id);
    }

    const afterForced = capsules.filter((capsule) => !removeIds.has(capsule.id));
    const overflow = afterForced.length - maxCapsules;
    if (overflow > 0) {
      const overflowCandidates = afterForced
        .filter((capsule) => capsule.priority !== "critical")
        .sort(compareByPrunePriority);

      for (const capsule of overflowCandidates.slice(0, overflow)) {
        removeIds.add(capsule.id);
      }
    }

    const removedIds = [...removeIds].sort();
    for (const id of removedIds) {
      rmSync(this.pathForId(id), { force: true });
    }

    const kept = this.readAllCapsules();
    this.writeIndex(this.createIndex(kept));

    return {
      removedIds,
      keptCount: kept.length,
    };
  }

  readIndexFile(): MemoryIndex {
    this.init();
    return this.readIndex();
  }

  rebuildIndex(): MemoryIndex {
    this.initDirectory();
    const index = this.createIndex(this.readAllCapsules());
    this.writeIndex(index);
    return index;
  }

  private initDirectory(): void {
    mkdirSync(this.capsulesDir, { recursive: true });
  }

  private createCapsuleId(capsule: Omit<MemoryCapsule, "id">): string {
    if (this.idGenerator) {
      return this.idGenerator(capsule);
    }

    const hash = createHash("sha256")
      .update(JSON.stringify(capsule))
      .update(randomUUID())
      .digest("hex")
      .slice(0, 12);

    return `mem_${capsule.context.timestamp.replace(/[:.]/g, "-")}_${hash}`;
  }

  private readAllCapsules(): MemoryCapsule[] {
    return this.inspectCapsuleFiles().capsules;
  }

  private inspectCapsuleFiles(): CapsuleStoreInspection {
    if (!existsSync(this.capsulesDir)) {
      return { capsules: [], corruptions: [] };
    }

    const capsules: MemoryCapsule[] = [];
    const corruptions: CapsuleStoreCorruption[] = [];
    for (const fileName of readdirSync(this.capsulesDir).filter((entry) => entry.endsWith(".json") && entry !== "index.json")) {
      const id = fileName.slice(0, -".json".length);
      try {
        capsules.push(this.readCapsuleFile(id));
      } catch (error) {
        corruptions.push({
          id,
          path: join(this.capsulesDir, fileName),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      capsules,
      corruptions,
    };
  }

  private readCapsuleFile(id: string): MemoryCapsule {
    const path = this.pathForId(id);
    if (!existsSync(path)) {
      throw new CapsuleStoreError("unknown_capsule", `Memory capsule not found: ${id}`);
    }

    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
      validateCapsule(parsed);
      return parsed;
    } catch (error) {
      if (error instanceof CapsuleStoreError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new CapsuleStoreError("corrupted_capsule", `Could not parse memory capsule ${id}: ${message}`);
    }
  }

  private createIndex(capsules: MemoryCapsule[]): MemoryIndex {
    return {
      version: CAPSULE_STORE_VERSION,
      lastUpdated: this.now().toISOString(),
      capsuleCount: capsules.length,
      capsules: capsules.sort(compareByTimestampDescThenId).map((capsule) => ({
        id: capsule.id,
        type: capsule.type,
        summary: capsule.summary,
        priority: capsule.priority,
        tags: capsule.tags,
        timestamp: capsule.context.timestamp,
      })),
    };
  }

  private readIndex(): MemoryIndex {
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, "utf-8")) as unknown;
      validateIndex(parsed);
      return parsed;
    } catch (error) {
      if (error instanceof CapsuleStoreError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new CapsuleStoreError("corrupted_index", `Could not parse memory capsule index: ${message}`);
    }
  }

  private writeIndex(index: MemoryIndex): void {
    this.initDirectory();
    writeFileSync(this.indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf-8");
  }

  private pathForId(id: string): string {
    if (!CAPSULE_ID_PATTERN.test(id)) {
      throw new CapsuleStoreError("invalid_capsule_id", `Invalid memory capsule id: ${id}`);
    }

    return join(this.capsulesDir, `${id}.json`);
  }
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}

function validateCapsule(value: unknown): asserts value is MemoryCapsule {
  if (!isRecord(value)) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule must be an object");
  }

  if (typeof value.id !== "string" || !CAPSULE_ID_PATTERN.test(value.id)) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule id is invalid");
  }
  if (!CAPSULE_TYPES.includes(value.type as CapsuleType)) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule type is invalid");
  }
  if (typeof value.summary !== "string" || value.summary.trim().length === 0) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule summary is required");
  }
  if (typeof value.detail !== "string") {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule detail must be a string");
  }
  if (!CAPSULE_PRIORITIES.includes(value.priority as CapsulePriority)) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule priority is invalid");
  }
  if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string")) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule tags must be strings");
  }
  if (!Array.isArray(value.related) || !value.related.every((id) => typeof id === "string")) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule related ids must be strings");
  }
  if (!isRecord(value.context)) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule context is required");
  }
  if (typeof value.context.task !== "string" || typeof value.context.sessionId !== "string") {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule context task/sessionId must be strings");
  }
  if (typeof value.context.timestamp !== "string" || Number.isNaN(Date.parse(value.context.timestamp))) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule timestamp is invalid");
  }
  validateCapsuleSource(value.source);
}

function validateCapsuleSource(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule source must be an object");
  }
  if ((value.error === undefined) !== (value.fix === undefined)) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule source error/fix must be provided together");
  }
  if (value.error !== undefined && (typeof value.error !== "string" || typeof value.fix !== "string")) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule source error/fix must be strings when provided");
  }
  if (value.file !== undefined && typeof value.file !== "string") {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule source file must be a string");
  }
  if (value.lines !== undefined && !isValidSourceLines(value.lines)) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule source lines must be [start,end] positive integers");
  }
  if (value.commit !== undefined && (typeof value.commit !== "string" || value.commit.trim().length === 0)) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule source commit must be a non-empty string");
  }
  if (
    value.confidence !== undefined &&
    !MEMORY_SOURCE_CONFIDENCE_VALUES.includes(value.confidence as MemorySourceConfidence)
  ) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule source confidence is invalid");
  }
  if (value.lastVerified !== undefined && (typeof value.lastVerified !== "string" || Number.isNaN(Date.parse(value.lastVerified)))) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule source lastVerified timestamp is invalid");
  }
  if (value.staleIfFilesChange !== undefined && (!Array.isArray(value.staleIfFilesChange) || !value.staleIfFilesChange.every((path) => typeof path === "string"))) {
    throw new CapsuleStoreError("invalid_capsule", "Memory capsule source staleIfFilesChange must be an array of strings");
  }
}

function isValidSourceLines(value: unknown): value is [number, number] {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every((line) => Number.isInteger(line) && line > 0) &&
    value[0] <= value[1];
}

function validateIndex(value: unknown): asserts value is MemoryIndex {
  if (!isRecord(value)) {
    throw new CapsuleStoreError("corrupted_index", "Memory capsule index must be an object");
  }

  if (value.version !== CAPSULE_STORE_VERSION) {
    throw new CapsuleStoreError("corrupted_index", "Memory capsule index version is unsupported");
  }
  if (typeof value.lastUpdated !== "string" || Number.isNaN(Date.parse(value.lastUpdated))) {
    throw new CapsuleStoreError("corrupted_index", "Memory capsule index timestamp is invalid");
  }
  if (typeof value.capsuleCount !== "number" || !Array.isArray(value.capsules)) {
    throw new CapsuleStoreError("corrupted_index", "Memory capsule index shape is invalid");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesFilters(capsule: MemoryCapsule, filters: CapsuleListFilters): boolean {
  if (filters.type && capsule.type !== filters.type) {
    return false;
  }

  if (filters.tags && filters.tags.length > 0) {
    const expectedTags = normalizeTags(filters.tags);
    if (!expectedTags.every((tag) => capsule.tags.includes(tag))) {
      return false;
    }
  }

  if (filters.priority) {
    const priorities = Array.isArray(filters.priority) ? filters.priority : [filters.priority];
    if (!priorities.includes(capsule.priority)) {
      return false;
    }
  }

  const timestamp = Date.parse(capsule.context.timestamp);
  if (filters.from && timestamp < Date.parse(filters.from)) {
    return false;
  }
  if (filters.to && timestamp > Date.parse(filters.to)) {
    return false;
  }

  return true;
}

function isEligibleForAutomaticRetrieval(capsule: MemoryCapsule): boolean {
  return !(capsule.tags.includes("context-capsule") && capsule.tags.includes("degraded"));
}

function normalizeRelevanceQuery(query: string | CapsuleRelevanceQuery, defaultNow: string): Required<CapsuleRelevanceQuery> {
  if (typeof query === "string") {
    return {
      text: query,
      tags: tokenize(query),
      limit: 10,
      now: defaultNow,
    };
  }

  const text = query.text ?? "";
  return {
    text,
    tags: normalizeTags(query.tags ?? tokenize(text)),
    limit: query.limit ?? 10,
    now: query.now ?? defaultNow,
  };
}

function scoreCapsule(capsule: MemoryCapsule, query: Required<CapsuleRelevanceQuery>): number {
  const queryTerms = tokenize(query.text);
  const tagMatches = query.tags.filter((tag) => capsule.tags.includes(tag)).length;
  const textMatches = queryTerms.filter((term) => capsule.summary.toLowerCase().includes(term) || capsule.detail.toLowerCase().includes(term)).length;
  const priorityScore = priorityWeight(capsule.priority);
  const recencyScore = recencyWeight(capsule.context.timestamp, query.now);

  return tagMatches * 10 + textMatches * 2 + priorityScore + recencyScore;
}

function tokenize(value: string): string[] {
  return normalizeTags(value.split(/[^\p{L}\p{N}_-]+/u));
}

function priorityWeight(priority: CapsulePriority): number {
  switch (priority) {
    case "critical":
      return 8;
    case "high":
      return 5;
    case "medium":
      return 3;
    case "low":
      return 1;
  }
}

function recencyWeight(timestamp: string, now: string): number {
  const ageMs = Math.max(0, Date.parse(now) - Date.parse(timestamp));
  const ageDays = ageMs / (24 * 60 * 60 * 1000);

  if (ageDays <= 7) return 3;
  if (ageDays <= 30) return 2;
  if (ageDays <= 90) return 1;
  return 0;
}

function shouldPruneLowPriority(capsule: MemoryCapsule, now: Date): boolean {
  if (capsule.priority !== "low") {
    return false;
  }

  const ageMs = now.getTime() - Date.parse(capsule.context.timestamp);
  return ageMs > LOW_PRIORITY_PRUNE_DAYS * 24 * 60 * 60 * 1000;
}

function compareByTimestampDescThenId(a: MemoryCapsule, b: MemoryCapsule): number {
  return b.context.timestamp.localeCompare(a.context.timestamp) || a.id.localeCompare(b.id);
}

function compareByTimestampAscThenPriority(a: MemoryCapsule, b: MemoryCapsule): number {
  return a.context.timestamp.localeCompare(b.context.timestamp) || priorityWeight(a.priority) - priorityWeight(b.priority);
}

function compareByPrunePriority(a: MemoryCapsule, b: MemoryCapsule): number {
  return priorityWeight(a.priority) - priorityWeight(b.priority) || a.context.timestamp.localeCompare(b.context.timestamp) || a.id.localeCompare(b.id);
}
