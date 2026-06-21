import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectMemory, ProjectMemoryError } from "../../src/core/memory/project-memory";
import { KNOWLEDGE_KEYS, type MemoryCapsuleInput } from "../../src/core/memory/types";

describe("ProjectMemory aggregator", () => {
  let projectRoot: string;
  let idCounter: number;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "soba-project-memory-"));
    idCounter = 0;
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test("init creates all required stores", () => {
    const memory = createProjectMemory();

    memory.initialize();

    expect(existsSync(join(projectRoot, ".soba", "memory"))).toBe(true);
    for (const key of KNOWLEDGE_KEYS) {
      expect(existsSync(join(projectRoot, ".soba", "memory", "knowledge", `${knowledgeFilename(key)}`))).toBe(true);
    }
    expect(existsSync(join(projectRoot, ".soba", "memory", "capsules", "index.json"))).toBe(true);
    expect(memory.getGraph()).toEqual({ nodes: [], edges: [] });
  });

  test("load existing memory returns knowledge files and graph", () => {
    const memory = createProjectMemory();
    memory.initialize();
    memory.getStores().knowledge.write("architecture", "# Architecture\n\nLayered CLI with ProjectMemory.\n");
    memory.getStores().graph?.addNode({
      id: "module:memory",
      type: "module",
      name: "memory",
      metadata: { description: "Project memory module" },
    });
    memory.save();

    const reloaded = createProjectMemory();
    const loaded = reloaded.load();

    expect(loaded.knowledgeFiles.map((document) => document.key)).toEqual([...KNOWLEDGE_KEYS]);
    expect(loaded.knowledgeFiles.find((document) => document.key === "architecture")?.content).toContain("ProjectMemory");
    expect(loaded.graph?.nodes).toEqual([
      {
        id: "module:memory",
        type: "module",
        name: "memory",
        metadata: { description: "Project memory module" },
      },
    ]);
  });

  test("add capsule then reload keeps relevance API stable", () => {
    const memory = createProjectMemory();

    const capsule = memory.addCapsule(capsuleInput({ summary: "MCP config supports ENV placeholders", tags: ["mcp", "config"] }));
    const reloaded = createProjectMemory();
    const relevant = reloaded.getRelevantCapsules({ tags: ["mcp"], limit: 5 });

    expect(capsule.id).toBe("cap-001");
    expect(relevant.map((result) => result.capsule.id)).toEqual(["cap-001"]);
    expect(relevant[0]?.capsule.summary).toContain("ENV placeholders");
  });

  test("read knowledge via aggregator", () => {
    const memory = createProjectMemory();
    memory.getStores().knowledge.write("conventions", "# Conventions\n\nUse Bun and Biome only.\n");

    const documents = memory.getKnowledgeFiles();

    expect(documents).toHaveLength(4);
    expect(documents.find((document) => document.key === "conventions")?.content).toContain("Bun and Biome");
  });

  test("graph optional path works when graph file is missing or disabled", () => {
    const withGraph = createProjectMemory();
    expect(existsSync(join(projectRoot, ".soba", "memory", "graph.json"))).toBe(false);
    expect(withGraph.getGraph()).toEqual({ nodes: [], edges: [] });

    const withoutGraph = createProjectMemory({ enableGraph: false });
    expect(withoutGraph.getGraph()).toBeNull();
    expect(withoutGraph.save().graphSaved).toBe(false);
  });

  test("save prunes capsules and persists graph when graph is enabled", () => {
    const memory = createProjectMemory({ maxCapsules: 1 });
    memory.addCapsule(capsuleInput({ id: "low-old", priority: "low", timestamp: "2026-04-01T00:00:00.000Z" }));
    memory.addCapsule(capsuleInput({ id: "high-new", priority: "high", timestamp: "2026-06-19T00:00:00.000Z" }));
    memory.getStores().graph?.addNode({
      id: "file:src/core/memory/project-memory.ts",
      type: "file",
      name: "project-memory.ts",
      metadata: { path: "src/core/memory/project-memory.ts" },
    });

    const result = memory.save();

    expect(result).toEqual({
      prunedCapsuleIds: ["low-old"],
      keptCapsuleCount: 1,
      graphSaved: true,
    });
    expect(existsSync(join(projectRoot, ".soba", "memory", "graph.json"))).toBe(true);
    expect(readFileSync(join(projectRoot, ".soba", "memory", "graph.json"), "utf-8")).toContain("project-memory.ts");
  });

  test("store failure surfaces controlled ProjectMemoryError", () => {
    const memory = createProjectMemory();

    expect(() => memory.addCapsule(capsuleInput({ summary: "" }))).toThrow(ProjectMemoryError);

    try {
      memory.addCapsule(capsuleInput({ summary: "" }));
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectMemoryError);
      expect(error).toMatchObject({
        code: "capsule_store_failed",
        layer: "capsules",
      });
      expect(error instanceof Error ? error.message : String(error)).toContain("ProjectMemory capsules store failed during add capsule");
    }
  });

  test("graph corruption is reported as controlled graph layer error", () => {
    const memory = createProjectMemory();
    memory.initialize();
    writeFileSync(join(projectRoot, ".soba", "memory", "graph.json"), "{ broken", "utf-8");

    expect(() => memory.getGraph()).toThrow(ProjectMemoryError);

    try {
      memory.getGraph();
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectMemoryError);
      expect(error).toMatchObject({
        code: "graph_store_failed",
        layer: "graph",
      });
    }
  });

  function createProjectMemory(overrides: Partial<ConstructorParameters<typeof ProjectMemory>[0]> = {}): ProjectMemory {
    return new ProjectMemory({
      projectRoot,
      now: () => new Date("2026-06-19T10:00:00.000Z"),
      idGenerator: () => {
        idCounter += 1;
        return `cap-${String(idCounter).padStart(3, "0")}`;
      },
      ...overrides,
    });
  }
});

function capsuleInput(
  overrides: {
    id?: string;
    summary?: string;
    priority?: MemoryCapsuleInput["priority"];
    tags?: string[];
    timestamp?: string;
  } = {},
): MemoryCapsuleInput {
  return {
    ...(overrides.id ? { id: overrides.id } : {}),
    type: "discovery",
    summary: overrides.summary ?? "Reusable project memory",
    detail: "Detailed memory content.",
    context: {
      task: "task-09",
      sessionId: "session-1",
      ...(overrides.timestamp ? { timestamp: overrides.timestamp } : {}),
    },
    priority: overrides.priority ?? "medium",
    tags: overrides.tags ?? [],
    related: [],
  };
}

function knowledgeFilename(key: (typeof KNOWLEDGE_KEYS)[number]): string {
  return key === "known-errors" ? "known-errors.md" : `${key}.md`;
}
