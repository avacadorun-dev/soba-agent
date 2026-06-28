import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashTool } from "../../../src/infrastructure/tools/local/bash";
import { editTool } from "../../../src/infrastructure/tools/local/edit";
import { readTool } from "../../../src/infrastructure/tools/local/read";
import type { ToolContext, ToolResult } from "../../../src/kernel/tools/types";

describe("helpful tool errors", () => {
  test("read missing file returns stable code and path correction hint", async () => {
    const cwd = await makeTempDir();
    const result = await readTool.execute({ path: "missing.txt" }, makeContext(cwd));

    expect(result.isError).toBe(true);
    expect(result.error).toMatchObject({
      code: "read_path_not_found",
      category: "filesystem",
      retryable: false,
    });
    expect(textOf(result)).toContain("Next action:");
    expect(result.error?.nextAction).toContain("corrected path");
  });

  test("edit oldText miss suggests reading current content instead of retrying blindly", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "target.txt"), "current text\n", "utf-8");

    const result = await editTool.execute(
      { path: "target.txt", edits: [{ oldText: "stale text", newText: "new text" }] },
      makeContext(cwd),
    );

    expect(result.isError).toBe(true);
    expect(result.error).toMatchObject({
      code: "edit_old_text_not_found",
      category: "validation",
      retryable: false,
    });
    expect(result.error?.nextAction).toContain("Read the current file content");
  });

  test("command not found suggests command detection or an available alternative", async () => {
    const cwd = await makeTempDir();
    const result = await bashTool.execute({ command: "definitely-not-a-real-soba-command" }, makeContext(cwd));

    expect(result.isError).toBe(true);
    expect(result.error).toMatchObject({
      code: "command_not_found",
      category: "command",
      retryable: false,
    });
    expect(textOf(result)).toContain("do not retry the same command unchanged");
  });

  test("secret-looking stderr is redacted in command output", async () => {
    const cwd = await makeTempDir();
    const result = await bashTool.execute(
      { command: "printf 'api_key=fake-test1234567890abcdef\\n' >&2; exit 1" },
      makeContext(cwd),
    );
    const output = textOf(result);

    expect(result.isError).toBe(true);
    expect(output).toContain("api_key=[REDACTED]");
    expect(output).not.toContain("fake-test1234567890abcdef");
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "soba-helpful-errors-"));
}

function makeContext(cwd: string): ToolContext {
  return { cwd, bashMaxTimeoutSeconds: 5 };
}

function textOf(result: ToolResult): string {
  return result.content.map((content) => content.text).join("\n");
}
