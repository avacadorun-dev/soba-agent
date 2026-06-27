#!/usr/bin/env bun
/**
 * impact-analysis.ts
 * Blast radius для заданного символа (функция, класс, интерфейс).
 * Аргумент: имя символа.
 * Вывод: JSON со списком файлов и строк, где используется символ.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { Project } from "ts-morph";

const OUTPUT_DIR = ".soba/skills/ts-morph-analyzer/output";
const SYMBOL_NAME = process.argv[2];

if (!SYMBOL_NAME) {
  console.error("Usage: bun run impact-analysis.ts <SymbolName>");
  process.exit(1);
}

async function main() {
  const project = new Project({
    tsConfigFilePath: "./tsconfig.json",
  });

  let targetNode = null;

  // Ищем символ по всем файлам
  for (const sourceFile of project.getSourceFiles()) {
    // Проверяем функции
    const func = sourceFile.getFunction(SYMBOL_NAME);
    if (func) {
      targetNode = func;
      break;
    }
    // Классы
    const cls = sourceFile.getClass(SYMBOL_NAME);
    if (cls) {
      targetNode = cls;
      break;
    }
    // Интерфейсы
    const iface = sourceFile.getInterface(SYMBOL_NAME);
    if (iface) {
      targetNode = iface;
      break;
    }
    // Переменные
    const decl = sourceFile.getVariableDeclaration(SYMBOL_NAME);
    if (decl) {
      targetNode = decl;
      break;
    }
  }

  if (!targetNode) {
    console.error(`Symbol '${SYMBOL_NAME}' not found in project.`);
    process.exit(1);
  }

  const refs = targetNode.findReferencesAsNodes();
  const impacts = refs.map((ref) => ({
    filePath: ref.getSourceFile().getFilePath(),
    line: ref.getStartLineNumber(),
    text: ref.getText().slice(0, 80),
  }));

  // Группировка по файлам
  const byFile: Record<string, number> = {};
  for (const imp of impacts) {
    byFile[imp.filePath] = (byFile[imp.filePath] || 0) + 1;
  }

  const result = {
    generatedAt: new Date().toISOString(),
    symbol: SYMBOL_NAME,
    definitionFile: targetNode.getSourceFile().getFilePath(),
    totalReferences: impacts.length,
    affectedFiles: Object.keys(byFile).length,
    byFile,
    references: impacts,
  };

  const outputFile = `${OUTPUT_DIR}/impact-${SYMBOL_NAME}.json`;
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(outputFile, JSON.stringify(result, null, 2));

  console.log(`Impact analysis for '${SYMBOL_NAME}'`);
  console.log(`Definition: ${result.definitionFile}`);
  console.log(`Total references: ${result.totalReferences}`);
  console.log(`Affected files: ${result.affectedFiles}`);
  console.log("Top affected:");
  Object.entries(byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([file, count]) => console.log(`  ${count} refs → ${file}`));
  console.log(`\nSaved to ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
