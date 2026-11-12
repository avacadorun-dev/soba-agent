import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFilesTool } from "../../../src/infrastructure/tools/local/find-files";
import { inspectFileTool } from "../../../src/infrastructure/tools/local/inspect-file";
import { searchFilesTool } from "../../../src/infrastructure/tools/local/search-files";
import type { ToolContext, ToolResult } from "../../../src/kernel/tools/types";

describe("search_files tool", () => {
  test("returns bounded matches with file and line metadata", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "alpha.txt"), ["first target", "second", "third target"].join("\n"), "utf-8");
    await writeFile(join(cwd, "beta.txt"), "target here\n", "utf-8");

    const result = await searchFilesTool.execute(
      { query: "target", path: ".", maxMatches: 2, caseSensitive: false },
      makeContext(cwd),
    );
    const output = textOf(result);

    expect(result.isError).toBe(false);
    expect(output).toContain("alpha.txt:1:");
    expect(output).toContain("target");
    expect(output).toContain("Output truncated");
    expect(result.details?.matchCount).toBe(2);
  });

  test("large result set is truncated with a marker", async () => {
    const cwd = await makeTempDir();
    const lines = Array.from({ length: 20 }, (_, index) => `needle ${index}`).join("\n");
    await writeFile(join(cwd, "many.txt"), lines, "utf-8");

    const result = await searchFilesTool.execute({ query: "needle", maxMatches: 5 }, makeContext(cwd));

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("Output truncated");
    expect(result.details?.truncated).toBe(true);
  });

  test("fallback search works when ripgrep is unavailable", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "fallback.txt"), "alpha\nneedle here\nomega\n", "utf-8");
    const previousPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const result = await searchFilesTool.execute({ query: "needle", path: "." }, makeContext(cwd));

      expect(result.isError).toBe(false);
      expect(textOf(result)).toContain("fallback.txt:2:");
      expect(result.details?.engine).toBe("fallback");
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });
});

describe("inspect_file tool", () => {
  test("reads stable line-numbered ranges", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "sample.txt"), ["one", "two", "three", "four"].join("\n"), "utf-8");

    const result = await inspectFileTool.execute({ path: "sample.txt", startLine: 2, endLine: 3 }, makeContext(cwd));
    const output = textOf(result);

    expect(result.isError).toBe(false);
    expect(output).toContain("[inspect_file] sample.txt lines 2-3 of 4");
    expect(output).toContain("2 | two");
    expect(output).toContain("3 | three");
    expect(output).not.toContain("1 | one");
  });

  test("handles missing files actionably", async () => {
    const cwd = await makeTempDir();

    const result = await inspectFileTool.execute({ path: "missing.txt" }, makeContext(cwd));

    expect(result.isError).toBe(true);
    expect(result.error).toMatchObject({
      code: "read_path_not_found",
      category: "filesystem",
    });
    expect(result.error?.nextAction).toContain("corrected path");
  });

  test("large files are inspected as bounded ranges", async () => {
    const cwd = await makeTempDir();
    const lines = Array.from({ length: 5000 }, (_, index) => `line ${index + 1}`).join("\n");
    await writeFile(join(cwd, "large.txt"), lines, "utf-8");

    const result = await inspectFileTool.execute({ path: "large.txt", startLine: 10, endLine: 12 }, makeContext(cwd));
    const output = textOf(result);

    expect(result.isError).toBe(false);
    expect(output).toContain("10 | line 10");
    expect(output).toContain("12 | line 12");
    expect(output).not.toContain("5000 | line 5000");
    expect(result.details?.truncated).toBe(true);
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "soba-search-inspect-"));
}

function makeContext(cwd: string): ToolContext {
  return { cwd, bashMaxTimeoutSeconds: 5 };
}

function textOf(result: ToolResult): string {
  return result.content.map((content) => content.text).join("\n");
}

describe("search_files contextLines", () => {
  test("contextLines returns surrounding lines in one call", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "ctx.txt"),
      ["before-a", "before-b", "needle one", "after-a", "after-b", "needle two", "tail"].join("\n"),
      "utf-8",
    );

    const result = await searchFilesTool.execute({ query: "needle", path: ".", contextLines: 2 }, makeContext(cwd));
    const output = textOf(result);

    expect(result.isError).toBe(false);
    expect(output).toContain("ctx.txt:3:");
    expect(output).toContain("ctx.txt:6:");
    expect(output).toContain("before-a");
    expect(output).toContain("after-b");
    expect(output).toContain("tail");
    const matches = result.details?.matches as { line: number; context?: { line: number }[] }[];
    expect(matches.length).toBe(2);
    expect(matches[0].context?.map((entry) => entry.line)).toEqual([1, 2, 4, 5]);
  });

  test("fallback search with contextLines still returns matches", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "fallback-ctx.txt"), "alpha\nneedle here\nomega\n", "utf-8");
    const previousPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const result = await searchFilesTool.execute({ query: "needle", contextLines: 1 }, makeContext(cwd));
      expect(result.isError).toBe(false);
      const output = textOf(result);
      expect(output).toContain("fallback-ctx.txt:2:");
      expect(output).toContain("alpha");
      expect(output).toContain("omega");
    } finally {
      process.env.PATH = previousPath;
    }
  });

  test("regex with no matches returns an explicit empty result", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "nothing.txt"), "plain content\n", "utf-8");

    const result = await searchFilesTool.execute({ query: "zzz-no-such-thing", path: "." }, makeContext(cwd));

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("No matches found");
    expect(result.details?.matchCount).toBe(0);
  });
});

describe("find_files tool", () => {
  test("recursive glob discovery is deterministically sorted and skips ignored dirs", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "b.ts"), "export const b = 1;\n", "utf-8");
    await writeFile(join(cwd, "a.ts"), "export const a = 1;\n", "utf-8");
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "c.ts"), "export const c = 1;\n", "utf-8");
    await writeFile(join(cwd, "src", "d.md"), "# d\n", "utf-8");
    await mkdir(join(cwd, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(cwd, "node_modules", "pkg", "e.ts"), "export const e = 1;\n", "utf-8");

    const result = await findFilesTool.execute({ glob: "**/*.ts" }, makeContext(cwd));
    const files = result.details?.files as string[];

    expect(result.isError).toBe(false);
    expect(files).toEqual(["a.ts", "b.ts", "src/c.ts"]);
  });

  test("depth limit bounds recursion and truncation is disclosed", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "deep", "deeper", "deepest"), { recursive: true });
    await writeFile(join(cwd, "deep", "deeper", "deepest", "x.txt"), "x\n", "utf-8");

    const result = await findFilesTool.execute({ glob: "**/*.txt", maxDepth: 2 }, makeContext(cwd));

    expect(result.isError).toBe(false);
    expect(result.details?.matchCount).toBe(0);
  });

  test("empty result is explicit, not an error", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "only.txt"), "x\n", "utf-8");

    const result = await findFilesTool.execute({ glob: "**/*.rs" }, makeContext(cwd));

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("No files found");
  });
});
