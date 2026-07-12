import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspacePath } from "./ordinary-agent-producer";

describe("ordinary-agent eval producer", () => {
  test("resolves paths inside the disposable workspace", () => {
    const workspace = mkdtempSync(join(tmpdir(), "soba-ordinary-producer-"));
    expect(resolveWorkspacePath(workspace, "src/app.ts")).toBe(join(workspace, "src", "app.ts"));
  });

  test("rejects paths that escape the disposable workspace", () => {
    const workspace = mkdtempSync(join(tmpdir(), "soba-ordinary-producer-"));
    expect(() => resolveWorkspacePath(workspace, "../outside.txt")).toThrow("Path escapes eval workspace");
    expect(() => resolveWorkspacePath(workspace, "/tmp/outside.txt")).toThrow("Path escapes eval workspace");
  });
});
