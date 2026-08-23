import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemProjectIdentityResolver } from "../../../src/infrastructure/persistence/skills/project-trust-storage";
import { GitWorkspaceLifecycle } from "../../../src/infrastructure/workspace/git-workspace";
import { WorkspaceError } from "../../../src/kernel/workspace/public";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "soba-workspace-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("FilesystemProjectIdentityResolver", () => {
  test("shares canonical root and git common dir between a repo and its worktree", () => {
    const repo = initRepo(join(tempDir, "repo"));
    const worktree = join(tempDir, "linked");
    git(repo, ["worktree", "add", worktree, "HEAD"]);

    const resolver = new FilesystemProjectIdentityResolver();
    const fromRepo = resolver.computeProjectIdentity(repo);
    const fromWorktree = resolver.computeProjectIdentity(worktree);

    expect(fromRepo.canonicalRoot).toBe(fromWorktree.canonicalRoot);
    expect(fromRepo.gitCommonDir).toBe(fromWorktree.gitCommonDir);
    expect(fromRepo.canonicalRoot).toBe(repo);
  });

  test("falls back to the real path when git is absent", () => {
    const project = join(tempDir, "plain");
    mkdirSync(project);
    const identity = new FilesystemProjectIdentityResolver().computeProjectIdentity(project);
    expect(identity.canonicalRoot).toBe(project);
    expect(identity.gitCommonDir).toBeUndefined();
  });
});

describe("GitWorkspaceLifecycle", () => {
  test("local prepare is identity and cleanup is a no-op", async () => {
    const repo = initRepo(join(tempDir, "repo"));
    const lifecycle = createLifecycle();
    const workspace = await lifecycle.prepare({ kind: "local", sourceRoot: repo });

    expect(workspace.kind).toBe("local");
    expect(workspace.executionRoot).toBe(repo);
    expect(workspace.sourceRoot).toBe(repo);
    expect(workspace.keep).toBe(true);
    await lifecycle.cleanup(workspace);
    expect(Bun.file(join(repo, "README.md")).size).toBeGreaterThan(0);
  });

  test("creates isolated worktrees and refuses to delete the source checkout", async () => {
    const repo = initRepo(join(tempDir, "repo"));
    const worktreesHome = join(tempDir, "home");
    const lifecycle = createLifecycle(worktreesHome);

    const first = await lifecycle.prepare({ kind: "worktree", sourceRoot: repo });
    const second = await lifecycle.prepare({
      kind: "worktree",
      sourceRoot: repo,
      keep: true,
    });

    expect(first.kind).toBe("worktree");
    expect(first.branch).toBe("soba/ws-id0000000001");
    expect(first.executionRoot.startsWith(worktreesHome)).toBe(true);
    expect(first.executionRoot).not.toBe(repo);
    expect(second.executionRoot).not.toBe(first.executionRoot);
    expect(Bun.file(join(first.executionRoot, "README.md")).size).toBeGreaterThan(0);

    writeFileSync(join(first.executionRoot, "isolated.txt"), "only worktree\n");
    expect(await Bun.file(join(repo, "isolated.txt")).exists()).toBe(false);

    await expect(
      lifecycle.cleanup({
        ...first,
        checkoutRoot: repo,
        executionRoot: repo,
      }),
    ).rejects.toMatchObject({ code: "cleanup_refused" });

    await lifecycle.cleanup(first);
    expect(await Bun.file(join(first.executionRoot, "README.md")).exists()).toBe(false);
    expect(await Bun.file(join(repo, "README.md")).exists()).toBe(true);

    await lifecycle.cleanup(second);
  });

  test("preserves the invocation subdirectory while cleaning up the worktree root", async () => {
    const repo = initRepo(join(tempDir, "repo"));
    const sourceRoot = join(repo, "packages", "tool");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "package.json"), "{}\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "add nested project"]);

    const worktreesHome = join(tempDir, "home");
    const lifecycle = createLifecycle(worktreesHome);
    const workspace = await lifecycle.prepare({ kind: "worktree", sourceRoot });

    expect(workspace.sourceRoot).toBe(sourceRoot);
    expect(workspace.canonicalRoot).toBe(repo);
    expect(workspace.checkoutRoot?.startsWith(worktreesHome)).toBe(true);
    expect(workspace.executionRoot).toBe(join(workspace.checkoutRoot!, "packages", "tool"));
    expect(await Bun.file(join(workspace.executionRoot, "package.json")).exists()).toBe(true);

    await lifecycle.cleanup(workspace);
    expect(await Bun.file(workspace.checkoutRoot!).exists()).toBe(false);
    expect(await Bun.file(join(sourceRoot, "package.json")).exists()).toBe(true);
  });

  test("fails closed outside a git repository", async () => {
    const plain = join(tempDir, "plain");
    mkdirSync(plain);
    const lifecycle = createLifecycle();
    await expect(lifecycle.prepare({ kind: "worktree", sourceRoot: plain })).rejects.toBeInstanceOf(
      WorkspaceError,
    );
  });

  test("refuses to nest a SOBA worktree inside another SOBA worktree", async () => {
    const repo = initRepo(join(tempDir, "repo"));
    const worktreesHome = join(tempDir, "home");
    const lifecycle = createLifecycle(worktreesHome);
    const workspace = await lifecycle.prepare({ kind: "worktree", sourceRoot: repo, keep: true });

    await expect(
      lifecycle.prepare({ kind: "worktree", sourceRoot: workspace.executionRoot }),
    ).rejects.toMatchObject({ code: "already_in_soba_worktree" });

    await lifecycle.cleanup(workspace);
  });
});

function createLifecycle(worktreesHome = join(tempDir, "home"), createId?: () => string) {
  let next = 0;
  return new GitWorkspaceLifecycle({
    identityResolver: new FilesystemProjectIdentityResolver(),
    worktreesHome,
    createId: createId ?? (() => `id${String(++next).padStart(10, "0")}`),
  });
}

function initRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "workspace@example.test"]);
  git(dir, ["config", "user.name", "Workspace Test"]);
  git(dir, ["checkout", "-b", "main"]);
  writeFileSync(join(dir, "README.md"), "hello\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || result.stdout.toString());
  }
}
