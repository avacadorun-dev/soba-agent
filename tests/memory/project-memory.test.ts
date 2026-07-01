import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KNOWLEDGE_KEYS, type MemoryCapsuleInput } from "../../src/engine/memory/types";
import { ProjectMemory, ProjectMemoryError } from "../../src/infrastructure/persistence/memory/project-memory";

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
      metadata: { path: "../../src/infrastructure/persistence/memory/project-memory" },
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

  test("doctor reports source freshness, stale capsules, broken capsules, and corrupt capsule files", () => {
    const memory = createProjectMemory();
    const freshPath = join(projectRoot, "fresh.ts");
    const stalePath = join(projectRoot, "stale.ts");
    const outsideRoot = mkdtempSync(join(tmpdir(), "soba-project-memory-outside-"));
    const outsidePath = join(outsideRoot, "outside.ts");

    try {
      writeFileSync(freshPath, "export const fresh = true;\n", "utf-8");
      writeFileSync(stalePath, "export const stale = true;\n", "utf-8");
      writeFileSync(outsidePath, "export const outside = true;\n", "utf-8");
      utimesSync(freshPath, new Date("2026-06-19T09:59:00.000Z"), new Date("2026-06-19T09:59:00.000Z"));
      utimesSync(stalePath, new Date("2026-06-19T10:00:02.000Z"), new Date("2026-06-19T10:00:02.000Z"));

      memory.addCapsule(capsuleInput({
        id: "fresh",
        source: {
          error: "none",
          fix: "none",
          file: "fresh.ts",
          lines: [1, 1],
          commit: "abc123",
          confidence: "high",
          lastVerified: "2026-06-19T10:00:00.000Z",
          staleIfFilesChange: ["fresh.ts"],
        },
      }));
      memory.addCapsule(capsuleInput({
        id: "stale",
        source: { error: "old", fix: "refresh", file: "stale.ts" },
      }));
      memory.addCapsule(capsuleInput({
        id: "missing",
        source: { error: "missing", fix: "restore", file: "missing.ts" },
      }));
      memory.addCapsule(capsuleInput({
        id: "outside",
        source: { error: "outside", fix: "move", file: outsidePath },
      }));
      memory.addCapsule(capsuleInput({ id: "untracked" }));

      const capsulesDir = join(projectRoot, ".soba", "memory", "capsules");
      mkdirSync(capsulesDir, { recursive: true });
      writeFileSync(join(capsulesDir, "corrupt.json"), "{ broken", "utf-8");

      const report = memory.doctor();

      expect(report.status).toBe("broken");
      expect(report.generatedAt).toBe("2026-06-19T10:00:00.000Z");
      expect(report.summary).toMatchObject({
        knowledgeFiles: 4,
        capsules: 6,
        freshCapsules: 1,
        staleCapsules: 1,
        brokenCapsules: 3,
        untrackedCapsules: 1,
        issues: 4,
      });
      expect(report.capsules.map((capsule) => [capsule.id, capsule.sourceState]).sort()).toEqual([
        ["corrupt", "corrupted"],
        ["fresh", "fresh"],
        ["missing", "missing"],
        ["outside", "outside_project"],
        ["stale", "stale"],
        ["untracked", "untracked"],
      ]);
      expect(report.issues.map((issue) => issue.code).sort()).toEqual([
        "capsule_corrupted",
        "capsule_source_missing",
        "capsule_source_newer",
        "capsule_source_outside_project",
      ]);
      expect(report.capsules.find((capsule) => capsule.id === "fresh")).toMatchObject({
        sourceLines: [1, 1],
        sourceCommit: "abc123",
        sourceConfidence: "high",
        lastVerified: "2026-06-19T10:00:00.000Z",
        staleIfFilesChange: ["fresh.ts"],
      });
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  test("doctor treats staleIfFilesChange drift and invalid source lines as receipt issues", () => {
    const memory = createProjectMemory();
    const sourcePath = join(projectRoot, "source.ts");
    const watchedPath = join(projectRoot, "watched.ts");
    writeFileSync(sourcePath, "line 1\nline 2\n", "utf-8");
    writeFileSync(watchedPath, "changed dependency\n", "utf-8");
    utimesSync(sourcePath, new Date("2026-06-19T09:59:00.000Z"), new Date("2026-06-19T09:59:00.000Z"));
    utimesSync(watchedPath, new Date("2026-06-19T10:00:03.000Z"), new Date("2026-06-19T10:00:03.000Z"));

    memory.addCapsule(capsuleInput({
      id: "watcher-stale",
      source: {
        error: "source dependency changed",
        fix: "refresh memory",
        file: "source.ts",
        lines: [1, 2],
        lastVerified: "2026-06-19T10:00:00.000Z",
        staleIfFilesChange: ["watched.ts"],
      },
    }));
    memory.addCapsule(capsuleInput({
      id: "line-drift",
      source: {
        error: "line moved",
        fix: "update line receipt",
        file: "source.ts",
        lines: [1, 10],
      },
    }));

    const report = memory.doctor();

    expect(report.status).toBe("broken");
    expect(report.capsules.map((capsule) => [capsule.id, capsule.sourceState]).sort()).toEqual([
      ["line-drift", "invalid_source"],
      ["watcher-stale", "stale"],
    ]);
    expect(report.issues.map((issue) => [issue.code, issue.path]).sort()).toEqual([
      ["capsule_source_invalid_lines", "source.ts"],
      ["capsule_source_newer", "watched.ts"],
    ]);
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
    source?: MemoryCapsuleInput["source"];
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
    ...(overrides.source ? { source: overrides.source } : {}),
  };
}

function knowledgeFilename(key: (typeof KNOWLEDGE_KEYS)[number]): string {
  return key === "known-errors" ? "known-errors.md" : `${key}.md`;
}
