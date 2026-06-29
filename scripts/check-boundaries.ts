import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";

interface BoundaryRule {
  from: string;
  deny?: string[];
  allowOnlyPublicApplicationApi?: true;
}

const projectRoot = process.cwd();
const project = new Project({
  tsConfigFilePath: existsSync(join(projectRoot, "tsconfig.json"))
    ? join(projectRoot, "tsconfig.json")
    : undefined,
  skipAddingFilesFromTsConfig: true,
});

const rules: BoundaryRule[] = [
  {
    from: "src/shared/**",
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
      "src/application/**",
      "src/infrastructure/**",
      "src/apps/**",
      "src/adapters/**",
      "src/ui/**",
      "node:",
      "bun:",
    ],
  },
  {
    from: "src/application/**",
    deny: [
      "src/infrastructure/**",
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

function importSpecifiers(file: string): string[] {
  const sourceFile = project.addSourceFileAtPathIfExists(file);
  if (!sourceFile) return [];

  const specifiers: string[] = [];
  for (const declaration of sourceFile.getImportDeclarations()) {
    specifiers.push(declaration.getModuleSpecifierValue());
  }
  for (const declaration of sourceFile.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (specifier) specifiers.push(specifier);
  }

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expression = node.getExpression();
    const firstArg = node.getArguments()[0];
    if (!firstArg || !(Node.isStringLiteral(firstArg) || Node.isNoSubstitutionTemplateLiteral(firstArg))) {
      return;
    }
    if (expression.getKind() === SyntaxKind.ImportKeyword) {
      specifiers.push(firstArg.getLiteralText());
      return;
    }
    if (Node.isIdentifier(expression) && expression.getText() === "require") {
      specifiers.push(firstArg.getLiteralText());
    }
  });

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

function violatesPublicApplicationApi(resolved: string, allowedLocalRoot: string): boolean {
  if (!resolved.startsWith("src/")) return false;
  if (resolved.startsWith(`${allowedLocalRoot}/`)) return false;
  if (allowedLocalRoot === "src/apps" && resolved.startsWith("src/adapters/acp/")) return false;
  if (allowedLocalRoot === "src/apps" && resolved.startsWith("src/ui/terminal/")) return false;
  if (allowedLocalRoot === "src/apps" && resolved.startsWith("src/infrastructure/terminal/")) return false;
  if (resolved.startsWith("src/shared/")) return false;
  if (!resolved.startsWith("src/application/")) return true;
  return !isPublicApplicationApi(resolved);
}

function isPublicApplicationApi(resolved: string): boolean {
  return publicApplicationImports.has(resolved) || /^src\/application\/(?:[^/]+\/)*public$/.test(resolved);
}

const violations: string[] = [];

if (existsSync(join(projectRoot, "src", "core"))) {
  violations.push("src/core exists (retired namespace)");
}

const applicationPublicPath = join(projectRoot, "src", "application", "public.ts");
if (existsSync(applicationPublicPath)) {
  for (const specifier of importSpecifiers(applicationPublicPath)) {
    const resolved = resolveProjectImport(applicationPublicPath, specifier);
    if (!resolved) continue;
    if (
      resolved.startsWith("src/composition/") ||
      resolved.startsWith("src/engine/") ||
      resolved.startsWith("src/infrastructure/") ||
      resolved.startsWith("src/kernel/") ||
      resolved.startsWith("src/apps/") ||
      resolved.startsWith("src/adapters/") ||
      resolved.startsWith("src/ui/")
    ) {
      violations.push(`src/application/public.ts -> ${specifier} (root public API must stay application/shared only)`);
    }
  }
}

const strictApplicationPublicPaths = [
  "src/application/acp/public.ts",
  "src/application/ui/public.ts",
];
for (const publicPath of strictApplicationPublicPaths) {
  const absolutePublicPath = join(projectRoot, publicPath);
  if (!existsSync(absolutePublicPath)) continue;
  for (const specifier of importSpecifiers(absolutePublicPath)) {
    const resolved = resolveProjectImport(absolutePublicPath, specifier);
    if (!resolved) continue;
    if (
      resolved.startsWith("src/composition/") ||
      resolved.startsWith("src/engine/") ||
      resolved.startsWith("src/infrastructure/") ||
      resolved.startsWith("src/apps/") ||
      resolved.startsWith("src/adapters/") ||
      resolved.startsWith("src/ui/")
    ) {
      violations.push(`${publicPath} -> ${specifier} (public API must not re-export concrete layers)`);
    }
  }
}

for (const rule of rules) {
  for (const file of walkTypescriptFiles(rootFromGlob(rule.from))) {
    for (const specifier of importSpecifiers(file)) {
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

      if (rule.allowOnlyPublicApplicationApi && violatesPublicApplicationApi(resolved, rootFromGlob(rule.from))) {
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
