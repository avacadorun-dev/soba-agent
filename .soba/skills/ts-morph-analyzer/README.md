# TS-Morph Analyzer

Семантический анализатор кодовой базы SOBA Agent на базе `ts-morph`. Понимает TypeScript типы, cross-file references и dependency graph — в отличие от синтаксических парсеров вроде tree-sitter.

## Зачем это

Когда нужно:
- Понять, кто вызывает функцию перед её изменением
- Построить порядок фаз рефакторинга (зависимости модулей)
- Найти неиспользуемый код перед удалением
- Определить blast radius изменения

## Установка

```bash
bun add -d ts-morph
```

Убедись, что `tsconfig.json` валиден:
```bash
bunx tsc --noEmit
```

## Структура

```
.soba/skills/ts-morph-analyzer/
├── SKILL.md
├── README.md
├── scripts/
│   ├── dependency-graph.ts    # Граф импортов между модулями
│   ├── impact-analysis.ts   # Blast radius для символа
│   ├── find-references.ts   # Cross-file references
│   └── dead-code.ts         # Неиспользуемые экспорты
└── output/                  # Результаты анализа (генерируются)
```

## Запуск

```bash
# Граф зависимостей
bun run .soba/skills/ts-morph-analyzer/scripts/dependency-graph.ts

# Blast radius для функции
bun run .soba/skills/ts-morph-analyzer/scripts/impact-analysis.ts SessionManager

# References
bun run .soba/skills/ts-morph-analyzer/scripts/find-references.ts parseFlags

# Dead code
bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts
```

## Отличие от tree-sitter

| | tree-sitter | ts-morph |
|--|-------------|----------|
| Скорость парсинга | <1ms | 2–10s (инициализация) |
| Понимание типов | ❌ | ✅ |
| Cross-file analysis | ❌ | ✅ |
| Go-to-definition | ❌ | ✅ |
| Impact analysis | ❌ | ✅ |
| Назначение | Syntax highlighting | Code intelligence |

## Интеграция

- **Bug Fixer** — проверяет references перед правкой
- **Regression Runner** — определяет affected tests
- **Architecture Planner** — строит порядок фаз по dependency graph

## Требования

- Bun runtime
- `tsconfig.json` с валидными `paths` и `includes`
- `@types/bun` для Bun-specific APIs (опционально)
