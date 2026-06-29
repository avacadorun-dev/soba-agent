import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";

const START_MARKER = "<!-- dependency-graph:start -->";
const END_MARKER = "<!-- dependency-graph:end -->";

interface GraphNode {
  id: string;
  label: string;
  roots: string[];
}

const projectRoot = process.cwd();
const project = new Project({
  tsConfigFilePath: existsSync(join(projectRoot, "tsconfig.json")) ? join(projectRoot, "tsconfig.json") : undefined,
  skipAddingFilesFromTsConfig: true,
});

const graphNodes: GraphNode[] = [
  { id: "cliShim", label: "src/cli.ts", roots: ["src/cli"] },
  { id: "appsCli", label: "src/apps/cli", roots: ["src/apps/cli"] },
  { id: "appsAcp", label: "src/apps/acp", roots: ["src/apps/acp"] },
  { id: "adaptersAcp", label: "src/adapters/acp", roots: ["src/adapters/acp"] },
  { id: "application", label: "src/application", roots: ["src/application"] },
  { id: "composition", label: "src/composition", roots: ["src/composition"] },
  { id: "engine", label: "src/engine", roots: ["src/engine"] },
  { id: "infrastructure", label: "src/infrastructure", roots: ["src/infrastructure"] },
  { id: "kernel", label: "src/kernel", roots: ["src/kernel"] },
  { id: "shared", label: "src/shared", roots: ["src/shared"] },
  { id: "uiOutput", label: "src/ui/terminal/output", roots: ["src/ui/terminal/output"] },
  { id: "uiInteractive", label: "src/ui/terminal/interactive", roots: ["src/ui/terminal/interactive"] },
  { id: "uiTerminal", label: "src/ui/terminal", roots: ["src/ui/terminal"] },
];

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

function normalizeProjectPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\.(ts|tsx|js|jsx)$/, "");
}

function resolveProjectImport(file: string, specifier: string): string | undefined {
  if (specifier.startsWith(".")) {
    const resolved = normalizeProjectPath(relative(projectRoot, join(dirname(file), specifier)));
    return resolved.startsWith("src/") ? resolved : undefined;
  }
  if (specifier.startsWith("src/")) return normalizeProjectPath(specifier);
  return undefined;
}

function graphNodeForPath(path: string): GraphNode | undefined {
  return graphNodes.find((node) =>
    node.roots.some((root) => path === root || path.startsWith(`${root}/`)),
  );
}

function generateMermaidDependencyGraph(): string {
  const edges = new Set<string>();

  for (const file of walkTypescriptFiles("src")) {
    const fromPath = normalizeProjectPath(relative(projectRoot, file));
    const fromNode = graphNodeForPath(fromPath);
    if (!fromNode) continue;

    for (const specifier of importSpecifiers(file)) {
      const resolved = resolveProjectImport(file, specifier);
      if (!resolved) continue;
      const toNode = graphNodeForPath(resolved);
      if (!toNode || toNode.id === fromNode.id) continue;
      edges.add(`${fromNode.id}-->${toNode.id}`);
    }
  }

  const lines = [
    "flowchart TD",
    ...graphNodes.map((node) => `  ${node.id}["${node.label}"]`),
    "",
    ...[...edges]
      .sort()
      .map((edge) => {
        const [from, to] = edge.split("-->");
        return `  ${from} --> ${to}`;
      }),
  ];

  return lines.join("\n");
}

function renderGeneratedSection(): string {
  return [
    START_MARKER,
    "<!-- Generated by `bun run docs:deps`. Do not edit this block by hand. -->",
    "```mermaid",
    generateMermaidDependencyGraph(),
    "```",
    END_MARKER,
  ].join("\n");
}

function updateArchitectureDocument(input: string): string {
  const generated = renderGeneratedSection();
  const start = input.indexOf(START_MARKER);
  const end = input.indexOf(END_MARKER);
  if (start >= 0 && end > start) {
    return `${input.slice(0, start)}${generated}${input.slice(end + END_MARKER.length)}`;
  }

  const manualBlock = /```mermaid\n[\s\S]*?\n```/;
  if (!manualBlock.test(input)) {
    throw new Error(`Could not find a Mermaid block or ${START_MARKER} markers in ARCHITECTURE.md`);
  }
  return input.replace(manualBlock, generated);
}

const architecturePath = join(projectRoot, "ARCHITECTURE.md");
const current = readFileSync(architecturePath, "utf8");
const next = updateArchitectureDocument(current);
const checkMode = process.argv.includes("--check");

if (checkMode) {
  if (current !== next) {
    console.error("ARCHITECTURE.md dependency graph is stale. Run `bun run docs:deps`.");
    process.exit(1);
  }
  console.log("ARCHITECTURE.md dependency graph is up to date.");
} else {
  writeFileSync(architecturePath, next);
  console.log("Updated ARCHITECTURE.md dependency graph.");
}
