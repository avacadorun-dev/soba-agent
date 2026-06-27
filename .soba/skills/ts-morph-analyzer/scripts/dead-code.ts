#!/usr/bin/env bun
/**
 * dead-code.ts
 * Находит экспорты без внешних references.
 * Учитывает ссылки в тестах, внутренние references в том же файле,
 * re-export через barrel-файлы (index.ts).
 *
 * Категории кандидатов:
 *   dead    — 0 refs вообще (можно удалить)
 *   internal — используется только внутри своего файла (снять export)
 *   test-only — используется только в тестах (возможно, экспорт не нужен)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { Project } from "ts-morph";

const OUTPUT_DIR = ".soba/skills/ts-morph-analyzer/output";
const OUTPUT_FILE = `${OUTPUT_DIR}/dead-code.json`;

const CWD = process.cwd();
const TESTS_DIR = resolve(CWD, "tests");

interface Candidate {
  filePath: string;
  fileName: string;
  name: string;
  kind: "function" | "class" | "variable";
  line: number;
  totalRefs: number;
  internalRefs: number;
  srcRefs: string[];
  testRefs: string[];
  barrelRefs: string[];
  confidence: "dead" | "internal" | "test-only" | "barrel";
}

function isBarrelFile(filePath: string): boolean {
  const base = basename(filePath);
  return base === "index.ts" || base === "index.tsx";
}

function shortPath(absPath: string): string {
  return absPath.replace(CWD + "/", "");
}

async function main() {
  const project = new Project({
    tsConfigFilePath: "./tsconfig.json",
  });

  // Строим карту barrel-файлов: для каждого barrel собираем что он re-export-ит
  const barrelReExports = new Map<string, Set<string>>(); // barrelPath -> Set of definition paths

  const candidates: Candidate[] = [];

  // Первый проход: собираем barrel-файлы
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes("node_modules")) continue;
    if (!isBarrelFile(filePath)) continue;

    const reExports = new Set<string>();
    for (const exp of sourceFile.getExportedDeclarations().entries()) {
      for (const node of exp[1]) {
        const defFile = node.getSourceFile().getFilePath();
        if (defFile !== filePath) {
          reExports.add(defFile);
        }
      }
    }
    if (reExports.size > 0) {
      barrelReExports.set(filePath, reExports);
    }
  }

  // Второй проход: анализируем экспорты
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes("node_modules")) continue;

    // Пропускаем barrel-файлы — их экспорты и так проанализированы в исходных файлах
    if (isBarrelFile(filePath)) continue;

    // Собираем barrel-файлы, которые re-export-ят этот файл
    const reexportingBarrels: string[] = [];
    for (const [barrelPath, exportedFiles] of barrelReExports) {
      if (exportedFiles.has(filePath)) {
        reexportingBarrels.push(shortPath(barrelPath));
      }
    }

    // Проверяем exported функции
    for (const func of sourceFile.getFunctions()) {
      if (!func.isExported()) continue;
      analyzeExport(func, func.getName() || "(anonymous)", "function", func.getStartLineNumber());
    }

    // Проверяем exported классы
    for (const cls of sourceFile.getClasses()) {
      if (!cls.isExported()) continue;
      analyzeExport(cls, cls.getName() || "(anonymous)", "class", cls.getStartLineNumber());
    }

    // Проверяем exported переменные
    for (const decl of sourceFile.getVariableDeclarations()) {
      if (!decl.getVariableStatement()?.isExported()) continue;
      if (decl.getVariableStatement()?.isDefaultExport()) continue;
      analyzeExport(decl, decl.getName(), "variable", decl.getStartLineNumber());
    }

    function analyzeExport(node: { findReferencesAsNodes(): ReturnType<typeof func.findReferencesAsNodes> }, name: string, kind: "function" | "class" | "variable", line: number) {
      const refs = node.findReferencesAsNodes();

      const internalRefs: string[] = [];
      const srcRefs: string[] = [];
      const testRefs: string[] = [];

      for (const ref of refs) {
        const refPath = ref.getSourceFile().getFilePath();
        const relPath = shortPath(refPath);

        if (refPath === filePath) {
          internalRefs.push(`L${ref.getStartLineNumber()}`);
        } else if (refPath.startsWith(TESTS_DIR)) {
          testRefs.push(relPath);
        } else {
          srcRefs.push(relPath);
        }
      }

      // Уникализируем
      const uniqueSrcRefs = [...new Set(srcRefs)];
      const uniqueTestRefs = [...new Set(testRefs)];

      const hasExternalSrc = uniqueSrcRefs.length > 0;
      const hasTestRefs = uniqueTestRefs.length > 0;
      const hasInternal = internalRefs.length > 0;
      const hasBarrel = reexportingBarrels.length > 0;

      // Уже используется где-то кроме tests — не кандидат
      if (hasExternalSrc) return;

      let confidence: Candidate["confidence"];

      if (!hasInternal && !hasTestRefs && !hasBarrel) {
        confidence = "dead";
      } else if (hasBarrel && (hasInternal || hasTestRefs)) {
        // barrel re-exports + либо internal либо test refs
        confidence = "barrel";
      } else if (hasBarrel && !hasInternal && !hasTestRefs) {
        // только barrel re-exports, никаких прямых refs
        confidence = "barrel";
      } else if (hasTestRefs && !hasInternal) {
        confidence = "test-only";
      } else {
        confidence = "internal";
      }

      candidates.push({
        filePath: shortPath(filePath),
        fileName: basename(filePath),
        name,
        kind,
        line,
        totalRefs: refs.length,
        internalRefs: internalRefs.length,
        srcRefs: uniqueSrcRefs,
        testRefs: uniqueTestRefs,
        barrelRefs: reexportingBarrels,
        confidence,
      });
    }
  }

  // Сортируем по confidence (самые мёртвые сверху), потом по файлу
  const confidenceOrder: Record<string, number> = { dead: 0, internal: 1, "test-only": 2, barrel: 3 };
  candidates.sort((a, b) => {
    const diff = (confidenceOrder[a.confidence] ?? 99) - (confidenceOrder[b.confidence] ?? 99);
    if (diff !== 0) return diff;
    return a.filePath.localeCompare(b.filePath);
  });

  const result = {
    generatedAt: new Date().toISOString(),
    totalCandidates: candidates.length,
    byConfidence: {} as Record<string, number>,
    candidates,
  };

  for (const c of candidates) {
    result.byConfidence[c.confidence] = (result.byConfidence[c.confidence] || 0) + 1;
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(result, null, 2));

  // Человекочитаемый вывод
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     Dead Code Analysis — с учётом тестов  ║");
  console.log("╚══════════════════════════════════════════╝");

  if (candidates.length === 0) {
    console.log("\n✅  Мёртвого кода не найдено!");
    return;
  }

  const labels: Record<string, string> = {
    dead: "💀 dead       (0 refs — можно удалить)",
    internal: "📦 internal   (только внутри файла — снять export)",
    "test-only": "🧪 test-only  (только в тестах)",
    barrel: "📋 barrel     (re-export через index.ts)",
  };

  for (const c of candidates) {
    const label = labels[c.confidence] ?? c.confidence;
    const details: string[] = [];

    if (c.internalRefs > 0) details.push(`${c.internalRefs} internal`);
    if (c.testRefs.length > 0) details.push(`tests: ${c.testRefs.join(", ")}`);
    if (c.barrelRefs.length > 0) details.push(`barrels: ${c.barrelRefs.join(", ")}`);

    const detailStr = details.length > 0 ? ` (${details.join("; ")})` : "";

    console.log(`${label}  ${c.filePath}:${c.line}  ${c.kind} ${c.name}${detailStr}`);
  }

  console.log(`\nВсего: ${candidates.length} кандидатов`);
  console.log(`  💀 dead: ${result.byConfidence.dead ?? 0}`);
  console.log(`  📦 internal: ${result.byConfidence.internal ?? 0}`);
  console.log(`  🧪 test-only: ${result.byConfidence["test-only"] ?? 0}`);
  console.log(`  📋 barrel: ${result.byConfidence.barrel ?? 0}`);
  console.log(`\nSaved to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
