import { relative, resolve } from "node:path";

export function isProjectMemoryPath(cwd: string, inputPath: string): boolean {
  const projectRoot = resolve(cwd);
  const memoryRoot = resolve(projectRoot, ".soba", "memory");
  const targetPath = resolve(projectRoot, inputPath);
  const rel = relative(memoryRoot, targetPath);

  return rel === "" || (!rel.startsWith("..") && resolve(rel) !== rel);
}

export const PROJECT_MEMORY_DIRECT_WRITE_NEXT_ACTION =
  "Use read_project_memory or write_project_memory for .soba/memory changes. Do not edit memory store files directly.";
