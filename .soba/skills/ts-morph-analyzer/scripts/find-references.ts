#!/usr/bin/env bun
/**
 * find-references.ts
 * Находит все cross-file references для символа.
 * Аргумент: имя символа.
 * Вывод: Markdown с таблицей references.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { Project } from "ts-morph";

const OUTPUT_DIR = ".soba/skills/ts-morph-analyzer/output";
const SYMBOL_NAME = process.argv[2];

if (!SYMBOL_NAME) {
  console.error("Usage: bun run find-references.ts <SymbolName>");
  process.exit(1);
}

async function main() {
  const project = new Project({
    tsConfigFilePath: "./tsconfig.json",
  });

  let targetNode = null;

  for (const sourceFile of project.getSourceFiles()) {
    const func = sourceFile.getFunction(SYMBOL_NAME);
    if (func) {
      targetNode = func;
      break;
    }
    const cls = sourceFile.getClass(SYMBOL_NAME);
    if (cls) {
      targetNode = cls;
      break;
    }
    const iface = sourceFile.getInterface(SYMBOL_NAME);
    if (iface) {
      targetNode = iface;
      break;
    }
  }

  if (!targetNode) {
    console.error(`Symbol '${SYMBOL_NAME}' not found.`);
    process.exit(1);
  }

  const refs = targetNode.findReferencesAsNodes();
  const lines = [
    `# References: ${SYMBOL_NAME}`,
    "",
    `**Definition:** \`${targetNode.getSourceFile().getFilePath()}\``,
    `**Total references:** ${refs.length}`,
    "",
    "| File | Line | Context |",
    "|------|------|---------|",
  ];

  for (const ref of refs) {
    const file = ref.getSourceFile().getFilePath();
    const line = ref.getStartLineNumber();
    const text = ref.getText().slice(0, 60).replace(/\|/g, "\\|");
    lines.push(`| ${file} | ${line} | \`${text}\` |`);
  }

  const outputFile = `${OUTPUT_DIR}/references-${SYMBOL_NAME}.md`;
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(outputFile, lines.join("\n"));

  console.log(`Found ${refs.length} references for '${SYMBOL_NAME}'`);
  console.log(`Saved to ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
