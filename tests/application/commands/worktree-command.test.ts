import { describe, expect, test } from "bun:test";
import { executeWorktreeCommand } from "../../../src/application/commands/worktree";
import type { WorkspaceRef } from "../../../src/application/workspace/public";

function worktree(overrides: Partial<WorkspaceRef> = {}): WorkspaceRef {
  return {
    id: "ws_abc",
    kind: "worktree",
    sourceRoot: "/repo",
    executionRoot: "/tmp/wt",
    canonicalRoot: "/repo",
    branch: "soba/ws-abc",
    head: "deadbeef",
    keep: false,
    ...overrides,
  };
}

describe("executeWorktreeCommand", () => {
  test("reports status and keep for a worktree controller", async () => {
    let current = worktree();
    const controller = {
      getWorkspace: () => current,
      keep: () => {
        current = { ...current, keep: true };
        return current;
      },
      cleanup: async () => {
        current = { ...current, keep: true };
      },
    };

    expect(await executeWorktreeCommand({ args: [], controller })).toEqual({
      kind: "status",
      workspace: current,
    });
    expect(await executeWorktreeCommand({ args: ["keep"], controller })).toEqual({
      kind: "kept",
      workspace: { ...worktree(), keep: true },
    });
    expect(current.keep).toBe(true);
  });

  test("cleans up a worktree and rejects local workspaces", async () => {
    let current = worktree();
    const controller = {
      getWorkspace: () => current,
      keep: () => {
        current = { ...current, keep: true };
        return current;
      },
      cleanup: async () => {
        current = { ...current, keep: true };
      },
    };

    expect(await executeWorktreeCommand({ args: ["cleanup"], controller })).toEqual({
      kind: "cleaned",
      workspace: { ...worktree(), keep: true },
    });

    current = worktree({ kind: "local", executionRoot: "/repo", keep: true });
    expect(await executeWorktreeCommand({ args: ["keep"], controller })).toEqual({
      kind: "not_worktree",
      workspace: current,
    });
  });

  test("returns usage and not_configured", async () => {
    expect(await executeWorktreeCommand({ args: ["maybe"] })).toEqual({ kind: "not_configured" });
    expect(
      await executeWorktreeCommand({
        args: ["maybe"],
        controller: {
          getWorkspace: () => worktree(),
          keep: () => worktree(),
          cleanup: async () => undefined,
        },
      }),
    ).toEqual({ kind: "usage" });
  });
});
