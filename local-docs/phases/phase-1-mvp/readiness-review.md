# Phase 1 MVP — Readiness Review

**Версия:** SOBA 0.2.0
**Дата проверки:** 2026-06-14

## Решение

Phase 1 функционально готова. До объявления MVP полностью закрытым остаются ручной end-to-end smoke test
и проверка standalone binary на втором Mac.

## Use Cases

| Use Case | Статус |
|---|---|
| UC-1 First-time setup | Реализован |
| UC-2 One-shot задача | Реализован |
| UC-3 Интерактивный OpenTUI | Реализован |
| UC-4 Продолжение сессии | Реализован |
| UC-5 Ручная компакция | Реализован |
| UC-6 Rewind/branch | Реализован |
| UC-7 Trust | Реализован |
| UC-8 Budget | Реализован |
| UC-9 I18n | Реализован |
| UC-10 Очередь сообщений | Реализован |
| UC-11 Scoped permissions | Реализован |
| UC-12 Direct shell shortcuts | Реализован |

## Пользовательская поверхность

- 5 tools: `read`, `write`, `edit`, `bash`, `ls`.
- Streaming OpenTUI с markdown, themes, history, suggestions и полным transcript copy.
- FIFO queue с `/queue`, редактированием и отменой.
- Permission scopes: once, session, repo; `/permissions`.
- `!command` с выводом и `!!command` без stdout/stderr.
- `Ctrl+C` останавливает active tool или отменяет active turn; выход через `/exit`/`/quit`.
- Standalone binary build, включая macOS Apple Silicon target.

## Подтверждённые ограничения

- Repo permission mode не является OS sandbox.
- Provider-specific поведение должно проверяться на реальных моделях.
- Ручные test-run документы пока требуют заполнения результатами.

## Release gate

- [x] Design/use cases/plan отражают текущую реализацию
- [x] Документированы queue, permissions, process stop, binary и direct shell
- [ ] Полный manual smoke test заполнен
- [ ] Binary проверен на отдельном Apple Silicon Mac
