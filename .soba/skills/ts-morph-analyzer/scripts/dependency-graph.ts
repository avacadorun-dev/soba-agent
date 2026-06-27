#!/usr/bin/env bun
/**
 * dependency-graph.ts
 * Строит граф импортов между модулями проекта.
 * Вывод: JSON с модулями и их зависимостями.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Project } from "ts-morph";

const OUTPUT_DIR = ".soba/skills/ts-morph-analyzer/output";
const OUTPUT_FILE = `${OUTPUT_DIR}/dependency-graph.json`;

async function main() {
  const project = new Project({
    tsConfigFilePath: "./tsconfig.json",
  });

  const graph: Record<string, { imports: string[]; importedBy: string[] }> = {};

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    // Пропускаем node_modules и .d.ts
    if (filePath.includes("node_modules") || filePath.endsWith(".d.ts")) continue;

    const imports = sourceFile
      .getImportDeclarations()
      .map((imp) => imp.getModuleSpecifierValue())
      .filter((spec) => !spec.startsWith(".")) // только внешние или алиасы
      .concat(
        sourceFile
          .getImportDeclarations()
          .map((imp) => {
            const val = imp.getModuleSpecifierValue();
            // Резолвим относительные пути к реальным файлам
            if (val.startsWith(".")) {
              const resolved = dirname(sourceFile.getFilePath()) + "/" + val;
              // Упрощённо: убираем .ts и добавляем .ts
              return resolved.replace(/\/$/, "") + ".ts";
            }
            return null;
          })
          .filter(Boolean) as string[],
      );

    graph[filePath] = {
      imports: [...new Set(imports)],
      importedBy: [],
    };
  }

  // Заполняем importedBy (обратные ссылки)
  for (const [filePath, data] of Object.entries(graph)) {
    for (const imp of data.imports) {
      if (graph[imp]) {
        graph[imp].importedBy.push(filePath);
      }
    }
  }

  // Сортируем по количеству importedBy (хабы вверху)
  const sorted = Object.entries(graph).sort((a, b) => b[1].importedBy.length - a[1].importedBy.length);

  const result = {
    generatedAt: new Date().toISOString(),
    totalFiles: Object.keys(graph).length,
    hubs: sorted.slice(0, 10).map(([path, data]) => ({
      path,
      importedByCount: data.importedBy.length,
    })),
    graph,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(result, null, 2));
  console.log(`Dependency graph saved to ${OUTPUT_FILE}`);
  console.log(`Total files: ${result.totalFiles}`);
  console.log("Top hubs:");
  for (const h of result.hubs) {
    console.log(`  ${h.importedByCount} refs → ${h.path}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
