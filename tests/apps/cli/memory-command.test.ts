import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ProjectMemory } from "../../../src/infrastructure/persistence/memory/project-memory";

const CLI_PATH = resolve("src/cli.ts");

describe("soba memory CLI", () => {
  test("runs memory doctor without loading provider configuration", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-memory-cli-"));
    try {
      const proc = Bun.spawn(["bun", CLI_PATH, "memory", "doctor", "--format", "json"], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;

      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toMatchObject({
        status: "healthy",
        memoryDir: join(cwd, ".soba", "memory"),
        summary: {
          knowledgeFiles: 4,
          capsules: 0,
          issues: 0,
        },
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("returns non-zero and stderr when memory doctor finds stale capsules", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-memory-cli-stale-"));
    try {
      const sourcePath = join(cwd, "src.ts");
      writeFileSync(sourcePath, "export const changed = true;\n", "utf-8");
      utimesSync(sourcePath, new Date("2026-06-19T10:00:03.000Z"), new Date("2026-06-19T10:00:03.000Z"));
      const memory = new ProjectMemory({
        projectRoot: cwd,
        now: () => new Date("2026-06-19T10:00:00.000Z"),
      });
      memory.addCapsule({
        id: "stale-cli",
        type: "discovery",
        summary: "Stale source",
        detail: "Source changed after this capsule was written.",
        context: {
          task: "cli",
          sessionId: "session-cli",
          timestamp: "2026-06-19T10:00:00.000Z",
        },
        priority: "medium",
        tags: ["cli"],
        related: [],
        source: {
          error: "old source",
          fix: "refresh capsule",
          file: "src.ts",
        },
      });

      const proc = Bun.spawn(["bun", CLI_PATH, "memory", "doctor"], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;

      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("SOBA Memory Doctor");
      expect(stderr).toContain("Status: stale");
      expect(stderr).toContain("capsule_source_newer");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
