# Index — Регресс-кейсы SOBA Agent v0.4.0

## Структура

| #  | Раздел | Файл | Темы |
|----|--------|------|------|
| 1 | Установка и сборка | `01-installation-build.md` | bun install, build, test, lint, binary |
| 2 | CLI-флаги и аргументы | `02-cli-flags.md` | Все флаги, комбинации, короткие/длинные |
| 3 | Конфигурация | `03-configuration.md` | config.json, env, priority, wizard |
| 4 | One-shot режим | `04-one-shot.md` | Базовый вызов, tool calls |
| 5 | TUI — базовая функциональность | `05-tui-basic.md` | Запуск, отправка, transcript, /clear, /exit |
| 6 | TUI — горячие клавиши | `06-tui-hotkeys.md` | Стрелки, @, Tab, копирование |
| 7 | TUI — shell-команды | `07-tui-shell-commands.md` | ! и !!, dangerous, pipes |
| 8 | TUI — очередь сообщений | `08-tui-queue.md` | /queue, cancel, edit |
| 9 | TUI — смена модели, языка, темы | `09-tui-switching.md` | Ctrl+M (ModelSelector), /lang, /theme |
| 10 | TUI — slash-команды | `10-tui-slash-commands.md` | Все команды, их аргументы |
| 11 | Инструменты агента (tools) | `11-agent-tools.md` | ls, read, write, edit, bash, checkpoint, activate_skill |
| 12 | Agent Loop | `12-agent-loop.md` | Multi-step, iteration limits, stall |
| 13 | Сессии | `13-sessions.md` | JSONL, continue, resume |
| 14 | Дерево сессии и ветвление | `14-session-tree.md` | parentId, branching |
| 15 | Checkpoints | `15-checkpoints.md` | Создание, структура в JSONL |
| 16 | Rewind | `16-rewind.md` | Переключение, ветки |
| 17 | Compaction и Context Capsules | `17-compaction-capsules.md` | Proactive, hard-limit, portable state |
| 18 | Context Manager и Context Meter | `18-context-manager-meter.md` | Token counting, limits |
| 19 | Background Scheduler | `19-background-scheduler.md` | Background compaction |
| 20 | Skills — bundled | `20-skills-bundled.md` | 4 bundled skills |
| 21 | Skills — user и project | `21-skills-user-and-project.md` | Установка, trust |
| 22 | Skills — draft, eval, promote | `22-skills-draft-eval-promote.md` | Жизненный цикл |
| 23 | Skills — discovery, trust, catalog | `23-skills-discovery-trust-catalog.md` | Обнаружение, progressive disclosure |
| 24 | Skills — workflow observer | `24-skills-workflow-observer.md` | Наблюдение, v0.3 limitation |
| 25 | Trust Manager | `25-trust-manager.md` | Разрешения, dangerous, y/n/s/r |
| 26 | Project Trust | `26-project-trust.md` | approve/revoke, persist |
| 27 | OpenResponses и middleware | `27-openresponses-middleware.md` | Client, typed items, провайдеры |
| 28 | i18n | `28-i18n.md` | ru, en, zh, fallback |
| 29 | Темы | `29-themes.md` | 6 тем, переключение |
| 30 | Budget и лимиты | `30-budget-limits.md` | Token budget, iteration limits, timeout |
| 31 | Системный промпт | `31-system-prompt.md` | Инъекция capsule, skill, языка |
| 32 | Completion Gate | `32-completion-gate.md` | Stop reason, неполные ответы |
| 33 | Loop Guard | `33-loop-guard.md` | Stalled detection, recovery |
| 34 | Endurance | `34-endurance.md` | Длительные сессии, утечки памяти |
| 35 | Edge Cases | `35-edge-cases.md` | Нет сети, повреждённые файлы, race |
| 36 | API и интеграция | `36-api-integration.md` | OpenResponses, compliance |
| 37 | Project Memory | `37-project-memory.md` | Knowledge store, entity graph, memory injector, memory tools, cross-session recall |
| 38 | MCP Client | `38-mcp-client.md` | MCP config, stdio transport, JSON-RPC, tool proxy, ToolRegistry, AgentLoop |

## Статистика

- Всего файлов: **38**
- Всего кейсов: **~690+**
- Каждый кейс содержит: шаги, ожидаемый результат, критерий PASS
- Формат: Markdown, пригодный для ручного и автоматического выполнения

## Использование

1. **Ручное тестирование**: открыть файл, выполнить шаги, отметить PASS/FAIL
2. **Автоматизация**: скрипты могут парсить шаги и критерии для создания e2e-тестов
3. **Регрессионный прогон**: после изменений — пройти по разделам, затронутым изменениями
4. **Багрепортинг**: указать номер раздела + кейса в описании

## Приоритеты (по критичности)

1. **Критично** (без этого продукт не работает): 01, 02, 03, 04, 05, 11, 12, 13, 27, 37, 38
2. **Высоко** (ключевой UX): 06, 07, 08, 09, 10, 25, 28, 29, 30, 31
3. **Средне** (фичи): 14, 15, 16, 17, 18, 19, 20, 21, 22, 23
4. **Низко** (углублённые): 24, 26, 32, 33, 34, 35, 36
