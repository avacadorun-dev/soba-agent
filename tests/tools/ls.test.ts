import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lsTool } from "../../src/core/tools/ls";

describe("ls tool", () => {
  let tmpDir = "";

  function setup(): string {
    tmpDir = mkdtempSync(join(tmpdir(), "soba-test-ls-"));
    mkdirSync(join(tmpDir, "src"));
    writeFileSync(join(tmpDir, "README.md"), "hello");
    writeFileSync(join(tmpDir, ".env.example"), "KEY=value");
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  test("lists files, dotfiles, and directory suffixes", async () => {
    const cwd = setup();

    const result = await lsTool.execute({ path: "." }, { cwd });
    const output = result.content[0]?.text ?? "";

    expect(result.isError).toBe(false);
    expect(output).toContain(".env.example");
    expect(output).toContain("README.md");
    expect(output).toContain("src/");
  });

  test("respects entry limits", async () => {
    const cwd = setup();

    const result = await lsTool.execute({ path: ".", limit: 1 }, { cwd });
    const output = result.content[0]?.text ?? "";

    expect(result.isError).toBe(false);
    expect(output).toContain("1 entries limit reached");
  });
});
