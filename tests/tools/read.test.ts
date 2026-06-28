/**
 * Read tool tests.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTool } from "../../src/infrastructure/tools/local/read";

describe("read tool", () => {
  let tmpDir: string;

  function setup(files: Record<string, string>): string {
    tmpDir = mkdtempSync(join(tmpdir(), "soba-test-read-"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(tmpDir, name), content);
    }
    return tmpDir;
  }

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true });
  });

  test("читает содержимое файла", async () => {
    const cwd = setup({ "test.txt": "Hello, world!" });
    const result = await readTool.execute({ path: "test.txt" }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Hello, world!");
  });

  test("возвращает ошибку для несуществующего файла", async () => {
    const cwd = setup({});
    const result = await readTool.execute({ path: "nonexistent.txt" }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error");
  });

  test("поддерживает offset (1-indexed)", async () => {
    const cwd = setup({
      "lines.txt": "line1\nline2\nline3\nline4\nline5",
    });
    const result = await readTool.execute({ path: "lines.txt", offset: 3 }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("line3");
    expect(result.content[0].text).not.toContain("line1");
    expect(result.content[0].text).not.toContain("line2");
  });

  test("поддерживает limit", async () => {
    const cwd = setup({
      "lines.txt": "line1\nline2\nline3\nline4\nline5",
    });
    const result = await readTool.execute({ path: "lines.txt", offset: 1, limit: 2 }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("line1");
    expect(result.content[0].text).toContain("line2");
    expect(result.content[0].text).not.toContain("line3");
  });

  test("limit keeps large reads bounded and returns continuation hint", async () => {
    const cwd = setup({
      "large.txt": Array.from({ length: 5000 }, (_, index) => `line${index + 1}`).join("\n"),
    });
    const result = await readTool.execute({ path: "large.txt", offset: 10, limit: 2 }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("line10");
    expect(result.content[0].text).toContain("line11");
    expect(result.content[0].text).not.toContain("line5000");
    expect(result.content[0].text).toContain("Use offset=12");
  });

  test("offset за пределами файла возвращает ошибку", async () => {
    const cwd = setup({ "small.txt": "only one line" });
    const result = await readTool.execute({ path: "small.txt", offset: 100 }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Offset");
  });

  test("читает файл в поддиректории", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "soba-test-nested-"));
    writeFileSync(join(cwd, "nested.txt"), "nested content here");

    const result = await readTool.execute({ path: "nested.txt" }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("nested content here");
  });

  test("читает пустой файл", async () => {
    const cwd = setup({ "empty.txt": "" });
    const result = await readTool.execute({ path: "empty.txt" }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe("");
  });
});
