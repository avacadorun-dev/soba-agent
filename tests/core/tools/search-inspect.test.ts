import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectFileTool } from "../../../src/core/tools/inspect-file";
import { searchFilesTool } from "../../../src/core/tools/search-files";
import type { ToolContext, ToolResult } from "../../../src/core/tools/types";

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
