# SOBA Agent — Документация

## Структура

```
docs/
├── README.md                     # Этот файл — индекс
├── unified-roadmap-1.0.0.md      # Дорожная карта к 1.0.0
├── build-binary.md               # Сборка standalone-бинарника
├── portable-capsules.md          # Руководство по переносимым knowledge capsules
├── mcp.md                        # Руководство по MCP stdio и remote Streamable HTTP servers
│
├── user-guides                    → перенесены в docs-site/content/docs/
│
├── architecture/                 # 🏗️ Архитектурная документация
│   ├── zod-schemas.md            # Zod-схемы OpenResponses API
│   ├── compaction-endurance.md   # Endurance-сценарии compaction
│   └── mcp/                      # MCP (Model Context Protocol)
│       ├── plan.md               # План реализации
│       ├── review-v1.md          # Ревью v1
│       └── review-v2.md          # Ревью v2
│
├── phases/                       # 📋 Артефакты разработки по фазам
│   ├── phase-1-mvp/              # Фаза 1: ядро + ручная компакция
│   │   ├── design.md             # Архитектурные решения
│   │   ├── use-cases.md          # User-стори и сценарии
│   │   ├── plan.md               # План реализации
│   │   ├── validation.md         # Отчёт валидации
│   │   ├── readiness-review.md   # Readiness review
│   │   ├── manual-smoke-test.md  # Ручной smoke-тест
│   │   ├── bugs/                 # Баг-репорты
│   │   ├── features/             # Фича-спецификации
│   │   └── manual-test-runs/     # Результаты ручных прогонов
│   ├── phase-2-core/             # Фаза 2: Context Intelligence + Adaptive Skills
│   ├── phase-2.5-tui-ux/         # Фаза 2.5: TUI Polish & UX
│   ├── phase-3-project-memory/   # Фаза 3: Project Memory + Fix-Until-Green + CI/CD
│   ├── phase-3.5-portable-capsules/
│   ├── phase-4-v0.4.0-project-memory-mcp/
│   ├── phase-4.5-agent-loop-tuning/ # v0.4.0 Agent Loop Tuning epic
│   ├── phase-5-v0.5.0-clean-architecture-acp/
│   └── phase-6-v0.5.x-evidence-ux/
│
└── testing/                      # 🧪 Тестовая инфраструктура
    ├── regression-plan.md        # План регрессионного тестирования
    ├── automation-plan.md        # План автоматизации
    └── regression-cases/         # Регрессионные кейсы (36 сценариев)
        └── INDEX.md              # Индекс кейсов
```

## Фазы

| Фаза | Название | Статус | Документация |
|------|----------|--------|-------------|
| 1 | MVP (ядро + compaction) | ✅ Реализована | [phases/phase-1-mvp/](./phases/phase-1-mvp/) |
| 2 | Context Intelligence + Adaptive Skills | ✅ Core реализован | [phases/phase-2-core/](./phases/phase-2-core/) |
| 2.5 | TUI Polish & UX | ✅ Реализована | [phases/phase-2.5-tui-ux/](./phases/phase-2.5-tui-ux/) |
| 3 | Project Memory + Fix-Until-Green + CI/CD | ✅ Реализована | [phases/phase-3-project-memory/](./phases/phase-3-project-memory/) |
| 3.5 | Portable Capsules | ✅ Core реализован | [phases/phase-3.5-portable-capsules/](./phases/phase-3.5-portable-capsules/) |
| 4 | Project Memory + MCP + Verified Agent Loop | ✅ Реализована | [phases/phase-4-v0.4.0-project-memory-mcp/](./phases/phase-4-v0.4.0-project-memory-mcp/) |
| 4.5 | Agent Loop Tuning + Built-in Skills | ✅ Реализована | [phases/phase-4.5-agent-loop-tuning/](./phases/phase-4.5-agent-loop-tuning/) |
| 5 | v0.5.0 Clean Architecture + ACP | ✅ Реализована | [phases/phase-5-v0.5.0-clean-architecture-acp/](./phases/phase-5-v0.5.0-clean-architecture-acp/) |
| 6 | v0.5.x Evidence UX + Diff Review | ⏳ Следующая | [phases/phase-6-v0.5.x-evidence-ux/](./phases/phase-6-v0.5.x-evidence-ux/) |

## Процесс фазы

Каждая фаза проходит по цепочке:

```
Дизайн → Use Cases → Документация → План → Реализация → Тесты
```

1. **Design** (`design.md`) — архитектурные решения, структуры данных, потоки, диаграммы
2. **Use Cases** (`use-cases.md`) — user stories, сценарии, приоритеты
3. **Docs** — нормативная техническая документация до и во время реализации (API, форматы)
4. **Plan** (`plan.md`) — детальный план задач с оценками и чеклистами
5. **Implementation** — код в `src/` и тесты в `tests/`

После завершения фазы:
- Обновить этот README (статус фазы)
- Зафиксировать learnings в `AGENTS.md`
- Создать `phases/phase-N-<name>/retrospective.md` с выводами

## Текущий статус

**Фаза 1 / SOBA 0.2.0** — функционально реализована, автоматические проверки проходят:
- [Design](./phases/phase-1-mvp/design.md) ✅
- [Use Cases](./phases/phase-1-mvp/use-cases.md) ✅
- [Plan](./phases/phase-1-mvp/plan.md) ✅
- [Readiness Review](./phases/phase-1-mvp/readiness-review.md) ✅
- [Validation](./phases/phase-1-mvp/validation.md) ✅
- [Manual Smoke Test](./phases/phase-1-mvp/manual-smoke-test.md) ✅

**Фаза 2 / SOBA 0.3.0** — core-модули и production CLI-интеграция реализованы:
- [Design](./phases/phase-2-core/design.md)
- [Use Cases](./phases/phase-2-core/use-cases.md)
- [Technical Spec](./phases/phase-2-core/technical-spec.md)
- [Plan](./phases/phase-2-core/plan.md)
- [Manual Test Run](./phases/phase-2-core/manual-test-run.md)
- [Readiness Review](./phases/phase-2-core/readiness-review.md)
- [Endurance Results](./phases/phase-2-core/endurance-results.md)
- [Validation](./phases/phase-2-core/validation.md)

**Фаза 2.5 / SOBA 0.3.5** — TUI/UX improvements реализованы:
- [Design](./phases/phase-2.5-tui-ux/design.md)
- [Use Cases](./phases/phase-2.5-tui-ux/use-cases.md)
- [Docs](./phases/phase-2.5-tui-ux/docs.md)
- [Plan](./phases/phase-2.5-tui-ux/plan.md)
- [Review Summary](./phases/phase-2.5-tui-ux/review-summary.md)

**Фаза 3 / SOBA 0.4.0** — Project Memory + Fix-Until-Green + CI/CD:
- [Design](./phases/phase-3-project-memory/design.md)
- [Use Cases](./phases/phase-3-project-memory/use-cases.md)
- [Docs](./phases/phase-3-project-memory/docs.md)
- [Plan](./phases/phase-3-project-memory/plan.md)
- [Dependency Analysis](./phases/phase-3-project-memory/dependency-analysis.md)
- [Positioning](./phases/phase-3-project-memory/positioning.md)

**Фаза 4.5 / v0.4.0 Agent Loop Tuning** — короткий prompt → профессиональный инженерный workflow:
- [README](./phases/phase-4.5-agent-loop-tuning/README.md)
- [Current State Audit](./phases/phase-4.5-agent-loop-tuning/current-state-audit.md)
- [Research Notes](./phases/phase-4.5-agent-loop-tuning/research-notes.md)
- [Design](./phases/phase-4.5-agent-loop-tuning/design.md)
- [Use Cases](./phases/phase-4.5-agent-loop-tuning/use-cases.md)
- [Technical Spec](./phases/phase-4.5-agent-loop-tuning/technical-spec.md)
- [Plan](./phases/phase-4.5-agent-loop-tuning/plan.md)
- [Implementation Plan](./phases/phase-4.5-agent-loop-tuning/implementation-plan.md)
- [Tasks](./phases/phase-4.5-agent-loop-tuning/tasks/)
- [Checkpoint Policy](./phases/phase-4.5-agent-loop-tuning/checkpoint-policy.md)
- [Manual Test Run](./phases/phase-4.5-agent-loop-tuning/manual-test-run.md)

Обязательный UX-контракт этой фазы: агент не только действует и проверяет результат, но и оставляет краткий
пользовательски видимый рабочий след: что понял, какой контекст собрал, что обнаружил, что делает дальше и чем проверил.

**Фаза 5 / v0.5.0 Clean Architecture + ACP** — завершена:
- [README](./phases/phase-5-v0.5.0-clean-architecture-acp/README.md)
- [Technical Spec](./phases/phase-5-v0.5.0-clean-architecture-acp/technical-spec.md)
- [Implementation Plan](./phases/phase-5-v0.5.0-clean-architecture-acp/implementation-plan.md)
- [Validation](./phases/phase-5-v0.5.0-clean-architecture-acp/validation.md)
- [ACP + Zed Plan](./phases/phase-5-v0.5.0-clean-architecture-acp/acp-zed-plan.md)
- [Retrospective](./phases/phase-5-v0.5.0-clean-architecture-acp/retrospective.md)

Фаза закрыла архитектурный разрез, общий runtime contract и ACP v1 путь для Zed. Evidence Bundle, Diff Review UX и
first-run polish перенесены в следующую фазу.

**Фаза 6 / v0.5.x Evidence UX + Diff Review** — следующая:
- [README](./phases/phase-6-v0.5.x-evidence-ux/README.md)
- [Technical Spec](./phases/phase-6-v0.5.x-evidence-ux/technical-spec.md)
- [Implementation Plan](./phases/phase-6-v0.5.x-evidence-ux/implementation-plan.md)
- [Validation](./phases/phase-6-v0.5.x-evidence-ux/validation.md)

Цель фазы: каждый финальный ответ должен показывать changed files, commands/checks, pass/fail/skipped и честные risk
notes; Diff Review должен дать принять/отклонить изменения до сдачи.

## Ключевые ссылки

- [Руководство пользователя](../docs-site/content/docs/index.ru.mdx)
- [Быстрый старт](../docs-site/content/docs/quick-start.ru.mdx)
- [Дорожная карта к 1.0.0](./unified-roadmap-1.0.0.md)
- [Бизнес-требования](../BUSINESS_REQUIREMENTS.md)
- [Инструкции для разработки](../AGENTS.md)
- [Contributing](../CONTRIBUTING.md)
- [Сборка standalone-бинарника](./build-binary.md)
- [Portable Capsules](./portable-capsules.md)
- [MCP stdio и remote Streamable HTTP servers](./mcp.md)
- [Архитектура: Zod-схемы](./architecture/zod-schemas.md)
- [Архитектура: MCP](./architecture/mcp/plan.md)
