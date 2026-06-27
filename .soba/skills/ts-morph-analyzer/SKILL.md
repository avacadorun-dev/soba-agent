---
name: ts-morph-analyzer
description: Использует TypeScript Compiler API через `ts-morph` для построения dependency graph, impact analysis, cross-file references и dead-code detection.
---
# TS-Morph Analyzer — Семантический анализ кодовой базы

Использует TypeScript Compiler API через `ts-morph` для построения dependency graph, impact analysis, cross-file references и dead-code detection. Работает с реальной семантикой типов, а не синтаксисом.

> **Dev-only** — этот скилл только для разработки SOBA Agent. Не попадает в bundled скилы продукта.

## Расположение

- **Скилл**: `.soba/skills/ts-morph-analyzer/SKILL.md`
- **Скрипты**: `.soba/skills/ts-morph-analyzer/scripts/`
- **Результаты**: `.soba/skills/ts-morph-analyzer/output/`

## Зависимости

```bash
bun add -d ts-morph
```

## Быстрый старт

Скажи агенту:

```
Проанализируй кодовую базу ts-morph
```

или

```
Run dependency analysis
```

Агент автоматически:
1. Инициализирует `ts-morph` Project из `tsconfig.json`
2. Загрузит все source files
3. Выполнит запрошенный анализ (dependency graph / impact / references / dead code)
4. Сохранит результат в `output/`
5. Покажет summary

## Что умеет ts-morph (в отличие от tree-sitter)

| Возможность | Что даёт | Пример использования |
|-------------|----------|---------------------|
| **Cross-file references** | Найти все вызовы функции по всему проекту | `findReferencesAsNodes()` — blast radius |
| **Dependency graph** | Построить граф импортов с семантикой | `getReferencingNodesInOtherSourceFiles()` |
| **Type resolution** | Понять реальный тип выражения | `getType()` — знает generics, unions, inference |
| **Symbol navigation** | Go to definition семантически | `getSymbol()` + `getDeclarations()` |
| **Dead code detection** | Найти неиспользуемые экспорты | `findReferencesAsNodes()` — если 0 refs вне файла |
| **Rename refactoring** | Безопасный rename с обновлением всех ссылок | `rename()` — обновляет все файлы |
| **Move refactoring** | Перенести символ с обновлением импортов | `moveToDirectory()` |

## Структура скриптов

| Скрипт | Назначение | Время на типичном проекте |
|--------|-----------|---------------------------|
| `dependency-graph.ts` | Граф импортов между модулями | 2–5 сек |
| `impact-analysis.ts` | Blast radius для символа | 1–3 сек |
| `find-references.ts` | Cross-file references для функции/класса | 1–3 сек |
| `dead-code.ts` | Неиспользуемые экспорты и переменные | 3–8 сек |

## Как агент использует скрипты

### Шаг 1: Инициализация Project
```typescript
import { Project } from "ts-morph";

const project = new Project({
  tsConfigFilePath: "./tsconfig.json",
});
```

### Шаг 2: Выбор целевого символа
Агент ищет символ по имени через `project.getSourceFiles()` + `getFunction()` / `getClass()` / `getInterface()`.

### Шаг 3: Анализ
Вызывает соответствующий метод ts-morph:
- `findReferencesAsNodes()` — для impact
- `getReferencingNodesInOtherSourceFiles()` — для dependency graph
- `getType()` — для типового анализа

### Шаг 4: Сохранение результата
JSON или Markdown в `output/`. Формат структурированный, чтобы другие скиллы (Bug Fixer, Regression Runner) могли читать.

## Категории dead-code

Анализатор `dead-code.ts` различает 4 категории с учётом тестов и barrel-файлов:

| Категория | Иконка | Описание | Действие |
|-----------|--------|----------|----------|
| **dead** | 💀 | 0 refs — нигде не используется, даже внутри своего файла | **Удалить** |
| **internal** | 📦 | Используется только внутри своего файла (+ возможно в тестах) | **Снять `export`** |
| **test-only** | 🧪 | Используется ТОЛЬКО в тестах, не в `src/` | Проверить нужность; оставить если test-helper |
| **barrel** | 📋 | Re-export через `index.ts` (прямых импортов нет) | Не трогать — часть публичного API |

Анализатор автоматически:
- Отличает ссылки из `src/` от ссылок из `tests/`
- Находит barrel-файлы (`index.ts`) и проверяет re-export цепочки
- Не флажит экспорты, которые импортируются другими модулями `src/`

## Интеграция с другими скиллами

| Скилл | Как использует результат |
|-------|-------------------------|
| **Bug Fixer** | `impact-analysis.ts` — перед правкой функции проверить, кто её вызывает |
| **Regression Runner** | `dependency-graph.ts` — запускать только тесты затронутых модулей |
| **TS Error Janitor** | `dead-code.ts` — удалить неиспользуемые импорты при чистке P5 |
| **Architecture Planner** | `dependency-graph.ts` + `impact-analysis.ts` — планировать порядок фаз |

## Ограничения

- **Требует компилируемого tsconfig.json.** Если `tsc --noEmit` падает — ts-morph тоже может давать неточные результаты. Сначала TS Error Janitor, потом этот скилл.
- **Не анализирует runtime behavior.** Только static analysis. Dynamic imports (`await import()`) — частично.
- **Bun-specific APIs.** `Bun.file()`, `Bun.write()` — ts-morph видит их как `any`, если нет `@types/bun`. Установить `@types/bun` и добавить в `tsconfig.json` → `compilerOptions.types`.
- **Производительность.** На проекте 1000+ файлов инициализация Project может занять 5–10 сек. Кэшировать `project` между вызовами, не пересоздавать.

## Команды

### Запуск конкретного скрипта
```bash
bun run .soba/skills/ts-morph-analyzer/scripts/dependency-graph.ts
```

### Обновление индекса (если меняли код)
ts-morph читает файлы с диска при каждом `project.getSourceFiles()` — перезапуск скрипта достаточно.

## Безопасность

- **Скрипты только читают.** Все скрипты в паке — read-only (JSON/Markdown output). Не модифицируют `src/`.
- **Refactoring-скрипты (rename/move) — отдельно.** Если агенту нужен rename — требовать явного подтверждения и `git diff` перед коммитом.
- **Не запускать на `node_modules`.** `tsconfig.json` должен исключать `node_modules` через `exclude`.
