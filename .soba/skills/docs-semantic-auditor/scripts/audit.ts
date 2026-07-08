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
  | "special-syntax"
  | "capability";

type SupportedLang = "en" | "ru" | "zh";

interface Fact {
  category: FactCategory;
  value: string;
  source: string;
  required: boolean;
  aliases?: string[];
  note?: string;
  lang?: SupportedLang;
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

const CAPABILITY_REQUIREMENTS: Array<{
  id: string;
  source: string;
  phrases: Record<SupportedLang, string[]>;
}> = [
  {
    id: "evidence-proof-receipts",
    source: "docs capability matrix: proof receipts persisted evidence",
    phrases: {
      en: ["Evidence proof receipts", ".soba/evidence/*.soba-proof.json", "soba prove --last"],
      ru: ["Evidence proof receipts", ".soba/evidence/*.soba-proof.json", "soba prove --last"],
      zh: ["Evidence proof receipts", ".soba/evidence/*.soba-proof.json", "soba prove --last"],
    },
  },
  {
    id: "proof-claim-mapping",
    source: "docs capability matrix: claim references to evidence ids",
    phrases: {
      en: ["Proof claim mapping", "mapped to evidence ids", "soba verify"],
      ru: ["Proof claim mapping", "привязаны к evidence ids", "soba verify"],
      zh: ["Proof claim mapping", "映射到 evidence ids", "soba verify"],
    },
  },
  {
    id: "proof-claim-explanations",
    source: "docs capability matrix: explain-claim workflow",
    phrases: {
      en: ["Proof claim explanations", "soba explain-claim", "--proof .soba/evidence/<id>.soba-proof.json"],
      ru: ["Proof claim explanations", "soba explain-claim", "--proof .soba/evidence/<id>.soba-proof.json"],
      zh: ["Proof claim explanations", "soba explain-claim", "--proof .soba/evidence/<id>.soba-proof.json"],
    },
  },
  {
    id: "proof-permission-receipts",
    source: "docs capability matrix: permission receipt fields",
    phrases: {
      en: ["Proof permission receipts", "trust level", "least-privilege alternatives"],
      ru: ["Proof permission receipts", "trust level", "least-privilege alternatives"],
      zh: ["Proof permission receipts", "trust level", "least-privilege alternatives"],
    },
  },
  {
    id: "project-memory-doctor",
    source: "docs capability matrix: memory doctor",
    phrases: {
      en: ["Project Memory doctor", "soba memory doctor --format json", "without starting the agent runtime"],
      ru: ["Project Memory doctor", "soba memory doctor --format json", "без запуска agent runtime"],
      zh: ["Project Memory doctor", "soba memory doctor --format json", "不会启动 agent runtime"],
    },
  },
  {
    id: "memory-source-receipts",
    source: "docs capability matrix: memory source provenance fields",
    phrases: {
      en: ["Memory source receipts", "source.file", "staleIfFilesChange"],
      ru: ["Memory source receipts", "source.file", "staleIfFilesChange"],
      zh: ["Memory source receipts", "source.file", "staleIfFilesChange"],
    },
  },
  {
    id: "memory-receipt-explanations",
    source: "docs capability matrix: memory explain",
    phrases: {
      en: ["Memory receipt explanations", "soba memory explain", "doctor issues"],
      ru: ["Memory receipt explanations", "soba memory explain", "doctor issues"],
      zh: ["Memory receipt explanations", "soba memory explain", "doctor issues"],
    },
  },
  {
    id: "memory-health-commands",
    source: "docs capability matrix: memory health CLI",
    phrases: {
      en: ["Memory health commands", "soba memory stale", "soba memory verify"],
      ru: ["Memory health commands", "soba memory stale", "soba memory verify"],
      zh: ["Memory health commands", "soba memory stale", "soba memory verify"],
    },
  },
  {
    id: "skill-eval-bench-trace",
    source: "docs capability matrix: skill evaluation workflow",
    phrases: {
      en: ["Skill eval bench and trace", "/skill eval <name>", "/skill bench <name>", "/skill trace <name>"],
      ru: ["Skill eval bench and trace", "/skill eval <name>", "/skill bench <name>", "/skill trace <name>"],
      zh: ["Skill eval bench and trace", "/skill eval <name>", "/skill bench <name>", "/skill trace <name>"],
    },
  },
];

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
    const key = `${fact.category}:${fact.lang ?? "all"}:${fact.value}`;
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
  const sourceFile = project.getSourceFileOrThrow("src/application/command-service.ts");
  const declaration = sourceFile.getVariableDeclarationOrThrow("RUNTIME_COMMANDS");
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
      source: "src/application/command-service.ts:RUNTIME_COMMANDS",
      required: true,
    });
  }

  for (const tuiCommandFile of project.getSourceFiles("src/ui/terminal/interactive/commands/*.ts")) {
    for (const objectLiteral of tuiCommandFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      if (!Node.isReturnStatement(objectLiteral.getParent())) continue;
      const nameProperty = objectLiteral.getProperty("name");
      if (!Node.isPropertyAssignment(nameProperty)) continue;
      const value = nameProperty.getInitializerIfKind(SyntaxKind.StringLiteral)?.getLiteralText();
      if (!value) continue;
      facts.push({
        category: "slash-command",
        value: `/${value}`,
        source: `${tuiCommandFile.getFilePath()}:SlashCommand.name`,
        required: true,
      });
    }
  }

  return facts;
}

function cliFlagFacts(project: Project): Fact[] {
  const sourceFile = project.getSourceFileOrThrow("src/apps/cli/args.ts");
  const facts: Fact[] = [];

  for (const literal of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const value = literal.getLiteralText();
    if (!value.startsWith("-")) continue;
    if (!isSwitchCaseLiteral(literal)) continue;
    facts.push({
      category: "cli-flag",
      value,
      source: "src/apps/cli/args.ts:parseArgs",
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
  const sourceFile = project.getSourceFileOrThrow("src/application/config/types.ts");
  const interfaces = ["SobaConfig", "SoundConfig"];
  const facts: Fact[] = [];

  for (const interfaceName of interfaces) {
    const declaration = sourceFile.getInterfaceOrThrow(interfaceName);
    for (const property of declaration.getProperties()) {
      const value = property.getName();
      facts.push({
        category: "config-key",
        value,
        source: `src/application/config/types.ts:${interfaceName}`,
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
  const dotEnvRe = /\bprocess\.env\.(SOBA_[A-Z0-9_]+|NO_COLOR)\b/g;
  const bracketEnvRe = /\bprocess\.env\[\s*["'](SOBA_[A-Z0-9_]+|NO_COLOR)["']\s*\]/g;
  const internalEnvVars = new Set(["SOBA_BUNDLED_SKILLS_PATH", "SOBA_PACKAGE_ROOT"]);

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const matches = [...content.matchAll(dotEnvRe), ...content.matchAll(bracketEnvRe)];
    for (const match of matches) {
      const value = match[1];
      const isIgnored = value.includes("_TEST_") || value.includes("_LIVE_TESTS") || value.includes("_PROXY_HTTP_TESTS") || internalEnvVars.has(value);
      facts.push({
        category: "env-var",
        value,
        source: shortPath(file),
        required: !isIgnored,
        note: isIgnored ? "test/internal environment variable" : undefined,
      });
    }
  }

  return facts;
}

function trustCommandPatternFacts(project: Project): Fact[] {
  const sourceFile = project.getSourceFileOrThrow("src/application/trust/trust-manager.ts");
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
      source: "src/application/trust/trust-manager.ts:DEFAULT_COMMAND_RULES",
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
      source: "src/engine/turn/agent-loop.ts:runShellCommand",
      required: true,
      aliases: ["`!`", "direct shell", "прямые shell", "прямой shell"],
    },
    {
      category: "special-syntax",
      value: "!!",
      source: "src/ui/terminal/interactive/model/tui-store.ts:shell-silent",
      required: true,
      aliases: ["!!", "`!!`", "!!command", "shell-silent", "silent shell"],
    },
  ];
}

function capabilityFacts(): Fact[] {
  return CAPABILITY_REQUIREMENTS.flatMap((requirement) => {
    return (Object.entries(requirement.phrases) as Array<[SupportedLang, string[]]>).flatMap(([lang, phrases]) => {
      return phrases.map((phrase, index) => ({
        category: "capability",
        value: `${lang}:${requirement.id}:${index + 1}`,
        source: requirement.source,
        required: true,
        aliases: [phrase],
        lang,
      } satisfies Fact));
    });
  });
}

function addAliases(facts: Fact[]): Fact[] {
  return facts.map((fact) => {
    const aliases = new Set(fact.aliases ?? []);

    if (!["approval-decision", "permission-mode"].includes(fact.category)) aliases.add(fact.value);
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
    ...stringUnionValues(project, "src/kernel/permissions/trust.ts", "PermissionMode"),
    ...stringUnionValues(project, "src/kernel/permissions/trust.ts", "TrustLevel"),
    ...stringUnionValues(project, "src/engine/turn/types.ts", "ApprovalDecision"),
    ...slashCommandFacts(project),
    ...cliFlagFacts(project),
    ...configKeyFacts(project),
    ...trustCommandPatternFacts(project),
    ...specialSyntaxFacts(),
    ...capabilityFacts(),
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
  const currentDocs = files.filter((file) => {
    const normalized = shortPath(file);
    if (normalized.includes("/v0.6/")) return false;
    if (basename(normalized).startsWith("changelog.")) return false;
    return true;
  });
  return Promise.all(currentDocs.map(async (file) => ({ path: shortPath(file), content: await readFile(file, "utf8") })));
}

function coverFacts(facts: Fact[], docs: Array<{ path: string; content: string }>): CoveredFact[] {
  return facts.map((fact) => {
    if (!fact.required) {
      return { ...fact, covered: false };
    }

    for (const doc of docs) {
      if (fact.lang && docLang(doc.path) !== fact.lang) continue;
      for (const alias of fact.aliases ?? [fact.value]) {
        if (containsFact(doc.content, alias)) {
          return { ...fact, covered: true, matchedBy: alias, matchedIn: doc.path };
        }
      }
    }

    return { ...fact, covered: false };
  });
}

function docLang(path: string): SupportedLang | undefined {
  const match = basename(path).match(/\.([a-z]{2})\.mdx?$/);
  if (!match) return;
  const lang = match[1];
  if (lang === "en" || lang === "ru" || lang === "zh") return lang;
}

function containsFact(content: string, alias: string): boolean {
  const plainContent = content.replace(/[*_`]/g, "");
  if (containsLiteral(content, alias) || containsLiteral(plainContent, alias)) return true;
  return false;
}

function containsLiteral(content: string, alias: string): boolean {
  if (alias.length <= 2 || alias.startsWith("/") || alias.startsWith("-") || alias.includes("_") || alias.includes(" ") || /[^A-Za-z0-9]/.test(alias)) {
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
