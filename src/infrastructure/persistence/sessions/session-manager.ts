/**
 * Session Manager for SOBA Agent.
 *
 * Manages conversation sessions as append-only trees stored in JSONL files.
 * Each session entry has id/parentId forming a tree structure. The "leaf"
 * pointer tracks the current position. Appending creates a child of the
 * current leaf. Branching moves the leaf to an earlier entry.
 *
 * Based on pi-agent SessionManager, adapted for OpenResponses ItemParam model.
 */

import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildContextCapsuleInput,
  serializeCapsuleContext,
  serializePortableState,
} from "../../../kernel/session/context-capsule-input";
import { CURRENT_SESSION_VERSION } from "../../../kernel/session/version";
import type {
  CompactionEntry,
  CompactionSummaryItemParam,
  DebugEntry,
  FileEntry,
  FlightRecordData,
  FlightRecordEntry,
  ItemParam,
  SessionEntry,
  SessionHeader,
  SessionInfo,
  SessionInput,
  SessionItemEntry,
  SessionTreeNode,
} from "../../../kernel/transcript/types";
import type {
  ActivatedSkillRef,
  ContextCapsuleEntry,
  SessionCursorEntry,
  SessionMigrationEntry,
  SkillActivationEntry,
} from "../../../kernel/transcript/types-v2";
import {
  generateCheckpointId,
  isContextCapsuleEntry,
  isSessionCursorEntry,
  isSessionMigrationEntry,
  isSkillActivationEntry,
} from "../../../kernel/transcript/types-v2";
import { redactDebugRecordData, redactFlightRecordData } from "./flight-record";

// ─── Constants ───

export { CURRENT_SESSION_VERSION };

/** Characters-per-token estimate for text content */
const CHARS_PER_TOKEN = 3.5;

// ─── ID Generation ───

function generateId(existing: Set<string>): string {
  for (let i = 0; i < 100; i++) {
    const id = randomUUID().slice(0, 8);
    if (!existing.has(id)) return id;
  }
  return randomUUID();
}

// ─── Session encoding ───

/**
 * Encode a path for use in session directory name.
 * Replaces path separators with dashes.
 */
export function encodeSessionPath(cwd: string): string {
  const resolved = resolve(cwd);
  // Replace / with - and remove leading -
  return resolved
    .replace(/\//g, "-")
    .replace(/^-/, "")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

/** Decode a session directory name back to a path. */
export function decodeSessionPath(encoded: string): string {
  return `/${encoded.replace(/-/g, "/")}`;
}

/** Get default session directory: ~/.soba/sessions/<encoded-cwd>/ */
export function getDefaultSessionDir(cwd: string): string {
  return join(homedir(), ".soba", "sessions", encodeSessionPath(cwd));
}

// ─── Token estimation ───

/**
 * Estimate tokens in an ItemParam.
 * Uses conservative chars-per-token heuristic.
 */
export function estimateItemTokens(item: ItemParam): number {
  let text = "";
  if (item.type === "message") {
    if (Array.isArray(item.content)) {
      for (const block of item.content) {
        if ("text" in block) text += block.text;
      }
    } else {
      text = String(item.content);
    }
    if ("reasoning_content" in item && typeof item.reasoning_content === "string") {
      text += item.reasoning_content;
    }
  } else if (item.type === "function_call") {
    text = `${item.name}: ${item.arguments}`;
    if (typeof item.reasoning_content === "string") {
      text += item.reasoning_content;
    }
  } else if (item.type === "function_call_output") {
    text =
      typeof item.output === "string"
        ? item.output
        : JSON.stringify(item.output);
  } else if (item.type === "local_shell_call") {
    text = `shell: ${item.command}`;
  } else if (item.type === "local_shell_call_output") {
    text = item.output;
  } else if (item.type === "compaction") {
    text = item.encrypted_content;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Estimate tokens in an entire array of items */
export function estimateTokens(items: ItemParam[]): number {
  return items.reduce((sum, item) => sum + estimateItemTokens(item), 0);
}

// ─── SessionManager ───

export class SessionManager {
  private sessionId: string;
  private sessionFile: string | undefined;
  private sessionDir: string;
  private cwd: string;
  private persist: boolean;

  private fileEntries: FileEntry[];
  private byId: Map<string, SessionEntry>;
  private leafId: string | null;

  /** Whether this session has been migrated to v2 (has a session_migration entry) */
  private _isMigratedToV2: boolean;
  /** All checkpoint IDs seen in this session (for uniqueness) */
  private _checkpointIds: Set<string>;

  private constructor(
    sessionId: string,
    cwd: string,
    sessionDir: string,
    persist: boolean,
    sessionFile?: string,
  ) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.sessionDir = sessionDir;
    this.persist = persist;
    this.sessionFile = sessionFile;
    this.fileEntries = [];
    this.byId = new Map();
    this.leafId = null;
    this._isMigratedToV2 = false;
    this._checkpointIds = new Set();
  }

  // ─── Static factory methods ───

  /**
   * Create a new session.
   * @param cwd Working directory
   * @param sessionDir Optional. Default: ~/.soba/sessions/<encoded-cwd>/
   */
  static create(cwd: string, sessionDir?: string): SessionManager {
    const resolvedCwd = resolve(cwd || process.cwd());
    const dir = sessionDir || getDefaultSessionDir(resolvedCwd);
    const id = randomUUID();
    const timestamp = new Date().toISOString();

    const sm = new SessionManager(id, resolvedCwd, dir, true);
    sm.sessionFile = join(
      dir,
      `${timestamp.replace(/:/g, "-")}_${id.slice(0, 8)}.jsonl`,
    );

    // Write header
    const header: SessionHeader = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id,
      timestamp,
      cwd: resolvedCwd,
    };
    sm._persist(header);
    sm.fileEntries.push(header);

    return sm;
  }

  /**
   * Open an existing session file.
   * @param path Path to session JSONL file
   * @param sessionDir Optional. Default: derived from file's parent.
   */
  static open(path: string, sessionDir?: string): SessionManager {
    const entries = loadEntriesFromFile(path);
    const header = entries.find((e) => e.type === "session") as
      | SessionHeader
      | undefined;
    if (!header) throw new Error(`Invalid session file: ${path} (no header)`);

    const treeEntries = entries.filter(
      (e): e is SessionEntry =>
        e.type === "item" ||
        e.type === "compaction" ||
        (e.type as string) === "context_capsule" ||
        (e.type as string) === "skill_activation",
    );
    const dir = sessionDir || join(path, "..");

    const sm = new SessionManager(
      header.id,
      header.cwd,
      resolve(dir),
      true,
      resolve(path),
    );
    sm.fileEntries = [...entries];

    // Build index
    for (const e of treeEntries) {
      sm.byId.set(e.id, e);
    }

    // Detect v2 migration
    sm._isMigratedToV2 = entries.some((e) =>
      isSessionMigrationEntry(e as { type: string }),
    );

    // Collect checkpoint IDs
    for (const e of entries) {
      if (isContextCapsuleEntry(e as { type: string })) {
        sm._checkpointIds.add((e as ContextCapsuleEntry).checkpointId);
      }
    }

    // Restore leaf from persistent cursor (last valid session_cursor entry)
    let cursorLeafId: string | null | undefined = undefined;
    for (const e of entries) {
      if (isSessionCursorEntry(e as { type: string })) {
        cursorLeafId = (e as SessionCursorEntry).leafId;
      }
    }

    if (cursorLeafId !== undefined) {
      // Cursor was found — use it (may be null for reset)
      sm.leafId =
        cursorLeafId !== null && sm.byId.has(cursorLeafId)
          ? cursorLeafId
          : cursorLeafId;
    } else {
      // No cursor: v1 fallback — find leaf entry with no children
      const childIds = new Set(
        treeEntries
          .map((e) => e.parentId)
          .filter((p): p is string => p !== null),
      );
      for (const e of treeEntries) {
        if (!childIds.has(e.id)) {
          sm.leafId = e.id;
          break;
        }
      }
      // If no leaf found (all entries have children), use the last one
      if (!sm.leafId && treeEntries.length > 0) {
        sm.leafId = treeEntries[treeEntries.length - 1].id;
      }
    }

    return sm;
  }

  /**
   * Continue the most recent session, or create a new one.
   */
  static continueRecent(cwd: string, sessionDir?: string): SessionManager {
    const resolvedCwd = resolve(cwd || process.cwd());
    const dir = sessionDir || getDefaultSessionDir(resolvedCwd);

    const mostRecent = findMostRecentSession(dir);
    if (mostRecent) {
      return SessionManager.open(mostRecent, dir);
    }
    return SessionManager.create(resolvedCwd, dir);
  }

  /**
   * Open a session by full ID or unique ID prefix.
   */
  static openById(
    cwd: string,
    sessionId: string,
    sessionDir?: string,
  ): SessionManager {
    const resolvedCwd = resolve(cwd || process.cwd());
    const dir = sessionDir || getDefaultSessionDir(resolvedCwd);
    const matches = findSessionsById(dir, sessionId);

    if (matches.length === 0) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (matches.length > 1) {
      throw new Error(`Session ID is ambiguous: ${sessionId}`);
    }

    return SessionManager.open(matches[0], dir);
  }

  /**
   * Create an in-memory session (no file persistence).
   */
  static inMemory(cwd?: string): SessionManager {
    const resolvedCwd = resolve(cwd || process.cwd());
    const id = randomUUID();
    const sm = new SessionManager(id, resolvedCwd, "", false);
    sm.leafId = null;

    // Store header in memory (not persisted to disk)
    sm.fileEntries.push({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id,
      timestamp: new Date().toISOString(),
      cwd: resolvedCwd,
    });

    return sm;
  }

  /**
   * Create an in-memory session already migrated to v2.
   */
  static inMemoryV2(cwd?: string): SessionManager {
    const sm = SessionManager.inMemory(cwd);
    sm._ensureMigratedToV2();
    return sm;
  }

  // ─── Persistence ───

  /**
   * Write a single entry to the session file (append-only).
   */
  _persist(entry: FileEntry): void {
    if (!this.persist || !this.sessionFile) return;

    const dir = join(this.sessionFile, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
  }

  /**
   * Append a tree entry and advance leaf.
   * For v2 entries, also writes a session_cursor sidecar.
   */
  private _appendEntry(entry: SessionEntry): string {
    // For in-memory sessions, create a header if needed
    if (!this.persist && this.fileEntries.length === 0) {
      this.fileEntries.push({
        type: "session",
        version: CURRENT_SESSION_VERSION,
        id: this.sessionId,
        timestamp: new Date().toISOString(),
        cwd: this.cwd,
      });
    }

    this.fileEntries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this._persist(entry);

    // Write cursor sidecar for v2 sessions so leaf survives restart
    if (this._isMigratedToV2) {
      this._writeCursor(entry.id, "append");
    }

    return entry.id;
  }

  /**
   * Ensure this session has a migration marker (v1 → v2).
   * Idempotent — only writes the marker once.
   */
  private _ensureMigratedToV2(): void {
    if (this._isMigratedToV2) return;
    this._isMigratedToV2 = true;
    const migrationEntry: SessionMigrationEntry = {
      type: "session_migration",
      timestamp: new Date().toISOString(),
      fromVersion: 1,
      toVersion: 2,
    };
    this.fileEntries.push(migrationEntry);
    this._persist(migrationEntry as unknown as FileEntry);
  }

  /**
   * Write a session_cursor sidecar entry (not part of conversation tree).
   */
  private _writeCursor(
    leafId: string | null,
    reason: SessionCursorEntry["reason"],
  ): void {
    const cursor: SessionCursorEntry = {
      type: "session_cursor",
      timestamp: new Date().toISOString(),
      leafId,
      reason,
    };
    this.fileEntries.push(cursor);
    this._persist(cursor as unknown as FileEntry);
  }

  // ─── Public API: Append items ───

  /**
   * Append an OpenResponses item as child of current leaf.
   */
  appendItem(item: ItemParam): string {
    const id = generateId(new Set(this.byId.keys()));
    const entry: SessionItemEntry = {
      type: "item",
      id,
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      item,
    };
    return this._appendEntry(entry);
  }

  /**
   * Append a debug entry directly to the session file.
   * Debug entries are sidecar metadata — they don't participate
   * in the conversation tree and are skipped during input building.
   */
  appendDebug(data: DebugEntry["data"]): void {
    const entry: DebugEntry = {
      type: "debug",
      timestamp: new Date().toISOString(),
      data: redactDebugRecordData(data),
    };
    this.fileEntries.push(entry);
    this._persist(entry);
  }

  appendFlightRecord(data: FlightRecordData): void {
    const entry: FlightRecordEntry = {
      type: "flight_record",
      timestamp: new Date().toISOString(),
      data: redactFlightRecordData(data),
    };
    this.fileEntries.push(entry);
    this._persist(entry);
  }

  /**
   * Append a compaction checkpoint.
   * Creates a CompactionEntry as child of current leaf.
   */
  appendCompaction(
    responseId: string,
    compactionItem: CompactionSummaryItemParam,
    firstKeptEntryId: string,
    tokensBefore: number,
  ): string {
    const id = generateId(new Set(this.byId.keys()));
    const entry: CompactionEntry = {
      type: "compaction",
      id,
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      responseId,
      compactionItem,
      tokensBefore,
      firstKeptEntryId,
    };
    return this._appendEntry(entry);
  }

  // ─── Public API: Navigation ───

  /** Get current leaf entry ID */
  getLeafId(): string | null {
    return this.leafId;
  }

  /** Get the current leaf entry */
  getLeafEntry(): SessionEntry | undefined {
    if (!this.leafId) return undefined;
    return this.byId.get(this.leafId);
  }

  /** Get any entry by ID */
  getEntry(id: string): SessionEntry | undefined {
    return this.byId.get(id);
  }

  /**
   * Walk from a given entry ID (or leaf) to root.
   * Returns entries in path order (root → leaf).
   */
  getBranch(fromId?: string): SessionEntry[] {
    const startId = fromId ?? this.leafId;
    if (!startId) return [];

    const path: SessionEntry[] = [];
    let currentId: string | null = startId;

    while (currentId !== null) {
      const entry = this.byId.get(currentId);
      if (!entry) break;
      path.unshift(entry);
      currentId = entry.parentId;
    }

    return path;
  }

  /**
   * Move leaf pointer to an earlier entry (branching / rewind).
   * The next append will create a child of this entry.
   * In v2 sessions also writes a cursor sidecar so restart restores this leaf.
   */
  branch(entryId: string): void {
    const entry = this.byId.get(entryId);
    if (!entry) throw new Error(`Entry not found: ${entryId}`);
    this.leafId = entryId;
    if (this._isMigratedToV2) {
      this._writeCursor(entryId, "rewind");
    }
  }

  /**
   * Reset leaf to null (before any entries).
   * In v2 sessions also writes a cursor sidecar.
   */
  resetLeaf(): void {
    this.leafId = null;
    if (this._isMigratedToV2) {
      this._writeCursor(null, "reset");
    }
  }

  // ─── Public API: Read ───

  /** Get session header */
  getHeader(): SessionHeader | null {
    const h = this.fileEntries.find((e) => e.type === "session");
    return (h as SessionHeader) ?? null;
  }

  /** Get all tree entries (excludes header and sidecars). Returns a copy. */
  getEntries(): SessionEntry[] {
    return this.fileEntries.filter(
      (e): e is SessionEntry =>
        e.type === "item" ||
        e.type === "compaction" ||
        e.type === "context_capsule" ||
        e.type === "skill_activation",
    );
  }

  /** Get diagnostic sidecar entries. Returns a copy. */
  getDebugEntries(): DebugEntry[] {
    return this.fileEntries.filter((e): e is DebugEntry => e.type === "debug");
  }

  getFlightRecords(): FlightRecordEntry[] {
    return this.fileEntries.filter((e): e is FlightRecordEntry => e.type === "flight_record");
  }

  /** Get session working directory */
  getCwd(): string {
    return this.cwd;
  }

  /** Get session directory */
  getSessionDir(): string {
    return this.sessionDir;
  }

  /** Get session ID (UUID) */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Get session file path (undefined for in-memory sessions) */
  getSessionFile(): string | undefined {
    return this.sessionFile;
  }

  /** Whether the session is persisted to disk */
  isPersisted(): boolean {
    return this.persist;
  }

  /**
   * Get the session as a tree structure.
   */
  getTree(): SessionTreeNode[] {
    const entries = this.getEntries();
    if (entries.length === 0) return [];

    // Build child map
    const childrenMap = new Map<string, SessionTreeNode[]>();
    for (const entry of entries) {
      const parent = entry.parentId ?? "__root__";
      if (!childrenMap.has(parent)) {
        childrenMap.set(parent, []);
      }
      childrenMap.get(parent)?.push({ entry, children: [] });
    }

    // Recursively build tree
    function buildTree(parentId: string): SessionTreeNode[] {
      const children = childrenMap.get(parentId) ?? [];
      for (const node of children) {
        node.children = buildTree(node.entry.id);
      }
      return children;
    }

    return buildTree("__root__");
  }

  // ─── Public API: v2 appends ───

  /**
   * Append a Context Capsule entry to the session tree.
   * Automatically triggers v2 migration if needed.
   */
  appendContextCapsule(
    capsule: Omit<
      ContextCapsuleEntry,
      "id" | "parentId" | "timestamp" | "type"
    >,
  ): string {
    this._ensureMigratedToV2();
    const id = generateId(new Set(this.byId.keys()));
    const entry: ContextCapsuleEntry = {
      type: "context_capsule",
      id,
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      ...capsule,
    };
    this._checkpointIds.add(entry.checkpointId);
    return this._appendEntry(entry as unknown as SessionEntry);
  }

  /**
   * Append a SkillActivationEntry to the session tree.
   * Automatically triggers v2 migration if needed.
   */
  appendSkillActivation(
    activation: Omit<
      SkillActivationEntry,
      "id" | "parentId" | "timestamp" | "type"
    >,
  ): string {
    this._ensureMigratedToV2();
    const id = generateId(new Set(this.byId.keys()));
    const entry: SkillActivationEntry = {
      type: "skill_activation",
      id,
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      ...activation,
    };
    return this._appendEntry(entry as unknown as SessionEntry);
  }

  /**
   * Get all context_capsule entries in the current branch (oldest → newest).
   */
  getCapsuleEntries(): ContextCapsuleEntry[] {
    return this.getBranch()
      .filter((e) => isContextCapsuleEntry(e as { type: string }))
      .map((e) => e as unknown as ContextCapsuleEntry);
  }

  /**
   * Get a context_capsule entry by checkpointId.
   */
  getCapsuleByCheckpointId(
    checkpointId: string,
  ): ContextCapsuleEntry | undefined {
    for (const entry of this.fileEntries) {
      if (isContextCapsuleEntry(entry as { type: string })) {
        const capsule = entry as unknown as ContextCapsuleEntry;
        if (capsule.checkpointId === checkpointId) return capsule;
      }
    }
    return undefined;
  }

  /**
   * Generate a new unique checkpoint ID for this session.
   */
  generateCheckpointId(): string {
    return generateCheckpointId(this._checkpointIds);
  }

  /**
   * Whether this session has been migrated to v2.
   */
  isV2(): boolean {
    return this._isMigratedToV2;
  }

  /**
   * Get the effective active skill refs from the current branch.
   *
   * Algorithm (from technical-spec.md § Effective Input):
   * 1. Start from the last context_capsule's activatedSkills (or empty set if none).
   * 2. Apply subsequent skill_activation entries in order.
   */
  getActiveSkillRefs(): ActivatedSkillRef[] {
    const branch = this.getBranch();

    // Find last capsule index
    let capsuleIdx = -1;
    let capsuleSkills: ActivatedSkillRef[] = [];
    for (let i = branch.length - 1; i >= 0; i--) {
      if (isContextCapsuleEntry(branch[i] as { type: string })) {
        capsuleIdx = i;
        capsuleSkills = (branch[i] as unknown as ContextCapsuleEntry)
          .activatedSkills;
        break;
      }
    }

    // Build active refs map (by name) starting from capsule
    const activeMap = new Map<string, ActivatedSkillRef>();
    for (const ref of capsuleSkills) {
      activeMap.set(ref.name, ref);
    }

    // Apply activation/deactivation entries after capsule
    for (let i = capsuleIdx + 1; i < branch.length; i++) {
      const entry = branch[i];
      if (isSkillActivationEntry(entry as { type: string })) {
        const activation = entry as unknown as SkillActivationEntry;
        if (activation.action === "activate") {
          activeMap.set(activation.skill.name, activation.skill);
        } else {
          activeMap.delete(activation.skill.name);
        }
      }
    }

    return Array.from(activeMap.values());
  }

  // ─── Public API: Context building ───

  /**
   * Build the input for the LLM from the current session state.
   *
   * Phase 2 algorithm:
   * 1. If branch has a context_capsule, use the most recent one as the base.
   *    - If nativeContinuation.compatibilityKey matches active provider → use native items.
   *    - Otherwise → serialize portable state as a developer message.
   * 2. If no capsule but there's a legacy compaction entry → Phase 1 algorithm.
   * 3. Append session items starting from firstKeptEntryId.
   *
   * Provider compatibility key is passed in as an optional parameter.
   */
  buildInput(providerCompatibilityKey?: string): SessionInput {
    const branch = this.getBranch();
    if (branch.length === 0) {
      return { items: [] };
    }

    // ── Phase 2: Check for context_capsule entries ──
    const capsuleEntries = branch.filter((e) =>
      isContextCapsuleEntry(e as { type: string }),
    ) as unknown as ContextCapsuleEntry[];

    if (capsuleEntries.length > 0) {
      const lastCapsule = capsuleEntries[capsuleEntries.length - 1];
      const items: ItemParam[] = [];

      items.push(...buildContextCapsuleInput(lastCapsule, providerCompatibilityKey));

      // Add session items starting from firstKeptEntryId
      const firstKeptIdx = branch.findIndex(
        (e) => e.id === lastCapsule.provenance.firstKeptEntryId,
      );
      if (firstKeptIdx >= 0) {
        for (let i = firstKeptIdx; i < branch.length; i++) {
          const entry = branch[i];
          if (entry.type === "item") {
            items.push((entry as SessionItemEntry).item);
          }
        }
      }

      return { items };
    }

    // ── Phase 1 fallback: legacy compaction entries ──
    const compactionEntries = branch.filter(
      (e) => e.type === "compaction",
    ) as CompactionEntry[];

    if (compactionEntries.length === 0) {
      // No compactions: just return all items
      const items = branch
        .filter((e) => e.type === "item")
        .map((e) => (e as SessionItemEntry).item);
      return { items };
    }

    // With compaction: start from the first (oldest) compaction on the path
    // Emit: compaction item → items from firstKeptEntryId → ... → leaf items
    // Only use the most recent compaction (the one closest to leaf)
    const lastCompaction = compactionEntries[compactionEntries.length - 1];

    const items: ItemParam[] = [];

    // 1. Add the compaction summary item
    items.push(lastCompaction.compactionItem);

    // 2. Find index of firstKeptEntryId and include items from there
    const firstKeptIdx = branch.findIndex(
      (e) => e.id === lastCompaction.firstKeptEntryId,
    );

    if (firstKeptIdx >= 0) {
      for (let i = firstKeptIdx; i < branch.length; i++) {
        const entry = branch[i];
        if (entry.type === "item") {
          items.push((entry as SessionItemEntry).item);
        }
      }
    }

    return {
      items,
      previousResponseId: lastCompaction.responseId,
    };
  }
}

// ─── File I/O helpers ───

/**
 * Load all entries from a JSONL session file.
 */
export function loadEntriesFromFile(filePath: string): FileEntry[] {
  const content = readFileSync(filePath, "utf-8");
  return parseSessionEntries(content);
}

/**
 * Parse raw JSONL content into FileEntry array.
 */
export function parseSessionEntries(content: string): FileEntry[] {
  const entries: FileEntry[] = [];
  const lines = content.trim().split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // Skip invalid lines
    }
  }
  return entries;
}

/**
 * Find the most recent session file in a directory.
 * Returns path to JSONL file or null.
 */
export function findMostRecentSession(sessionDir: string): string | null {
  if (!existsSync(sessionDir)) return null;

  let files: string[];
  try {
    files = readdirSync(sessionDir);
  } catch {
    return null;
  }

  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
  if (jsonlFiles.length === 0) return null;

  // Sort by filename descending (filename encodes timestamp, more reliable than mtime)
  jsonlFiles.sort((a, b) => b.localeCompare(a));

  return join(sessionDir, jsonlFiles[0]);
}

/**
 * Find session files matching a full session ID or ID prefix.
 */
export function findSessionsById(
  sessionDir: string,
  sessionId: string,
): string[] {
  if (!existsSync(sessionDir) || !sessionId.trim()) return [];

  let files: string[];
  try {
    files = readdirSync(sessionDir);
  } catch {
    return [];
  }

  const matches: string[] = [];
  for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
    const path = join(sessionDir, file);
    const header = loadEntriesFromFile(path).find(
      (entry) => entry.type === "session",
    ) as SessionHeader | undefined;
    if (header?.id.startsWith(sessionId)) {
      matches.push(path);
    }
  }
  return matches;
}

/**
 * List all sessions in a directory with metadata.
 * Returns sessions sorted by timestamp descending (newest first).
 */
export function listSessions(sessionDir: string): SessionInfo[] {
  if (!existsSync(sessionDir)) return [];

  let files: string[];
  try {
    files = readdirSync(sessionDir);
  } catch {
    return [];
  }

  const sessions: SessionInfo[] = [];
  for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
    try {
      const path = join(sessionDir, file);
      const entries = loadEntriesFromFile(path);
      const header = entries.find((e) => e.type === "session") as
        | SessionHeader
        | undefined;
      if (!header) continue;
      const entryCount = entries.filter((e) => e.type === "item").length;
      sessions.push({
        id: header.id,
        timestamp: header.timestamp,
        cwd: header.cwd,
        entries: entryCount,
        filePath: path,
      });
    } catch {
      // Skip malformed files
    }
  }

  // Sort by timestamp descending (newest first)
  sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return sessions;
}

export { serializeCapsuleContext, serializePortableState };

// ─── Serialization ───

/**
 * Serialize an ItemParam to a human-readable string (for logging/debugging).
 */
export function serializeItem(item: ItemParam): string {
  switch (item.type) {
    case "message": {
      const prefix = `[${item.role}]`;
      if (Array.isArray(item.content)) {
        const text = item.content
          .map((b) => ("text" in b ? b.text : "[content]"))
          .join(" ");
        return `${prefix}: ${text}`;
      }
      return `${prefix}: ${String(item.content)}`;
    }
    case "function_call":
      return `[Tool Call: ${item.name}](${item.arguments})`;
    case "function_call_output":
      return `[Tool Result: ${item.call_id}] ${typeof item.output === "string" ? item.output.slice(0, 200) : ""}`;
    case "local_shell_call":
      return `[Shell: ${item.command}]`;
    case "local_shell_call_output":
      return `[Shell Output] ${item.output.slice(0, 200)}`;
    case "compaction":
      return `[Compaction: ${item.encrypted_content.slice(0, 200)}...]`;
    default:
      return "[unknown]";
  }
}
