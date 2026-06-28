import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

interface BoundaryRule {
  from: string;
  deny?: string[];
  allowOnlyPublicApplicationApi?: true;
}

const projectRoot = process.cwd();

const rules: BoundaryRule[] = [
  {
    from: "src/kernel/**",
    deny: [
      "src/application/**",
      "src/engine/**",
      "src/infrastructure/**",
      "src/apps/**",
      "src/adapters/**",
      "src/ui/**",
      "node:",
      "bun:",
      "@opentui/",
    ],
  },
  {
    from: "src/engine/**",
    deny: [
      "src/infrastructure/**",
      "src/apps/**",
      "src/adapters/**",
      "src/ui/**",
    ],
  },
  {
    from: "src/application/**",
    deny: [
      "src/apps/**",
      "src/adapters/**",
      "src/ui/**",
      "@opentui/",
    ],
  },
  {
    from: "src/infrastructure/**",
    deny: [
      "src/apps/**",
      "src/ui/**",
    ],
  },
  {
    from: "src/apps/**",
    allowOnlyPublicApplicationApi: true,
  },
  {
    from: "src/ui/**",
    allowOnlyPublicApplicationApi: true,
  },
];

const publicApplicationImports = new Set([
  "src/application/public",
]);

function walkTypescriptFiles(root: string): string[] {
  const absoluteRoot = join(projectRoot, root);
  if (!existsSync(absoluteRoot)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        if (entry === "node_modules" || entry === "dist") continue;
        visit(path);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        files.push(path);
      }
    }
  };
  visit(absoluteRoot);
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

function rootFromGlob(glob: string): string {
  return glob.replace(/\/\*\*$/, "");
}

function normalizeProjectPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\.(ts|tsx|js|jsx)$/, "");
}

function resolveProjectImport(file: string, specifier: string): string | undefined {
  if (specifier.startsWith(".")) {
    const resolved = normalizeProjectPath(relative(projectRoot, join(dirname(file), specifier)));
    return resolved.startsWith("src/") ? resolved : undefined;
  }
  if (specifier.startsWith("src/")) return normalizeProjectPath(specifier);
  return specifier;
}

function matchesPattern(resolved: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) return resolved.startsWith(pattern.slice(0, -3));
  return resolved === pattern || resolved.startsWith(pattern);
}

function violatesPublicApplicationApi(resolved: string): boolean {
  if (resolved.startsWith("src/core/")) return true;
  if (resolved.startsWith("src/kernel/")) return true;
  if (resolved.startsWith("src/engine/")) return true;
  if (resolved.startsWith("src/infrastructure/")) return true;
  if (!resolved.startsWith("src/application/")) return false;
  return !isPublicApplicationApi(resolved);
}

function isPublicApplicationApi(resolved: string): boolean {
  return publicApplicationImports.has(resolved) || /^src\/application\/(?:[^/]+\/)*public$/.test(resolved);
}

const violations: string[] = [];

if (existsSync(join(projectRoot, "src", "core"))) {
  violations.push("src/core exists (retired namespace)");
}

for (const rule of rules) {
  for (const file of walkTypescriptFiles(rootFromGlob(rule.from))) {
    const source = readFileSync(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveProjectImport(file, specifier);
      if (!resolved) continue;

      if (resolved.startsWith("src/core/") || resolved === "src/core") {
        violations.push(`${relative(projectRoot, file)} -> ${specifier} (src/core is retired)`);
        continue;
      }

      const denied = rule.deny?.find((pattern) => matchesPattern(resolved, pattern));
      if (denied) {
        violations.push(`${relative(projectRoot, file)} -> ${specifier} (${denied})`);
        continue;
      }

      if (rule.allowOnlyPublicApplicationApi && violatesPublicApplicationApi(resolved)) {
        violations.push(`${relative(projectRoot, file)} -> ${specifier} (public application API only)`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Architecture boundary violations:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Architecture boundary check passed.");
