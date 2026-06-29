/**
 * Write tool tests.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeTool } from "../../src/infrastructure/tools/local/write";

describe("write tool", () => {
  let tmpDir: string;

  function makeCwd(): string {
    tmpDir = mkdtempSync(join(tmpdir(), "soba-test-write-"));
    return tmpDir;
  }

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true });
  });

  test("создаёт новый файл", async () => {
    const cwd = makeCwd();
    const result = await writeTool.execute({ path: "new-file.txt", content: "Hello, Bun!" }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Successfully wrote");
    expect(result.details).toMatchObject({
      path: join(cwd, "new-file.txt"),
      oldText: null,
      newText: "Hello, Bun!",
    });
    expect(existsSync(join(cwd, "new-file.txt"))).toBe(true);
    expect(readFileSync(join(cwd, "new-file.txt"), "utf-8")).toBe("Hello, Bun!");
  });

  test("перезаписывает существующий файл", async () => {
    const cwd = makeCwd();
    await writeTool.execute({ path: "file.txt", content: "original" }, { cwd });
    const result = await writeTool.execute({ path: "file.txt", content: "updated" }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.details).toMatchObject({
      path: join(cwd, "file.txt"),
      oldText: "original",
      newText: "updated",
    });
    expect(readFileSync(join(cwd, "file.txt"), "utf-8")).toBe("updated");
  });

  test("автосоздаёт родительские директории", async () => {
    const cwd = makeCwd();
    const result = await writeTool.execute({ path: "deep/nested/dir/file.txt", content: "deep content" }, { cwd });

    expect(result.isError).toBe(false);
    expect(existsSync(join(cwd, "deep", "nested", "dir", "file.txt"))).toBe(true);
  });

  test("записывает многострочный контент", async () => {
    const cwd = makeCwd();
    const content = "line1\nline2\nline3\nline4\nline5";
    const result = await writeTool.execute({ path: "multi.txt", content }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.details?.lines).toBe(5);
    expect(readFileSync(join(cwd, "multi.txt"), "utf-8")).toBe(content);
  });

  test("записывает пустой файл", async () => {
    const cwd = makeCwd();
    const result = await writeTool.execute({ path: "empty.txt", content: "" }, { cwd });

    expect(result.isError).toBe(false);
    expect(existsSync(join(cwd, "empty.txt"))).toBe(true);
    expect(readFileSync(join(cwd, "empty.txt"), "utf-8")).toBe("");
  });

  test("запрещает прямую запись в project memory store", async () => {
    const cwd = makeCwd();
    const result = await writeTool.execute(
      {
        path: ".soba/memory/capsules/index.json",
        content: "{}",
      },
      { cwd },
    );

    expect(result.isError).toBe(true);
    expect(result.error).toMatchObject({
      code: "project_memory_direct_write_denied",
      category: "validation",
      retryable: false,
    });
    expect(result.content[0].text).toContain("write_project_memory");
    expect(existsSync(join(cwd, ".soba", "memory", "capsules", "index.json"))).toBe(false);
  });

  test("возвращает размер в байтах", async () => {
    const cwd = makeCwd();
    const result = await writeTool.execute({ path: "size.txt", content: "1234567890" }, { cwd });

    expect(result.details?.bytes).toBe(10);
  });

  test("возвращает validation error, если path отсутствует", async () => {
    const cwd = makeCwd();
    const result = await writeTool.execute({ content: "missing path" } as never, { cwd });

    expect(result.isError).toBe(true);
    expect(result.error).toMatchObject({
      code: "write_invalid_arguments",
      category: "validation",
      retryable: false,
    });
    expect(result.content[0].text).toContain("path");
    expect(result.content[0].text).toContain("do not retry unchanged");
  });

  test("возвращает validation error, если content не строка", async () => {
    const cwd = makeCwd();
    const result = await writeTool.execute({ path: "file.txt", content: undefined } as never, { cwd });

    expect(result.isError).toBe(true);
    expect(result.error).toMatchObject({
      code: "write_invalid_arguments",
      category: "validation",
    });
    expect(result.content[0].text).toContain("content");
  });
});
