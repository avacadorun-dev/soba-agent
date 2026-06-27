# Phase 2.5 — План реализации (актуальный)

**Дата:** 2026-06-17  
**Всего задач:** 10 актуальных  
**Реализовано:** 10 задач (A1, A2, A3, A4, B1a, B1c, B1d, B2, B3, B4) — 100%  
**Исключено:** 4 задачи (B1b, B5, C1, C2 — перекрыты другими подходами или не нужны)

> **Ключевое:** Все задачи Phase 2.5 — UI/UX. Ни одна не модифицирует agent-loop.ts,
> system-prompt.ts, compaction.ts или другие core-файлы. Core остаётся нетронутым.

---

## Статус задач

| # | Задача | Статус |
|---|--------|--------|
| A1 | ProviderRegistry + ClientProxy | ✅ Готово |
| A2 | NotificationSystem | ✅ Готово |
| A3 | TrustDialog | ✅ Готово |
| A4 | Slash Commands Registry | ✅ Готово |
| B1a | ModelSelector UI + provider-store | ✅ Готово |
| B1c | `soba provider` CLI | ✅ Готово |
| ~~B1b~~ | ~~/model slash subcommands~~ | ❌ Исключено — не нужно |
| ~~B5~~ | ~~Hotkeys Help Overlay~~ | ❌ Исключено — уже есть HelpMode в сайдбаре |
| ~~C1~~ | ~~Enhanced Sidebar~~ | ❌ Исключено — другой подход уже реализован |
| B1d | test-connection notification + theme styling | ✅ Готово |
| B2 | Collapsible Tool Results | ✅ Готово |
| B3 | Turn Separator | ✅ Готово |
| B4 | Search Overlay | ✅ Готово |
| ~~C2~~ | ~~Session Browser~~ | ❌ Исключено — бесполезная фича, откачена |

---

## Порядок выполнения (актуальный)

```
(все задачи выполнены — фаза закрыта)
```

---

## Что реализовано (сводка)

### B1d: Test Connection Notification + Theme Styling

**Файлы:**
- `src/widgets/tui/model/provider-store.ts` — fire-and-forget testConnection → NotificationStore
- `src/widgets/tui/ui/notification-item.tsx` — theme-aware colors (success/error/warning/info из TuiTheme)
- `src/widgets/tui/ui/notification-center.tsx` — themeName проп + backgroundColor из темы
- `src/widgets/tui/ui/tui-app.tsx` — проброшен themeName в NotificationCenter
- `tests/widgets/tui/b1d-test-connection.test.ts` — 7 тестов
- i18n: `tui.modelSelector.connectionTest/Success/Failed` в en/ru/zh

### B2: Collapsible Tool Results

**Файлы:**
- `src/widgets/tui/ui/tool-result-block.tsx` — summary header (icon, lines, bytes, duration) + collapsible body + diff-подсветка
- `src/widgets/tui/ui/message-list.tsx` — ExpandedIds сигнал, Enter toggle, Tab/Shift+Tab фокус, error auto-expand
- `tests/widgets/tui/collapsible-results.test.ts` — 10 тестов

### B3: Turn Separator

**Файлы:**
- `src/widgets/tui/ui/turn-separator.tsx` — "───── Turn N ─────" с чередованием primary/secondary и коллапсом
- `src/widgets/tui/lib/turn-grouping.ts` — computeTurnStarts, computeTurnMap, isTurnStart
- `src/widgets/tui/ui/message-list.tsx` — collapsedTurns сигнал, интеграция TurnSeparator
- `tests/widgets/tui/turn-separator.test.ts` — 17 тестов

---

### B4: Search Overlay

**Файлы:**
- `src/widgets/tui/lib/search-engine.ts` — O(n) case-insensitive search с позициями совпадений и preview
- `src/widgets/tui/ui/search-overlay.tsx` — оверлей с textarea, ↑↓ навигацией, Enter→jump, Esc→close
- `src/widgets/tui/commands/search-command.ts` — /search slash-команда
- `src/widgets/tui/model/tui-store.ts` — isSearchOpen/highlightedMessageIndex сигналы, openSearch/closeSearch/jumpToMessage
- `src/widgets/tui/hooks/use-tui-keys.ts` — Ctrl+F handler
- `src/widgets/tui/ui/tui-app.tsx` — SearchOverlay интеграция
- `src/widgets/tui/ui/message-list.tsx` — flash-подсветка сообщений (2s auto-clear)
- `tests/widgets/tui/search.test.ts` — 26 тестов
- i18n: `tui.search.title/placeholder/empty/hint` в en/ru/zh

---

### A1: ProviderRegistry + OpenResponsesClientProxy

**Файлы:**
- `src/core/provider/registry.ts` — ProviderRegistry
- `src/core/provider/providers.ts` — 4 built-in (deepseek, kimi, alibaba, openrouter)
- `src/core/provider/client-proxy.ts` — OpenResponsesClientProxy
- `src/core/provider/discovery.ts` — runtime model discovery через GET /v1/models
- `src/core/provider/types.ts` — ProviderDefinition, ModelDefinition, TestResult
- `tests/core/provider/registry.test.ts`, `client-proxy.test.ts`, `providers.test.ts`

### A2: NotificationSystem

**Файлы:**
- `src/widgets/tui/model/notification-store.ts` — Solid store (212 строк)
- `src/widgets/tui/ui/notification-center.tsx` — контейнер в правом нижнем углу
- `src/widgets/tui/ui/notification-item.tsx` — одно уведомление с иконкой
- `src/widgets/tui/lib/notification.ts` — публичный API (notify, dismiss)
- `src/widgets/tui/commands/notification-command.ts` — /notifications, /clear
- `tests/widgets/notification.test.ts` — 323 строки тестов

### A3: TrustDialog

**Файлы:**
- `src/widgets/tui/ui/trust-dialog.tsx` — inline диалог (155 строк)
- `src/widgets/tui/lib/trust-dialog-manager.ts` — Tab-навигация, y/s/r/n (130 строк)
- `tests/widgets/trust-dialog.test.ts` — 433 строки тестов

### A4: Slash Commands Registry

**Файлы:**
- `src/widgets/tui/commands/types.ts` — SlashCommand, SlashCommandContext
- `src/widgets/tui/commands/registry.ts` — register, get, dispatch, getSuggestions
- `tests/widgets/commands/registry.test.ts` — 354 строки тестов
- Интеграция в `tui-store.ts` — диспатч через slashCommandRegistry

### B1a: ModelSelector UI + provider-store

**Файлы:**
- `src/widgets/tui/model/provider-store.ts` — Solid store c signals, computed groups
- `src/widgets/tui/ui/model-selector.tsx` — overlay с поиском, группировкой, ↑↓ Enter Esc
- `src/widgets/tui/hooks/use-tui-keys.ts` — Ctrl+M toggle
- `tests/widgets/tui/provider-store.test.ts`

### B1c: `soba provider` CLI

**Файлы:**
- `src/cli/provider-cli.ts` — list, add, remove, show, use
- `tests/cli/provider-cli.test.ts` — 37 тестов
- i18n: 30+ ключей в en/ru/zh

---

## Критерии завершения Phase 2.5

### Provider & Model
1. ✅ ProviderRegistry: 4 встроенных провайдера, switchModel, testConnection
2. ✅ OpenResponsesClientProxy интегрирован в AgentLoop
3. ✅ ModelSelector: overlay с группировкой, поиском, выбором
4. ✅ `soba provider` CLI: add/list/remove/show/use
5. ✅ test-connection notification: success/error из NotificationStore (B1d)

### TUI Components
6. ✅ Notification Center: появление, автозакрытие, история, /notifications, /clear, theme-aware colors
7. ✅ Trust Dialog: Tab-навигация, Escape, y/s/r/n обратная совместимость
8. ✅ Slash Commands Registry: register, dispatch, autocomplete suggestions
9. ✅ Tool Results: сворачиваются/разворачиваются, error auto-expand, diff-подсветка (B2)
10. ✅ Turn Separator: чередующийся цвет primary/secondary, коллапс turns (B3)
11. ✅ Search Overlay: Ctrl+F, textarea, ↑↓ навигация, Enter→jump, Esc→close, flash-подсветка (B4)
12. ❌ Session Browser: исключена (C2)

### Quality Gates
13. ✅ `bun test` — 1207 pass, 0 fail
14. ✅ `biome check .` — 0 errors
15. ✅ `bunx tsc --noEmit` — 0 errors

---

## Performance Targets

Из [design.md §Производительность](./design.md):

| Метрика | Target | Допуск | Как измерять |
|---|---|---|---|
| Notification latency | < 5ms от события до рендера | +10ms | `console.time` вокруг `notify()` → solid render cycle |
| Model switch time | < 2s (включая test) | +1s на ошибку | `Date.now()` в `ProviderStore.select()` |
| Search response time | < 100ms для 1000 сообщений | +50ms | benchmark в `tests/widgets/search.test.ts` (B4) |
| Trust dialog render | < 5ms | +5ms | `console.time` в тесте рендера |
| Tool result render | < 10ms для 500 строк | +10ms | benchmark в `tests/widgets/tui/collapsible-results.test.ts` (B2) |
| Turn separator calc | < 1ms для 1000 сообщений | +1ms | benchmark в `tests/widgets/tui/turn-separator.test.ts` (B3) |
