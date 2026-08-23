import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { ProjectIdentityResolver } from "../../application/skills/project-trust-store";
import type { WorkspaceLifecyclePort } from "../../kernel/workspace/port";
import {
  createLocalWorkspaceRef,
  markWorkspaceKeep,
  WorkspaceError,
  type WorkspacePrepareRequest,
  type WorkspaceRef,
} from "../../kernel/workspace/public";
import { encodeWorkspaceRoot, isPathInside, samePath } from "./paths";

export interface GitWorkspaceLifecycleOptions {
  identityResolver: ProjectIdentityResolver;
  worktreesHome?: string;
  createId?: () => string;
}

interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export class GitWorkspaceLifecycle implements WorkspaceLifecyclePort {
  private readonly identityResolver: ProjectIdentityResolver;
  private readonly worktreesHome: string;
  private readonly createId: () => string;

  constructor(options: GitWorkspaceLifecycleOptions) {
    this.identityResolver = options.identityResolver;
    this.worktreesHome = resolve(options.worktreesHome ?? join(homedir(), ".soba", "worktrees"));
    this.createId = options.createId ?? createWorkspaceId;
  }

  async prepare(request: WorkspacePrepareRequest): Promise<WorkspaceRef> {
    const sourceRoot = resolve(request.sourceRoot);
    const identity = this.identityResolver.computeProjectIdentity(sourceRoot);

    if (request.kind === "local") {
      return createLocalWorkspaceRef({
        sourceRoot,
        canonicalRoot: identity.canonicalRoot,
      });
    }

    if (isPathInside(this.worktreesHome, sourceRoot) || samePath(this.worktreesHome, sourceRoot)) {
      throw new WorkspaceError(
        "already_in_soba_worktree",
        "Refusing to nest a SOBA worktree inside an existing SOBA worktree.",
      );
    }

    assertGitAvailable();
    assertInsideGitWorkTree(sourceRoot);

    const id = this.createId();
    const checkoutRoot = join(this.worktreesHome, encodeWorkspaceRoot(identity.canonicalRoot), id);
    const sourceRelativePath = relative(identity.canonicalRoot, realpathSync(sourceRoot));
    const executionRoot = sourceRelativePath ? join(checkoutRoot, sourceRelativePath) : checkoutRoot;
    const branch = `soba/ws-${id}`;
    const added = runGit(sourceRoot, ["worktree", "add", "-b", branch, checkoutRoot, "HEAD"]);
    if (added.status !== 0) {
      throw new WorkspaceError(
        "prepare_failed",
        added.stderr.trim() || added.stdout.trim() || "git worktree add failed.",
      );
    }

    return {
      id: `ws_${id}`,
      kind: "worktree",
      sourceRoot,
      executionRoot,
      checkoutRoot,
      canonicalRoot: identity.canonicalRoot,
      branch,
      head: readHead(executionRoot) ?? readHead(sourceRoot),
      keep: request.keep === true,
    };
  }

  async status(workspace: WorkspaceRef): Promise<WorkspaceRef> {
    if (workspace.kind !== "worktree") return workspace;
    return {
      ...workspace,
      head: readHead(workspace.executionRoot) ?? workspace.head,
      branch: readBranch(workspace.executionRoot) ?? workspace.branch,
    };
  }

  keep(workspace: WorkspaceRef): WorkspaceRef {
    return markWorkspaceKeep(workspace);
  }

  async cleanup(workspace: WorkspaceRef): Promise<void> {
    if (workspace.kind !== "worktree") return;
    const checkoutRoot = workspace.checkoutRoot ?? workspace.executionRoot;

    if (samePath(checkoutRoot, workspace.sourceRoot) || samePath(workspace.executionRoot, workspace.sourceRoot)) {
      throw new WorkspaceError(
        "cleanup_refused",
        "Refusing to remove the source checkout.",
      );
    }

    if (!isPathInside(this.worktreesHome, checkoutRoot)) {
      throw new WorkspaceError(
        "cleanup_refused",
        "Refusing to remove a path outside the SOBA worktrees directory.",
      );
    }

    const removed = runGit(workspace.sourceRoot, ["worktree", "remove", "--force", checkoutRoot]);
    if (removed.status !== 0) {
      throw new WorkspaceError(
        "cleanup_failed",
        removed.stderr.trim() || removed.stdout.trim() || "git worktree remove failed.",
      );
    }

    if (workspace.branch) {
      runGit(workspace.sourceRoot, ["branch", "-D", workspace.branch]);
    }
  }
}

function createWorkspaceId(): string {
  return randomBytes(6).toString("hex");
}

function assertGitAvailable(): void {
  const result = runGit(process.cwd(), ["--version"]);
  if (result.status !== 0) {
    throw new WorkspaceError("git_unavailable", "git is not available on PATH.");
  }
}

function assertInsideGitWorkTree(cwd: string): void {
  const result = runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (result.status !== 0 || result.stdout.trim() !== "true") {
    throw new WorkspaceError(
      "not_a_git_repository",
      "--worktree requires a git working tree.",
    );
  }
}

function readHead(cwd: string): string | undefined {
  const result = runGit(cwd, ["rev-parse", "HEAD"]);
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function readBranch(cwd: string): string | undefined {
  const result = runGit(cwd, ["branch", "--show-current"]);
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function runGit(cwd: string, args: string[]): GitResult {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    status: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}
