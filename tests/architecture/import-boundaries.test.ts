import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();

describe("architecture import boundaries", () => {
  test("src/core namespace is retired", () => {
    expect(existsSync(join(projectRoot, "src", "core"))).toBe(false);
  });

  test("ARCHITECTURE.md dependency graph is generated from current imports", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", "docs:deps:check"],
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.success).toBe(true);
  });
});
