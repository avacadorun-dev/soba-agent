import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectContextReader } from "../../engine/turn/agent-loop";
import type { ProjectCommandFileReader } from "../../engine/verification/types";

export function createProjectContextReader(): ProjectContextReader {
  return {
    read: readProjectContextFiles,
  };
}

export function createProjectCommandFileReader(cwd: string): ProjectCommandFileReader {
  return {
    readText: (relativePath) => readProjectTextFile(cwd, relativePath),
    exists: (relativePath) => projectFileExists(cwd, relativePath),
  };
}

function readProjectContextFiles(cwd: string): Array<{ path: string; content: string }> {
  const agentsPath = join(cwd, "AGENTS.md");
  if (existsSync(agentsPath)) {
    try {
      return [{ path: "AGENTS.md", content: readFileSync(agentsPath, "utf-8") }];
    } catch {
      // Fall through to README.md.
    }
  }

  const readmePath = join(cwd, "README.md");
  if (!existsSync(readmePath)) return [];
  try {
    return [{ path: "README.md", content: readFileSync(readmePath, "utf-8") }];
  } catch {
    return [];
  }
}

function readProjectTextFile(cwd: string, relativePath: string): string | null {
  const absolutePath = join(cwd, relativePath);
  if (!existsSync(absolutePath)) return null;
  try {
    return readFileSync(absolutePath, "utf-8");
  } catch {
    return null;
  }
}

function projectFileExists(cwd: string, relativePath: string): boolean {
  return existsSync(join(cwd, relativePath));
}
