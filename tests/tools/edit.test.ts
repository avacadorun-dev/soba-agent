/**
 * Edit tool tests.
 *
 * Covers all edit scenarios:
 * - Single replacement
 * - Multiple disjoint edits
 * - Non-unique oldText error
 * - oldText not found error
 * - Overlapping edits error
 * - Empty oldText error
 * - Legacy format (oldText + newText top-level)
 * - File not found error
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editTool } from "../../src/core/tools/edit";

describe("edit tool", () => {
  let tmpDir: string;

  function makeCwd(files?: Record<string, string>): string {
    tmpDir = mkdtempSync(join(tmpdir(), "soba-test-edit-"));
    if (files) {
      for (const [name, content] of Object.entries(files)) {
        writeFileSync(join(tmpDir, name), content);
      }
    }
    return tmpDir;
  }

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true });
  });

  // ── Single edit ──

  test("одна замена в файле", async () => {
    const cwd = makeCwd({ "file.ts": "const x = 1;\nconst y = 2;" });
    const result = await editTool.execute(
      {
        path: "file.ts",
        edits: [{ oldText: "const x = 1;", newText: "const x = 10;" }],
      },
      { cwd },
    );

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Successfully applied");
    expect(result.content[0].text).toContain("1 edit");
    expect(result.details).toMatchObject({
      path: join(cwd, "file.ts"),
      oldText: "const x = 1;\nconst y = 2;",
      newText: "const x = 10;\nconst y = 2;",
    });

    const updated = readFileSync(join(cwd, "file.ts"), "utf-8");
    expect(updated).toBe("const x = 10;\nconst y = 2;");
  });

  test("замена точного текста с пробелами", async () => {
    const cwd = makeCwd({ "code.ts": "function hello() {\n  return 'hi';\n}" });
    const result = await editTool.execute(
      {
        path: "code.ts",
        edits: [{ oldText: "  return 'hi';", newText: "  return 'hello';" }],
      },
      { cwd },
    );

    expect(result.isError).toBe(false);
    const updated = readFileSync(join(cwd, "code.ts"), "utf-8");
    expect(updated).toBe("function hello() {\n  return 'hello';\n}");
  });

  // ── Multiple edits ──

  test("множественные замены в одном вызове", async () => {
    const cwd = makeCwd({
      "config.ts": "const host = 'localhost';\nconst port = 3000;\nconst debug = false;",
    });
    const result = await editTool.execute(
      {
        path: "config.ts",
        edits: [
          { oldText: "const host = 'localhost';", newText: "const host = '0.0.0.0';" },
          { oldText: "const port = 3000;", newText: "const port = 8080;" },
        ],
      },
      { cwd },
    );

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("2 edit");
    const updated = readFileSync(join(cwd, "config.ts"), "utf-8");
    expect(updated).toContain("0.0.0.0");
    expect(updated).toContain("8080");
  });

  test("множественные замены — редактирование всего файла", async () => {
    const cwd = makeCwd({
      "auth.ts": [
        "export function validate(user: User) {",
        "  if (!user.email) return false;",
        "  if (!user.name) return false;",
        "  return true;",
        "}",
      ].join("\n"),
    });

    const result = await editTool.execute(
      {
        path: "auth.ts",
        edits: [
          {
            oldText: [
              "export function validate(user: User) {",
              "  if (!user.email) return false;",
              "  if (!user.name) return false;",
              "  return true;",
              "}",
            ].join("\n"),
            newText: [
              "export function validate(user: User): boolean {",
              "  if (!user.email) return false;",
              "  if (!user.name) return false;",
              "  if (!user.age) return false;",
              "  return true;",
              "}",
            ].join("\n"),
          },
        ],
      },
      { cwd },
    );

    expect(result.isError).toBe(false);
    const updated = readFileSync(join(cwd, "auth.ts"), "utf-8");
    expect(updated).toContain(": boolean");
    expect(updated).toContain("user.age");
  });

  // ── Error cases ──

  test("oldText не найден в файле", async () => {
    const cwd = makeCwd({ "file.txt": "hello world" });
    const result = await editTool.execute(
      {
        path: "file.txt",
        edits: [{ oldText: "goodbye world", newText: "hello world" }],
      },
      { cwd },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  test("oldText не уникален — возвращает ошибку", async () => {
    const cwd = makeCwd({
      "dupes.txt": "TODO: fix this\n...\nTODO: fix this",
    });
    const result = await editTool.execute(
      {
        path: "dupes.txt",
        edits: [{ oldText: "TODO: fix this", newText: "DONE" }],
      },
      { cwd },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not unique");
    expect(result.content[0].text).toContain("2 occurrences");
  });

  test("пересекающиеся замены возвращают ошибку", async () => {
    const cwd = makeCwd({ "file.txt": "ABCDEFGHIJ" });
    const result = await editTool.execute(
      {
        path: "file.txt",
        edits: [
          { oldText: "ABCDE", newText: "12345" },
          { oldText: "DEFGH", newText: "67890" },
        ],
      },
      { cwd },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("overlap");
  });

  test("пустой oldText возвращает ошибку", async () => {
    const cwd = makeCwd({ "file.txt": "content" });
    const result = await editTool.execute(
      {
        path: "file.txt",
        edits: [{ oldText: "", newText: "replacement" }],
      },
      { cwd },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("cannot be empty");
  });

  test("файл не существует", async () => {
    const cwd = makeCwd({});
    const result = await editTool.execute(
      {
        path: "missing.ts",
        edits: [{ oldText: "x", newText: "y" }],
      },
      { cwd },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does not exist");
  });

  test("запрещает прямое редактирование project memory store", async () => {
    const cwd = makeCwd({});
    const result = await editTool.execute(
      {
        path: ".soba/memory/capsules/index.json",
        edits: [{ oldText: "{}", newText: "{\"capsules\":[]}" }],
      },
      { cwd },
    );

    expect(result.isError).toBe(true);
    expect(result.error).toMatchObject({
      code: "project_memory_direct_edit_denied",
      category: "validation",
      retryable: false,
    });
    expect(result.content[0].text).toContain("write_project_memory");
  });

  test("файл не изменяется при ошибке (атомарность)", async () => {
    const cwd = makeCwd({ "safe.txt": "original content here" });

    const result = await editTool.execute(
      {
        path: "safe.txt",
        edits: [{ oldText: "nonexistent text", newText: "new content" }],
      },
      { cwd },
    );

    expect(result.isError).toBe(true);
    // File should be unchanged
    const content = readFileSync(join(cwd, "safe.txt"), "utf-8");
    expect(content).toBe("original content here");
  });

  // ── prepareArgs (legacy format) ──

  test("prepareArgs конвертирует legacy формат (oldText + newText)", () => {
    const args = editTool.prepareArgs?.({
      path: "file.ts",
      oldText: "const a = 1;",
      newText: "const a = 2;",
    });

    expect(args!.edits).toHaveLength(1);
    expect(args!.edits[0].oldText).toBe("const a = 1;");
    expect(args!.edits[0].newText).toBe("const a = 2;");
  });

  test("prepareArgs парсит edits как JSON строку", () => {
    const args = editTool.prepareArgs?.({
      path: "file.ts",
      edits: JSON.stringify([{ oldText: "a", newText: "b" }]),
    });

    expect(args!.edits).toHaveLength(1);
    expect(args!.edits[0].oldText).toBe("a");
    expect(args!.edits[0].newText).toBe("b");
  });

  test("prepareArgs выбрасывает ошибку при невалидном формате", () => {
    expect(() => editTool.prepareArgs?.({ path: "file.ts" })).toThrow("edits must contain at least one replacement");
  });

  // ── Edge cases ──

  test("замена спецсимволов (regex-safe)", async () => {
    const cwd = makeCwd({ "regex.ts": "const pattern = /^hello$/;" });
    const result = await editTool.execute(
      {
        path: "regex.ts",
        edits: [{ oldText: "/^hello$/", newText: "/^world$/" }],
      },
      { cwd },
    );

    expect(result.isError).toBe(false);
    const updated = readFileSync(join(cwd, "regex.ts"), "utf-8");
    expect(updated).toContain("/^world$/");
  });

  test("замена в середине строки", async () => {
    const cwd = makeCwd({ "mid.txt": "before MIDDLE after" });
    const result = await editTool.execute(
      {
        path: "mid.txt",
        edits: [{ oldText: "MIDDLE", newText: "CENTER" }],
      },
      { cwd },
    );

    expect(result.isError).toBe(false);
    const updated = readFileSync(join(cwd, "mid.txt"), "utf-8");
    expect(updated).toBe("before CENTER after");
  });
});
