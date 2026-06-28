import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();

describe("architecture import boundaries", () => {
  test("src/core namespace is retired", () => {
    expect(existsSync(join(projectRoot, "src", "core"))).toBe(false);
  });
});
