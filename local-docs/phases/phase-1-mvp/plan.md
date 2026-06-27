# Фаза 1 — MVP: статус реализации

**Версия:** SOBA 0.2.0
**Статус:** функциональность реализована; требуется ручной end-to-end smoke test.

## Реализованные блоки

| Блок | Статус | Основные артефакты |
|---|---|---|
| Project setup | Готово | Bun, strict TypeScript, Biome, build scripts |
| System prompt | Готово | `SYSTEM.md`, `src/core/prompt/` |
| Config и setup | Готово | config file, env и CLI overrides, first-time setup |
| I18n | Готово | en/ru/zh, runtime `/lang` |
| Sessions | Готово | append-only JSONL, continue, rewind, branching |
| OpenResponses client | Готово | typed client, OpenAI-compatible middleware, streaming |
| Core tools | Готово | `read`, `write`, `edit`, `bash`, `ls` |
| Agent loop | Готово | tool loop, finish gate, recovery, loop guard, cancel |
| Compaction | Готово | manual `/compact`, effective context accounting |
| OpenTUI | Готово | streaming messages, themes, history, suggestions, clipboard |
| Trust и budget | Готово | scoped approvals, repo mode, token budget |
| Distribution | Готово | standalone binary build, macOS Apple Silicon target |

## Дополнения, вошедшие в Phase 1

- Исправлено восстановление после reasoning-only ответов и сохранение streamed tool calls.
- Полная лента сообщений копируется через terminal selection/OSC 52.
- `Ctrl+C` останавливает активный tool; без активного tool отменяет turn.
- Пользовательские сообщения во время работы попадают в редактируемую FIFO-очередь.
- Permission scopes: once, session и conservative full repo access.
- `!command` выполняет shell-команду напрямую с выводом.
- `!!command` выполняет shell-команду напрямую без stdout/stderr.

## Критерии закрытия

- [x] `bun test`
- [x] `bun run lint`
- [x] `bun run build`
- [x] Standalone binary workflow задокументирован
- [ ] Заполнить `manual-smoke-test.md` на реальной модели
- [ ] Прогнать standalone binary на втором Apple Silicon Mac

## Следующая фаза

После ручного smoke test Phase 1 замораживается как MVP baseline. Новые visual-layer, skills и proactive
context-management возможности планируются отдельно, чтобы не размывать критерии готовности MVP.
