# Фаза 1 — MVP: актуальный дизайн

**Версия:** SOBA 0.2.0
**Runtime:** Bun
**UI:** OpenTUI/SolidJS

## Цели

Phase 1 предоставляет рабочий CLI coding agent с OpenResponses-контрактом, OpenAI-compatible middleware,
сессиями, инструментами, компакцией, безопасным выполнением команд и интерактивным TUI.

## Архитектура

```text
CLI / OpenTUI
    |
    v
AgentLoop ---- TrustManager / BudgetTracker
    |
    +---- SessionManager (append-only JSONL)
    +---- ToolRegistry (read, write, edit, bash, ls)
    +---- OpenResponsesClient
              |
              v
        OpenAI-compatible adapter
```

### Границы модулей

| Модуль | Ответственность |
|---|---|
| `src/cli.ts`, `src/cli/` | аргументы, setup, print mode, slash-команды |
| `src/widgets/tui/` | интерактивный OpenTUI/SolidJS интерфейс |
| `src/core/loop/` | автономный turn, tool calls, recovery, completion gate |
| `src/core/client/` | typed OpenResponses API |
| `src/core/middleware/` | адаптация OpenResponses к OpenAI-compatible API |
| `src/core/session/` | JSONL-сессии, branch, rewind, effective input |
| `src/core/tools/` | инструменты файловой системы и shell |
| `src/core/trust/` | классификация операций и permission scopes |
| `src/core/compaction/` | ручная компакция контекста |
| `src/core/i18n/` | en/ru/zh интерфейс |

## Agent loop

1. Пользовательский текст сохраняется как typed user item.
2. SessionManager строит effective input.
3. OpenResponsesClient отправляет streaming или non-streaming запрос.
4. Ответы и tool calls сохраняются в сессии.
5. Tools выполняются с отдельным abort controller.
6. Completion gate требует проверки после мутаций и отслеживает active errors.
7. Loop guard восстанавливает reasoning-only/no-progress ответы и останавливает зацикливание.

Direct shell shortcuts (`!`/`!!`) обходят модель и session history, но используют зарегистрированный `bash`
tool и тот же механизм остановки процесса.

## TUI state

`TuiStore` связывает AgentLoop events и SolidJS UI. Он хранит visible messages, streaming assistant message,
status, confirmation, token usage, git changes, permission mode и typed FIFO queue.

Очередь содержит три вида элементов:

- `message` — следующий model turn;
- `shell` — прямая команда с выводом;
- `shell-silent` — прямая команда без stdout/stderr.

## Permissions

- `once`: разрешить одну операцию;
- `session`: запомнить точную операцию до завершения процесса;
- `repo`: разрешить repo-scoped операции.

Repo mode остаётся консервативным: сеть, privilege escalation, абсолютные/родительские пути, device writes и
`git push` продолжают требовать подтверждения. Прямые `!`/`!!` команды являются явным вводом пользователя и
не требуют повторного approval.

## Sessions

Сессия хранится append-only в JSONL. Entries имеют `id`/`parentId`, поэтому rewind создаёт новую ветку без
удаления истории. `buildInput()` возвращает effective branch с учётом compaction.

## Distribution

`bun run build` создаёт JS bundle. `bun run build:binary` создаёт standalone binary; основной целевой артефакт
Phase 1 — `bun-darwin-arm64` для Apple Silicon.
