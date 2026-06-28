import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapsuleStore, CapsuleStoreError } from "../../src/engine/memory/capsule-store";
import type { CapsulePriority, CapsuleType, MemoryCapsuleInput, MemoryIndex } from "../../src/engine/memory/types";

describe("CapsuleStore", () => {
  let projectRoot: string;
  let currentNow: Date;
  let idCounter: number;
  let store: CapsuleStore;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "soba-capsule-store-"));
    currentNow = new Date("2026-06-19T10:00:00.000Z");
    idCounter = 0;
    store = new CapsuleStore({
      projectRoot,
      now: () => currentNow,
      idGenerator: () => {
        idCounter += 1;
        return `cap-${String(idCounter).padStart(3, "0")}`;
      },
    });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test("add/get capsule writes JSON capsule and stable index", () => {
    const capsule = addCapsule(store, {
      type: "decision",
      summary: "Use modern MCP discovery",
      tags: ["MCP", "Discovery"],
      priority: "high",
    });

    expect(capsule.id).toBe("cap-001");
    expect(capsule.context.timestamp).toBe("2026-06-19T10:00:00.000Z");
    expect(capsule.tags).toEqual(["discovery", "mcp"]);
    expect(existsSync(join(store.getCapsulesDir(), "cap-001.json"))).toBe(true);

    const loaded = store.get("cap-001");
    expect(loaded).toEqual(capsule);
  });

  test("index updates after add", () => {
    addCapsule(store, { summary: "First", priority: "medium" });
    currentNow = new Date("2026-06-19T11:00:00.000Z");
    addCapsule(store, { summary: "Second", priority: "critical", tags: ["release"] });

    const index = JSON.parse(readFileSync(store.getIndexPath(), "utf-8")) as MemoryIndex;

    expect(index.version).toBe(1);
    expect(index.capsuleCount).toBe(2);
    expect(index.lastUpdated).toBe("2026-06-19T11:00:00.000Z");
    expect(index.capsules.map((capsule) => capsule.id)).toEqual(["cap-002", "cap-001"]);
    expect(index.capsules[0]).toMatchObject({
      id: "cap-002",
      priority: "critical",
      tags: ["release"],
      timestamp: "2026-06-19T11:00:00.000Z",
    });
  });

  test("list supports type, tags, priority and date range filters", () => {
    addCapsule(store, {
      type: "decision",
      priority: "high",
      tags: ["mcp", "config"],
      timestamp: "2026-06-18T10:00:00.000Z",
      summary: "MCP config decision",
    });
    addCapsule(store, {
      type: "error_fix",
      priority: "low",
      tags: ["test"],
      timestamp: "2026-06-19T10:00:00.000Z",
      summary: "Fix flaky test",
    });
    addCapsule(store, {
      type: "decision",
      priority: "medium",
      tags: ["mcp"],
      timestamp: "2026-06-20T10:00:00.000Z",
      summary: "MCP stdio decision",
    });

    const results = store.list({
      type: "decision",
      tags: ["mcp"],
      priority: ["high", "medium"],
      from: "2026-06-18T00:00:00.000Z",
      to: "2026-06-20T00:00:00.000Z",
    });

    expect(results.map((capsule) => capsule.summary)).toEqual(["MCP config decision"]);
  });

  test("relevance orders by tag match, priority and recency", () => {
    addCapsule(store, {
      id: "old-critical",
      priority: "critical",
      tags: ["other"],
      timestamp: "2026-01-01T00:00:00.000Z",
      summary: "Critical unrelated decision",
      detail: "No matching tag.",
    });
    addCapsule(store, {
      id: "recent-low",
      priority: "low",
      tags: ["mcp"],
      timestamp: "2026-06-18T00:00:00.000Z",
      summary: "Recent MCP note",
    });
    addCapsule(store, {
      id: "old-high",
      priority: "high",
      tags: ["mcp"],
      timestamp: "2026-02-01T00:00:00.000Z",
      summary: "High priority MCP decision",
    });

    const relevant = store.getRelevant({ tags: ["mcp"], now: "2026-06-19T10:00:00.000Z" });

    expect(relevant.map((result) => result.capsule.id)).toEqual(["old-high", "recent-low", "old-critical"]);
    expect(relevant[0]?.score).toBeGreaterThan(relevant[1]?.score ?? 0);
  });

  test("prune removes low-priority capsules older than 30 days first and keeps critical", () => {
    addCapsule(store, {
      id: "critical-old",
      priority: "critical",
      timestamp: "2026-01-01T00:00:00.000Z",
      summary: "Must stay",
    });
    addCapsule(store, {
      id: "low-old",
      priority: "low",
      timestamp: "2026-04-01T00:00:00.000Z",
      summary: "Old low priority",
    });
    addCapsule(store, {
      id: "high-new",
      priority: "high",
      timestamp: "2026-06-18T00:00:00.000Z",
      summary: "New high priority",
    });

    const result = store.prune(1);

    expect(result.removedIds).toEqual(["high-new", "low-old"]);
    expect(store.list().map((capsule) => capsule.id)).toEqual(["critical-old"]);
  });

  test("prune respects max 50 capsules when critical count allows it", () => {
    for (let index = 0; index < 55; index += 1) {
      const timestamp = new Date(Date.UTC(2026, 4, index + 1)).toISOString();
      addCapsule(store, {
        priority: "medium",
        timestamp,
        summary: `Capsule ${index}`,
      });
    }

    const result = store.prune();

    expect(result.keptCount).toBe(50);
    expect(result.removedIds).toEqual(["cap-001", "cap-002", "cap-003", "cap-004", "cap-005"]);
    expect(store.list()).toHaveLength(50);
  });

  test("corrupted index is recoverable by rebuilding from valid capsule files", () => {
    addCapsule(store, { id: "valid", summary: "Valid capsule" });
    writeFileSync(store.getIndexPath(), "{ broken", "utf-8");

    const index = store.readIndexFile();

    expect(index.capsuleCount).toBe(1);
    expect(index.capsules.map((capsule) => capsule.id)).toEqual(["valid"]);
  });

  test("corrupted capsule gives a clear failure on get but list remains recoverable", () => {
    addCapsule(store, { id: "valid", summary: "Valid capsule" });
    writeFileSync(join(store.getCapsulesDir(), "broken.json"), "{ broken", "utf-8");

    expect(() => store.get("broken")).toThrow(CapsuleStoreError);
    expect(store.list().map((capsule) => capsule.id)).toEqual(["valid"]);
  });
});

function addCapsule(
  store: CapsuleStore,
  overrides: {
    id?: string;
    type?: CapsuleType;
    priority?: CapsulePriority;
    tags?: string[];
    timestamp?: string;
    summary?: string;
    detail?: string;
  } = {},
) {
  const input: MemoryCapsuleInput = {
    ...(overrides.id ? { id: overrides.id } : {}),
    type: overrides.type ?? "discovery",
    summary: overrides.summary ?? "A useful memory capsule",
    detail: overrides.detail ?? "Detailed memory capsule content.",
    context: {
      task: "task-02",
      sessionId: "test-session",
      ...(overrides.timestamp ? { timestamp: overrides.timestamp } : {}),
    },
    priority: overrides.priority ?? "medium",
    tags: overrides.tags ?? [],
    related: [],
  };

  return store.add(input);
}
