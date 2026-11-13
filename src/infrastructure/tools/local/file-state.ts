/**
 * File state tracker for read/edit/write freshness checks.
 *
 * Records the content hash and mtime of files the agent has read so that
 * edit and write can refuse changes computed against stale content. Keyed by
 * cwd + absolute path; entries are best-effort and never fail tool calls.
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

export interface FileState {
  sha256: string;
  mtimeMs: number;
}

const states = new Map<string, FileState>();

function keyFor(cwd: string, absolutePath: string): string {
  return `${cwd}${absolutePath}`;
}

export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Record the observed state of a file after a successful read. */
export function recordFileState(cwd: string, absolutePath: string, content: string | Buffer, mtimeMs?: number): void {
  try {
    states.set(keyFor(cwd, absolutePath), {
      sha256: hashContent(content),
      mtimeMs: mtimeMs ?? Date.now(),
    });
  } catch {
    // Best-effort only.
  }
}

/** Drop tracked state (e.g. after the file was deleted). */
export function forgetFileState(cwd: string, absolutePath: string): void {
  states.delete(keyFor(cwd, absolutePath));
}

export interface StaleCheckResult {
  stale: boolean;
  reason?: string;
}

/**
 * Check whether the file changed since the last recorded read.
 * A recorded state whose mtime still matches is fresh; an mtime change with
 * identical content (touch) refreshes the record; changed content is stale.
 */
export async function checkFileFreshness(cwd: string, absolutePath: string): Promise<StaleCheckResult> {
  const recorded = states.get(keyFor(cwd, absolutePath));
  if (!recorded) return { stale: false };

  let currentMtime: number;
  try {
    currentMtime = (await stat(absolutePath)).mtimeMs;
  } catch {
    forgetFileState(cwd, absolutePath);
    return { stale: false };
  }

  if (currentMtime === recorded.mtimeMs) return { stale: false };

  let content: string;
  try {
    content = await readFile(absolutePath, "utf-8");
  } catch {
    return { stale: false };
  }

  const currentHash = hashContent(content);
  if (currentHash === recorded.sha256) {
    recordFileState(cwd, absolutePath, content, currentMtime);
    return { stale: false };
  }

  return {
    stale: true,
    reason: "file content changed since the last read in this session",
  };
}
