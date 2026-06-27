import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const projectRoot = process.cwd();
const coreRoot = join(projectRoot, "src", "core");
const forbiddenCoreTargets = [
  "src/apps/",
  "src/application/",
  "src/adapters/",
  "src/ui/terminal/output/",
  "src/ui/",
];

function walkTypescriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walkTypescriptFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importRe = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImportRe = /import\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(importRe)) specifiers.push(match[1]);
  for (const match of source.matchAll(dynamicImportRe)) specifiers.push(match[1]);
  return specifiers;
}

function resolveProjectImport(file: string, specifier: string): string | null {
  if (specifier.startsWith(".")) {
    const fromProject = relative(projectRoot, join(file, "..", specifier)).replaceAll("\\", "/");
    return fromProject.startsWith("src/") ? fromProject : null;
  }
  if (specifier.startsWith("src/")) return specifier;
  return null;
}

describe("architecture import boundaries", () => {
  test("src/core does not import app, TUI, widget, or protocol adapter layers", () => {
    const violations: string[] = [];
    for (const file of walkTypescriptFiles(coreRoot)) {
      const source = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        const resolved = resolveProjectImport(file, specifier);
        if (!resolved) continue;
        const forbiddenTarget = forbiddenCoreTargets.find((target) => resolved.startsWith(target));
        if (forbiddenTarget) {
          violations.push(`${relative(projectRoot, file)} -> ${specifier} (${forbiddenTarget})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
