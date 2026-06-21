import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMemoryTools,
  MemoryToolError,
  readProjectMemory,
  writeProjectMemory,
} from "../../src/core/memory/memory-tools";
import { ProjectMemory } from "../../src/core/memory/project-memory";
import type { MemoryCapsuleInput } from "../../src/core/memory/types";

describe("Project memory tools", () => {
  let projectRoot: string;
  let idCounter: number;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "soba-memory-tools-"));
    idCounter = 0;
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test("read_project_memory reads all relevant memory with normalized bounded output", () => {
    const memory = createProjectMemory();
    seedMemory(memory);

    const result = readProjectMemory(memory, { kind: "all", query: "MCP", tags: ["mcp"], limit: 5 });

    expect(result.knowledge.map((document) => document.key)).toEqual(["architecture", "conventions", "known-errors", "dependencies"]);
    expect(result.capsules.map((capsule) => capsule.id)).toEqual(["cap-001"]);
    expect(result.capsules[0]).toMatchObject({
      type: "discovery",
      priority: "high",
      tags: ["mcp"],
    });
  });

  test("read_project_memory filters capsules by tags type date and priority", () => {
    const memory = createProjectMemory();
    memory.addCapsule(capsuleInput({ id: "old-low", type: "decision", priority: "low", tags: ["ui"], timestamp: "2026-05-01T00:00:00.000Z" }));
    memory.addCapsule(capsuleInput({ id: "new-high", type: "pattern", priority: "high", tags: ["mcp"], timestamp: "2026-06-19T00:00:00.000Z" }));

    const result = readProjectMemory(memory, {
      kind: "capsules",
      capsuleType: "pattern",
      tags: ["mcp"],
      priority: "high",
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-30T00:00:00.000Z",
    });

    expect(result.knowledge).toEqual([]);
    expect(result.capsules.map((capsule) => capsule.id)).toEqual(["new-high"]);
  });

  test("write_project_memory writes a capsule", () => {
    const memory = createProjectMemory();

    const result = writeProjectMemory(memory, { target: "capsule", capsule: capsuleInput({ tags: ["tools"] }) }, projectRoot);

    expect(result).toMatchObject({
      target: "capsule",
      id: "cap-001",
    });
    expect(memory.getStores().capsules.get("cap-001").summary).toBe("Reusable memory tool note");
  });

  test("write_project_memory rejects empty capsule payload with an actionable example", async () => {
    const memory = createProjectMemory();
    const [, writeTool] = createMemoryTools({ createMemory: () => memory });

    const result = await writeTool?.execute(
      {
        target: "capsule",
        capsule: {},
      },
      { cwd: projectRoot },
    );

    expect(result?.isError).toBe(true);
    expect(result?.error).toMatchObject({
      code: "invalid_arguments",
      category: "validation",
      retryable: false,
    });
    expect(result?.content[0]?.text).toContain("Missing or empty fields: type, summary, detail, priority");
    expect(result?.content[0]?.text).toContain('\\"target\\":\\"capsule\\"');
    expect(result?.error?.nextAction).toContain("Fix the write_project_memory arguments");
  });

  test("write_project_memory replaces and appends an allowed knowledge file", () => {
    const memory = createProjectMemory();

    const replaced = writeProjectMemory(
      memory,
      {
        target: "knowledge",
        knowledge: {
          key: "conventions",
          path: "knowledge/conventions.md",
          content: "# Conventions\n\nUse Bun only.\n",
        },
      },
      projectRoot,
    );
    const appended = writeProjectMemory(
      memory,
      {
        target: "knowledge",
        knowledge: {
          key: "conventions",
          path: ".soba/memory/knowledge/conventions.md",
          mode: "append",
          content: "Biome is mandatory.\n",
        },
      },
      projectRoot,
    );

    expect(replaced).toMatchObject({ target: "knowledge", key: "conventions" });
    expect(appended.bytes).toBeGreaterThan(replaced.bytes);
    expect(readFileSync(join(projectRoot, ".soba", "memory", "knowledge", "conventions.md"), "utf-8")).toContain("Biome is mandatory.");
  });

  test("write_project_memory rejects secret-like content before writing", () => {
    const memory = createProjectMemory();

    expect(() =>
      writeProjectMemory(
        memory,
        {
          target: "knowledge",
          knowledge: {
            key: "dependencies",
            content: "apiKey=fake-secret-value-1234567890",
          },
        },
        projectRoot,
      ),
    ).toThrow(MemoryToolError);

    expect(memory.getStores().knowledge.read("dependencies").content).not.toContain("fake-super-secret");
  });

  test("write_project_memory rejects path traversal outside .soba/memory", () => {
    const memory = createProjectMemory();

    expect(() =>
      writeProjectMemory(
        memory,
        {
          target: "knowledge",
          knowledge: {
            key: "architecture",
            path: "../../AGENTS.md",
            content: "# Bad\n",
          },
        },
        projectRoot,
      ),
    ).toThrow(MemoryToolError);
    expect(existsSync(join(projectRoot, "AGENTS.md"))).toBe(false);
  });

  test("read_project_memory sanitizes and bounds output", () => {
    const memory = createProjectMemory();
    memory.getStores().knowledge.write("architecture", `# Secrets\n\nBearer abcdefghijklmnop\n${"A".repeat(20_000)}`);

    const result = readProjectMemory(memory, { kind: "knowledge", maxBytes: 2_000 });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("abcdefghijklmnop");
    expect(serialized).toContain("[REDACTED:bearer_token:1]");
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(serialized, "utf-8")).toBeLessThanOrEqual(2_000);
  });

  test("tool definitions expose model-friendly schemas and controlled errors", async () => {
    const memory = createProjectMemory();
    const [readTool, writeTool] = createMemoryTools({ createMemory: () => memory });

    expect(readTool?.parameters.properties.kind.enum).toEqual(["all", "knowledge", "capsules"]);
    expect(writeTool?.parameters.required).toEqual(["target"]);
    expect(writeTool?.parameters.properties.capsule.required).toEqual(["type", "summary", "detail", "priority"]);

    const result = await writeTool?.execute(
      {
        target: "knowledge",
        knowledge: {
          key: "dependencies",
          content: "token=abcdefghijklmnopqrstuvwxyz",
        },
      },
      { cwd: projectRoot },
    );

    expect(result?.isError).toBe(true);
    expect(JSON.parse(result?.content[0]?.text ?? "{}")).toEqual({
      error: {
        code: "invalid_secret",
        message: "Project memory write rejected because content appears to contain a secret or env placeholder.",
      },
    });
  });

  function seedMemory(memory: ProjectMemory): void {
    memory.getStores().knowledge.write("architecture", "# Architecture\n\nMCP client and ProjectMemory are separate layers.\n");
    memory.addCapsule(capsuleInput({ type: "discovery", priority: "high", tags: ["mcp"], summary: "MCP fixture supports pagination" }));
    memory.addCapsule(capsuleInput({ type: "decision", priority: "medium", tags: ["docs"], summary: "Docs use step-by-step guides" }));
  }

  function createProjectMemory(): ProjectMemory {
    return new ProjectMemory({
      projectRoot,
      now: () => new Date("2026-06-19T10:00:00.000Z"),
      idGenerator: () => {
        idCounter += 1;
        return `cap-${String(idCounter).padStart(3, "0")}`;
      },
    });
  }
});

function capsuleInput(
  overrides: {
    id?: string;
    type?: MemoryCapsuleInput["type"];
    summary?: string;
    priority?: MemoryCapsuleInput["priority"];
    tags?: string[];
    timestamp?: string;
  } = {},
): MemoryCapsuleInput {
  return {
    ...(overrides.id ? { id: overrides.id } : {}),
    type: overrides.type ?? "discovery",
    summary: overrides.summary ?? "Reusable memory tool note",
    detail: "Detailed memory tool content.",
    context: {
      task: "task-13",
      sessionId: "session-1",
      timestamp: overrides.timestamp ?? "2026-06-19T00:00:00.000Z",
    },
    priority: overrides.priority ?? "medium",
    tags: overrides.tags ?? [],
    related: [],
  };
}
