/**
 * Tests for write/edit guards and inspect_diff (#7).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editTool } from "../../src/infrastructure/tools/local/edit";
import { inspectDiffTool } from "../../src/infrastructure/tools/local/inspect-diff";
import { readTool } from "../../src/infrastructure/tools/local/read";
import { writeTool } from "../../src/infrastructure/tools/local/write";
import type { ToolContext } from "../../src/kernel/tools/types";

let dirs: string[] = [];

async function makeCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "soba-guard-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

function context(cwd: string): ToolContext {
  return { cwd };
}

describe("write overwrite guard", () => {
  test("overwriting an existing file without overwrite is refused with no mutation", async () => {
    const cwd = await makeCwd();
    await writeFile(join(cwd, "note.txt"), "original\n", "utf-8");

    const result = await writeTool.execute(
      { path: "note.txt", content: "clobbered\n" },
      context(cwd),
    );

    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("write_path_exists");
    expect(result.error?.nextAction).toContain("edit");
    expect(await readFile(join(cwd, "note.txt"), "utf-8")).toBe("original\n");
  });

  test("overwrite: true replaces the file", async () => {
    const cwd = await makeCwd();
    await writeFile(join(cwd, "note.txt"), "original\n", "utf-8");

    const result = await writeTool.execute(
      { path: "note.txt", content: "replaced\n", overwrite: true },
      context(cwd),
    );

    expect(result.isError).toBe(false);
    expect(await readFile(join(cwd, "note.txt"), "utf-8")).toBe("replaced\n");
  });

  test("creating a new file is unaffected", async () => {
    const cwd = await makeCwd();

    const result = await writeTool.execute({ path: "new.txt", content: "fresh\n" }, context(cwd));

    expect(result.isError).toBe(false);
    expect(await readFile(join(cwd, "new.txt"), "utf-8")).toBe("fresh\n");
  });
});

describe("edit dryRun and staleness", () => {
  test("dryRun returns the patch preview and leaves the file hash unchanged", async () => {
    const cwd = await makeCwd();
    await writeFile(join(cwd, "code.ts"), "const a = 1;\nconst b = 2;\n", "utf-8");
    const before = await readFile(join(cwd, "code.ts"), "utf-8");

    const result = await editTool.execute(
      { path: "code.ts", edits: [{ oldText: "const b = 2;", newText: "const b = 3;" }], dryRun: true },
      context(cwd),
    );

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Dry run");
    expect(result.content[0].text).toContain("const b = 3;");
    expect(result.details?.dryRun).toBe(true);
    expect(typeof result.details?.sha256).toBe("string");
    expect(await readFile(join(cwd, "code.ts"), "utf-8")).toBe(before);
  });

  test("an edit computed against stale content is refused with a re-read message", async () => {
    const cwd = await makeCwd();
    await writeFile(join(cwd, "code.ts"), "const a = 1;\nconst b = 2;\n", "utf-8");

    // Read through the read tool to establish freshness state.
    const readResult = await readTool.execute({ path: "code.ts" }, context(cwd));
    expect(readResult.isError).toBe(false);

    // External change between read and edit (mtime and content change).
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(join(cwd, "code.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n", "utf-8");

    const result = await editTool.execute(
      { path: "code.ts", edits: [{ oldText: "const b = 2;", newText: "const b = 20;" }] },
      context(cwd),
    );

    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("edit_stale_content");
    expect(result.error?.nextAction).toContain("read");
    expect(await readFile(join(cwd, "code.ts"), "utf-8")).toContain("const c = 3;");
  });

  test("small edits keep their one-call behavior", async () => {
    const cwd = await makeCwd();
    await writeFile(join(cwd, "code.ts"), "const a = 1;\nconst b = 2;\n", "utf-8");

    const result = await editTool.execute(
      { path: "code.ts", edits: [{ oldText: "const a = 1;", newText: "const a = 10;" }] },
      context(cwd),
    );

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Successfully applied 1 edit(s)");
    expect(result.content[0].text).not.toContain("Warning");
    expect(await readFile(join(cwd, "code.ts"), "utf-8")).toContain("const a = 10;");
  });

  test("large deletions warn with the affected line count", async () => {
    const cwd = await makeCwd();
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1};`);
    await writeFile(join(cwd, "big.ts"), lines.join("\n"), "utf-8");

    const result = await editTool.execute(
      { path: "big.ts", edits: [{ oldText: lines.slice(0, 20).join("\n"), newText: "collapsed;" }] },
      context(cwd),
    );

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Warning");
    expect(result.content[0].text).toContain("removes 19 line(s)");
  });
});

describe("inspect_diff tool", () => {
  test("working tree diff returns stats and hunks without a shell pipeline", async () => {
    const cwd = await makeCwd();
    await Bun.$`git init -q`.cwd(cwd);
    await Bun.$`git -C ${cwd} config user.email test@example.com`;
    await Bun.$`git -C ${cwd} config user.name Test`;
    await writeFile(join(cwd, "doc.md"), "# Title\n\nline one\nline two\n", "utf-8");
    await Bun.$`git -C ${cwd} add . && git -C ${cwd} commit -qm init`.quiet();

    await writeFile(join(cwd, "doc.md"), "# Title\n\nline one edited\nline two\nline three\n", "utf-8");

    const result = await inspectDiffTool.execute({ path: "doc.md" }, context(cwd));

    expect(result.isError).toBe(false);
    const text = result.content[0].text;
    expect(text).toContain("1 file(s) changed");
    expect(text).toContain("doc.md: +2/-1");
    expect(text).toContain("@@");
    expect(text).toContain("line one edited");
  });

  test("docs-only diff satisfies readback evidence shape", async () => {
    const cwd = await makeCwd();
    await Bun.$`git init -q`.cwd(cwd);
    await Bun.$`git -C ${cwd} config user.email test@example.com`;
    await Bun.$`git -C ${cwd} config user.name Test`;
    await mkdir(join(cwd, "docs"), { recursive: true });
    await writeFile(join(cwd, "docs", "guide.md"), "hello\n", "utf-8");
    await Bun.$`git -C ${cwd} add . && git -C ${cwd} commit -qm init`.quiet();

    await writeFile(join(cwd, "docs", "guide.md"), "hello world\n", "utf-8");

    const result = await inspectDiffTool.execute({ glob: "docs/**/*.md" }, context(cwd));

    expect(result.isError).toBe(false);
    expect(result.details?.fileCount).toBe(1);
    expect((result.details?.files as { path: string }[])[0].path).toContain("docs/guide.md");
  });

  test("no changes returns an explicit empty result", async () => {
    const cwd = await makeCwd();
    await Bun.$`git init -q`.cwd(cwd);
    await Bun.$`git -C ${cwd} config user.email test@example.com`;
    await Bun.$`git -C ${cwd} config user.name Test`;
    await writeFile(join(cwd, "a.txt"), "a\n", "utf-8");
    await Bun.$`git -C ${cwd} add . && git -C ${cwd} commit -qm init`.quiet();

    const result = await inspectDiffTool.execute({}, context(cwd));

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("No changes");
  });
});
