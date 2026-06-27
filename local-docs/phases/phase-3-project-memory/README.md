# Phase 3 — Project Memory + Fix-Until-Green + CI/CD

**Версия:** SOBA 0.4.0
**Статус:** 📋 Планирование

## Scope

Phase 3 фокусируется на трёх pillar'ах делегирования:

1. **🔴 Project Memory** — память между сессиями (Knowledge Store + Capsule Store + Entity Graph)
2. **🔴 Fix-Until-Green** — self-healing loop (авто-отладка и исправление кода)
3. **🟡 CI/CD Pipeline** — непрерывная интеграция (GitHub Actions, pre-commit, templates)

## Что перенесено в Phase 2.5

Все TUI/UX улучшения (ProviderRegistry, Notifications, TrustDialog, ModelSelector,
Enhanced Sidebar, Collapsible Results, Turn Separator, Search, Hotkeys, ~~Session Browser~~ (исключено))
вынесены в `docs/phase-2.5-tui-ux/`.

## Документы

- [design.md](./design.md) — архитектурный дизайн
- [use-cases.md](./use-cases.md) — user stories
- [docs.md](./docs.md) — техническая документация
- [plan.md](./plan.md) — план реализации (dependency-ordered)
- [dependency-analysis.md](./dependency-analysis.md) — анализ зависимостей между фазами
- [positioning.md](./positioning.md) — позиционирование Phase 3 на рынке

## План (14 задач, 7-10 дней)

```
A1-A5: Foundation         (параллельно)
  ↓
B1-B3: Aggregation        (собирает Foundation)
  ↓
C1-C2: Loop & Tools       (автофикс + memory tools)
  ↓
D1-D3: Integration        (extractor, TUI progress, agent loop)
  ↓
E1:    E2E Tests
```
