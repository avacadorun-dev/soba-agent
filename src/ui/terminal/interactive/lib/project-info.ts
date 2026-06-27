import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ChangeStat } from "../model/types";

const IGNORED_TREE_ENTRIES = new Set([".git", "node_modules", "dist", ".pi"]);

export function buildFileTree(cwd: string, maxEntries = 35): string[] {
  try {
    return readdirSync(cwd)
      .filter((entry) => !IGNORED_TREE_ENTRIES.has(entry))
      .sort(
        (a, b) =>
          Number(statSync(join(cwd, b)).isDirectory()) - Number(statSync(join(cwd, a)).isDirectory()) ||
          a.localeCompare(b),
      )
      .slice(0, maxEntries)
      .map((entry, index, entries) => {
        const branch = index === entries.length - 1 ? "└─" : "├─";
        return `${branch} ${entry}${statSync(join(cwd, entry)).isDirectory() ? "/" : ""}`;
      });
  } catch {
    return [];
  }
}

export function readChangeStats(cwd: string): ChangeStat[] {
  // Combine tracked file diffs with untracked files for a complete picture
  const diffResult = Bun.spawnSync(["git", "diff", "--numstat"], { cwd, stderr: "ignore", stdout: "pipe" });
  const statusResult = Bun.spawnSync(["git", "status", "--porcelain"], { cwd, stderr: "ignore", stdout: "pipe" });

  // Tracked changes from git diff --numstat
  const diffChanges: ChangeStat[] =
    diffResult.exitCode === 0
      ? diffResult.stdout
          .toString()
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [added = "0", removed = "0", path = ""] = line.split("\t");
            return { path, added: Number(added) || 0, removed: Number(removed) || 0 };
          })
      : [];

  const diffPaths = new Set(diffChanges.map((c) => c.path));

  // Untracked files from git status --porcelain
  const untracked: ChangeStat[] =
    statusResult.exitCode === 0
      ? statusResult.stdout
          .toString()
          .trim()
          .split("\n")
          .filter(Boolean)
          .filter((line) => line.startsWith("?"))
          .map((line) => {
            const path = line.slice(3).trim();
            return { path, added: 0, removed: 0 };
          })
      : [];

  // Filter out untracked entries that already appear in diffChanges
  return [...diffChanges, ...untracked.filter((u) => !diffPaths.has(u.path))];
}
