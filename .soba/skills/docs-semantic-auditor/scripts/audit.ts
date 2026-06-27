#!/usr/bin/env bun
/**
 * Semantic docs coverage audit for SOBA.
 *
 * Extracts user-facing facts from source code, then checks whether docs-site
 * mentions each fact literally or through a small alias set.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { Node, Project, StringLiteral, SyntaxKind, type ArrayLiteralExpression } from "ts-morph";

type FactCategory =
  | "permission-mode"
  | "approval-decision"
  | "trust-level"
  | "slash-command"
  | "cli-flag"
  | "env-var"
  | "config-key"
  | "special-syntax";

interface Fact {
  category: FactCategory;
  value: string;
  source: string;
  required: boolean;
  aliases?: string[];
  note?: string;
}

interface CoveredFact extends Fact {
  covered: boolean;
  matchedBy?: string;
  matchedIn?: string;
}

interface Report {
  generatedAt: string;
  docsRoot: string;
  totalFacts: number;
  requiredFacts: number;
  coveredRequired: number;
  missingRequired: number;
  ignoredFacts: number;
  byCategory: Record<string, { total: number; required: number; covered: number; missing: number; ignored: number }>;
  facts: CoveredFact[];
}

const CWD = process.cwd();
const DEFAULT_DOCS_ROOT = "docs-site/content/docs";
const OUTPUT_DIR = ".soba/skills/docs-semantic-auditor/output";
const OUTPUT_FILE = `${OUTPUT_DIR}/semantic-coverage.json`;

function parseArgs(): { docsRoot: string; json: boolean } {
  const args = process.argv.slice(2);
  let docsRoot = DEFAULT_DOCS_ROOT;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--docs" || arg === "--dir") && args[i + 1]) {
      docsRoot = args[i + 1];
      i++;
      continue;
    }
    if (arg === "--json") {
      json = true;
    }
  }

  return { docsRoot, json };
}

function shortPath(path: string): string {
  return path.startsWith(CWD) ? relative(CWD, path) : path;
}

function uniqueFacts(facts: Fact[]): Fact[] {
  const seen = new Set<string>();
  const result: Fact[] = [];
  for (const fact of facts) {
    const key = `${fact.category}:${fact.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(fact);
  }
  return result.sort((a, b) => `${a.category}:${a.value}`.localeCompare(`${b.category}:${b.value}`));
}

function stringUnionValues(project: Project, sourcePath: string, typeName: string): Fact[] {
  const sourceFile = project.getSourceFileOrThrow(sourcePath);
  const alias = sourceFile.getTypeAliasOrThrow(typeName);
  const union = alias.getTypeNodeOrThrow();
  if (!Node.isUnionTypeNode(union)) return [];

  return union.getTypeNodes().flatMap((node) => {
    if (!Node.isLiteralTypeNode(node)) return [];
    const literal = node.getLiteral();
    if (!Node.isStringLiteral(literal)) return [];
    return [literal.getLiteralText()];
  }).map((value) => ({
    category: typeName === "PermissionMode" ? "permission-mode" : typeName === "TrustLevel" ? "trust-level" : "approval-decision",
    value,
    source: `${sourcePath}:${typeName}`,
    required: true,
  } satisfies Fact));
}

function slashCommandFacts(project: Project): Fact[] {
  const sourceFile = project.getSourceFileOrThrow("src/cli/commands.ts");
  const declaration = sourceFile.getVariableDeclarationOrThrow("SLASH_COMMANDS");
  const initializer = arrayInitializer(declaration.getInitializerOrThrow());
  const facts: Fact[] = [];

  for (const element of initializer.getElements()) {
    if (!Node.isObjectLiteralExpression(element)) continue;
    const nameProperty = element.getProperty("name");
    if (!Node.isPropertyAssignment(nameProperty)) continue;
    const value = nameProperty.getInitializerIfKind(SyntaxKind.StringLiteral)?.getLiteralText();
    if (!value) continue;
    facts.push({
      category: "slash-command",
      value,
      source: "src/cli/commands.ts:SLASH_COMMANDS",
      required: true,
    });
  }

  return facts;
}

function cliFlagFacts(project: Project): Fact[] {
  const sourceFile = project.getSourceFileOrThrow("src/cli/args.ts");
  const facts: Fact[] = [];

  for (const literal of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const value = literal.getLiteralText();
    if (!value.startsWith("-")) continue;
    if (!isSwitchCaseLiteral(literal)) continue;
    facts.push({
      category: "cli-flag",
      value,
      source: "src/cli/args.ts:parseArgs",
      required: true,
    });
  }

  return facts;
}

function isSwitchCaseLiteral(literal: StringLiteral): boolean {
  const parent = literal.getParent();
  return Node.isCaseClause(parent) && parent.getExpression() === literal;
}

function configKeyFacts(project: Project): Fact[] {
  const sourceFile = project.getSourceFileOrThrow("src/core/config/types.ts");
  const interfaces = ["SobaConfig", "SoundConfig"];
  const facts: Fact[] = [];

  for (const interfaceName of interfaces) {
    const declaration = sourceFile.getInterfaceOrThrow(interfaceName);
    for (const property of declaration.getProperties()) {
      const value = property.getName();
      facts.push({
        category: "config-key",
        value,
        source: `src/core/config/types.ts:${interfaceName}`,
        required: interfaceName === "SobaConfig",
        note: interfaceName === "SoundConfig" ? "nested sound config key" : undefined,
      });
    }
  }

  return facts;
}

async function envVarFacts(): Promise<Fact[]> {
  const files = await listFiles("src", [".ts", ".tsx"]);
  const facts: Fact[] = [];
  const envRe = /\b(?:process\.env\.)?(SOBA_[A-Z0-9_]+|NO_COLOR)\b/g;

  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(envRe)) {
      const value = match[1];
      const isTestOnly = value.includes("_TEST_") || value.includes("_LIVE_TESTS") || value.includes("_PROXY_HTTP_TESTS");
      facts.push({
        category: "env-var",
        value,
        source: shortPath(file),
        required: !isTestOnly,
        note: isTestOnly ? "test/internal environment variable" : undefined,
      });
    }
  }

  return facts;
}

function trustCommandPatternFacts(project: Project): Fact[] {
  const sourceFile = project.getSourceFileOrThrow("src/core/trust/trust-manager.ts");
  const declaration = sourceFile.getVariableDeclarationOrThrow("DEFAULT_COMMAND_RULES");
  const initializer = arrayInitializer(declaration.getInitializerOrThrow());
  const importantPatterns = new Set(["rm ", "sudo ", "curl ", "git push", "git reset", "bun run dev", "npm run dev"]);
  const facts: Fact[] = [];

  for (const element of initializer.getElements()) {
    if (!Node.isObjectLiteralExpression(element)) continue;
    const pattern = propertyString(element.getProperty("pattern"));
    const level = propertyString(element.getProperty("level"));
    if (!pattern || !level || !importantPatterns.has(pattern)) continue;
    facts.push({
      category: "trust-level",
      value: `${pattern.trim()}:${level}`,
      source: "src/core/trust/trust-manager.ts:DEFAULT_COMMAND_RULES",
      required: true,
      aliases: [pattern.trim(), `${pattern.trim()}:${level}`],
    });
  }

  return facts;
}

function arrayInitializer(node: Node): ArrayLiteralExpression {
  let current = node;
  while (true) {
    if (Node.isArrayLiteralExpression(current)) return current;
    if (Node.isAsExpression(current) || Node.isSatisfiesExpression(current) || Node.isParenthesizedExpression(current)) {
      current = current.getExpression();
      continue;
    }
    throw new Error(`Expected array initializer, got ${current.getKindName()}`);
  }
}

function propertyString(property: Node | undefined): string | null {
  if (!property || !Node.isPropertyAssignment(property)) return null;
  const initializer = property.getInitializer();
  if (!initializer || !Node.isStringLiteral(initializer)) return null;
  return initializer.getLiteralText();
}

function specialSyntaxFacts(): Fact[] {
  return [
    {
      category: "special-syntax",
      value: "!",
      source: "src/core/loop/agent-loop.ts:runShellCommand",
      required: true,
      aliases: ["`!`", "direct shell", "прямые shell", "прямой shell"],
    },
    {
      category: "special-syntax",
      value: "!!",
      source: "src/widgets/tui/model/tui-store.ts:shell-silent",
      required: true,
      aliases: ["`!!`", "shell-silent", "silent shell"],
    },
  ];
}

function addAliases(facts: Fact[]): Fact[] {
  return facts.map((fact) => {
    const aliases = new Set(fact.aliases ?? []);

    if (!["approval-decision", "permission-mode", "special-syntax"].includes(fact.category)) aliases.add(fact.value);
    if (fact.category === "approval-decision") {
      const shortcut = { once: "y", session: "s", repo: "r", full: "f", deny: "n" }[fact.value];
      aliases.add(`\`${fact.value}\``);
      if (shortcut) aliases.add(`${shortcut} ${fact.value}`);
      if (shortcut) aliases.add(`${shortcut}=${fact.value}`);
      if (shortcut) aliases.add(`${fact.value} (${shortcut})`);
      if (shortcut) aliases.add(`(${shortcut})`);
    }
    if (fact.category === "permission-mode") {
      aliases.add(`\`${fact.value}\``);
      aliases.add(`/permissions ${fact.value}`);
    }

    return { ...fact, aliases: [...aliases] };
  });
}

async function collectSourceFacts(project: Project): Promise<Fact[]> {
  const facts: Fact[] = [
    ...stringUnionValues(project, "src/core/trust/trust-manager.ts", "PermissionMode"),
    ...stringUnionValues(project, "src/core/trust/trust-manager.ts", "TrustLevel"),
    ...stringUnionValues(project, "src/core/loop/types.ts", "ApprovalDecision"),
    ...slashCommandFacts(project),
    ...cliFlagFacts(project),
    ...configKeyFacts(project),
    ...trustCommandPatternFacts(project),
    ...specialSyntaxFacts(),
    ...(await envVarFacts()),
  ];

  return addAliases(uniqueFacts(facts));
}

async function listFiles(root: string, extensions: string[]): Promise<string[]> {
  const absoluteRoot = resolve(CWD, root);
  const result: string[] = [];

  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
        await visit(full);
        continue;
      }
      if (entry.isFile() && extensions.includes(extname(entry.name))) {
        result.push(full);
      }
    }
  }

  await visit(absoluteRoot);
  return result.sort();
}

async function readDocs(docsRoot: string): Promise<Array<{ path: string; content: string }>> {
  const files = await listFiles(docsRoot, [".md", ".mdx"]);
  return Promise.all(files.map(async (file) => ({ path: shortPath(file), content: await readFile(file, "utf8") })));
}

function coverFacts(facts: Fact[], docs: Array<{ path: string; content: string }>): CoveredFact[] {
  return facts.map((fact) => {
    if (!fact.required) {
      return { ...fact, covered: false };
    }

    for (const doc of docs) {
      for (const alias of fact.aliases ?? [fact.value]) {
        if (containsFact(doc.content, alias)) {
          return { ...fact, covered: true, matchedBy: alias, matchedIn: doc.path };
        }
      }
    }

    return { ...fact, covered: false };
  });
}

function containsFact(content: string, alias: string): boolean {
  const plainContent = content.replace(/[*_`]/g, "");
  if (containsLiteral(content, alias) || containsLiteral(plainContent, alias)) return true;
  return false;
}

function containsLiteral(content: string, alias: string): boolean {
  if (alias.length <= 2 || alias.startsWith("/") || alias.startsWith("-") || alias.includes("_") || alias.includes(" ")) {
    return content.includes(alias);
  }
  return new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(content);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeReport(docsRoot: string, facts: CoveredFact[]): Report {
  const byCategory: Report["byCategory"] = {};
  for (const fact of facts) {
    const bucket = byCategory[fact.category] ?? { total: 0, required: 0, covered: 0, missing: 0, ignored: 0 };
    bucket.total++;
    if (!fact.required) {
      bucket.ignored++;
    } else {
      bucket.required++;
      if (fact.covered) bucket.covered++;
      else bucket.missing++;
    }
    byCategory[fact.category] = bucket;
  }

  const required = facts.filter((fact) => fact.required);
  return {
    generatedAt: new Date().toISOString(),
    docsRoot,
    totalFacts: facts.length,
    requiredFacts: required.length,
    coveredRequired: required.filter((fact) => fact.covered).length,
    missingRequired: required.filter((fact) => !fact.covered).length,
    ignoredFacts: facts.filter((fact) => !fact.required).length,
    byCategory,
    facts,
  };
}

function printReport(report: Report): void {
  console.log("╔════════════════════════════════════════════╗");
  console.log("║     Docs Semantic Coverage Audit           ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log(`Docs: ${report.docsRoot}`);
  console.log(`Required coverage: ${report.coveredRequired}/${report.requiredFacts}`);
  console.log(`Missing required: ${report.missingRequired}`);
  console.log(`Ignored/internal facts: ${report.ignoredFacts}`);
  console.log("");

  for (const [category, stats] of Object.entries(report.byCategory)) {
    console.log(`${category.padEnd(18)} required ${String(stats.covered).padStart(3)}/${String(stats.required).padEnd(3)} missing ${stats.missing}`);
  }

  const missing = report.facts.filter((fact) => fact.required && !fact.covered);
  if (missing.length > 0) {
    console.log("\nMissing required facts:");
    for (const fact of missing) {
      console.log(`  - ${fact.category}: ${fact.value} (${fact.source})`);
    }
  }

  console.log(`\nSaved to ${OUTPUT_FILE}`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const project = new Project({ tsConfigFilePath: "./tsconfig.json" });
  const facts = await collectSourceFacts(project);
  const docs = await readDocs(args.docsRoot);
  const covered = coverFacts(facts, docs);
  const report = makeReport(args.docsRoot, covered);

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(report, null, 2));

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
