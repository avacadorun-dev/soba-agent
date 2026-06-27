# SOBA OpenTUI — актуальный дизайн

**Версия:** SOBA 0.2.0
**Фреймворк:** `@opentui/solid` + SolidJS

## Layout

- Header: SOBA, model, context window, tool count.
- Sidebar: project tree, session usage, permission mode, tools, queue, git changes.
- Message list: user, assistant markdown, thinking, tool lifecycle, info/warning/error.
- Input bar: multiline input, history, slash/file suggestions, confirmation mode.
- Status bar: agent/process state, navigation and clipboard hints.

## Input routing

| Input | Поведение |
|---|---|
| обычный текст | запускает model turn или попадает в FIFO queue |
| `/command` | выполняется сразу локально |
| `!command` | запускает `bash` напрямую и показывает stdout/stderr |
| `!!command` | запускает `bash` напрямую, скрывая stdout/stderr |
| approval answer | разрешает/отклоняет ожидающую dangerous operation |

## Keyboard

- `Enter`: submit.
- `Shift+Enter`: newline.
- `Ctrl+C`: остановить active tool; иначе отменить active turn.
- `Ctrl+Y`: копировать последний ответ ассистента.
- `Cmd+C` / `Ctrl+Shift+C`: копировать terminal selection.
- `Ctrl+L`: очистить ленту.
- `Up` / `Down`: history или suggestions.
- `PgUp` / `PgDn`, `Home` / `End`: scroll.

Выход выполняется через `/exit` или `/quit`.

## Themes

Доступны `graphite`, `ember`, `aurora`, `synthwave`, `paper`, `forest`. Тема выбирается через config,
`--theme` или `/theme`.

## Process lifecycle

Agent tool calls и direct shell используют abortable execution. Остановка процесса не завершает приложение.
После завершения текущей работы `TuiStore` запускает следующий typed queue item.
