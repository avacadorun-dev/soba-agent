# Регресс-прогон: Сводный отчёт

**Дата:** 2026-06-15
**Версия:** soba v0.3.2
**Модель:** deepseek-v4-flash (API: DeepSeek)
**Окружение:** macOS arm64, Bun 1.3.10
**Тип:** Автоматический (regression-runner skill)

---

## Общая статистика

| Метрика | Значение |
|---------|----------|
| Всего файлов | 36 |
| **PASS** | **~217** кейсов (CLI + CLI-тесты + unit-тесты) |
| **FAIL** | **3** кейса (см. раздел FAIL ниже) |
| **SKIP_TUI** | **0** ✅ (все TUI-кейсы PASS или SKIP_MANUAL) |
| **SKIP_MANUAL** | **32** кейса (см. раздел «Ручной прогон» ниже) |
| Unit-тестов пройдено | **878** |
| Unit-тестов провалено | **0** |
| Mock API-сервер | `tests/mocks/api-server.ts` (Bun.serve, порт 8080) |

---

## Детализация по файлам

| # | Файл | Результат |
|---|------|-----------|
| 01 | installation-build.md | 9 PASS, 3 SKIP_MANUAL |
| 02 | cli-flags.md | 31 PASS, 4 SKIP_TUI→MANUAL, 4 SKIP_MANUAL, **3 FAIL** |
| 03 | configuration.md | 10 PASS, 1 SKIP_TUI→MANUAL, 8 SKIP_MANUAL |
| 04 | one-shot.md | 12 PASS, 2 SKIP_MANUAL |
| 05 | tui-basic.md | 20 PASS (TuiStore + CLI integration), 3 SKIP_MANUAL |
| 06 | tui-hotkeys.md | 3 PASS (TuiStore + input-suggestions), 6 SKIP_MANUAL |
| 07 | tui-shell-commands.md | 9 PASS (OpenTUI store) |
| 08 | tui-queue.md | 8 PASS (OpenTUI store) |
| 09 | tui-switching.md | 12 PASS (unit-tests), 3 SKIP_MANUAL |
| 10 | tui-slash-commands.md | 25 PASS (TuiStore + OpenTUI store) |
| 11 | agent-tools.md | Unit-tests PASS |
| 12 | agent-loop.md | Unit-tests PASS |
| 13 | sessions.md | Unit-tests PASS |
| 14 | session-tree.md | Unit-tests PASS |
| 15 | checkpoints.md | Unit-tests PASS |
| 16 | rewind.md | Unit-tests PASS |
| 17 | compaction-capsules.md | 116 unit-tests PASS |
| 18 | context-manager-meter.md | Unit-tests PASS |
| 19 | background-scheduler.md | Unit-tests PASS |
| 20 | skills-bundled.md | 162 unit-tests PASS |
| 21 | skills-user-and-project.md | Unit-tests PASS |
| 22 | skills-draft-eval-promote.md | Unit-tests PASS |
| 23 | skills-discovery-trust-catalog.md | Unit-tests PASS |
| 24 | skills-workflow-observer.md | PASS |
| 25 | trust-manager.md | Unit-tests PASS |
| 26 | project-trust.md | Unit-tests PASS |
| 27 | openresponses-middleware.md | Unit-tests PASS |
| 28 | i18n.md | 37 unit-tests PASS |
| 29 | themes.md | Unit-tests PASS |
| 30 | budget-limits.md | Unit-tests PASS |
| 31 | system-prompt.md | Unit-tests PASS |
| 32 | completion-gate.md | Unit-tests PASS |
| 33 | loop-guard.md | Unit-tests PASS |
| 34 | endurance.md | 15 unit-tests PASS |
| 35 | edge-cases.md | Unit-tests PASS |
| 36 | api-integration.md | Unit-tests PASS |

---

## Ручной прогон: 32 SKIP_MANUAL + 3 FAIL

Ниже — все кейсы, которые **не автоматизированы** и требуют ручного запуска.

Отметь результат в каждой строке и верни заполненную таблицу.

---

### 🔴 Баги (FAIL) — 3 шт

Проверь, что баги всё ещё воспроизводятся:

| # | Кейс | Команда | Ожидание | Реальность |
|---|------|---------|----------|------------|
| F1 | `--no-color` оставляет ANSI | `bun run dist/cli.js --no-color "Say ok" \| cat -v \| head -3` | нет `^[` последовательностей | ✅ починен |
| F2 | `--context-window 32000` → fatal | `bun run dist/cli.js --context-window 32000 --no-session "Say ok"` | graceful error или success | ✅ починен |
| F3 | `--foobar` не вызывает ошибку | `bun run dist/cli.js --foobar` | error: unknown flag | ✅ починен |

---

### 🧰 Установка / конфигурация — 14 шт

| # | Кейс | Шаги | Ожидание | Результат |
|---|------|------|----------|-----------|
| M01 | 01/09: First-time wizard | `rm -rf ~/.soba && bun run dist/cli.js` | интерактивный wizard с выбором модели/api key | ☐ PASS / ☐ FAIL |
| M02 | 01/11: Офлайн-установка | `bun install --offline` | установка без интернета (зависимости в кеше) | ☐ PASS / ☐ FAIL |
| M03 | 01/12: Изменённый package.json | изменить package.json, `bun install` | установка с изменёнными зависимостями | ☐ PASS / ☐ FAIL |
| M04 | 03/01: First-time wizard (полный ввод) | удалить ~/.soba, запустить, ввести все данные | конфиг создаётся, CLI работает | ☐ PASS / ☐ FAIL |
| M05 | 03/02: First-time wizard (отказ) | удалить ~/.soba, запустить, отказаться | graceful fallback, не падает | ☐ PASS / ☐ FAIL |
| M06 | 03/03: First-time wizard (Ctrl+C) | удалить ~/.soba, запустить, Ctrl+C | graceful shutdown, нет мусора | ☐ PASS / ☐ FAIL |
| M07 | 03/16-18: Приоритет CLI > env > config | выставить --model в CLI, MODEL в env, model в config | CLI побеждает env, env побеждает config | ☐ PASS / ☐ FAIL |
| M08 | 03/20: Нет config, нет env | удалить ~/.soba, unset переменные | все defaults, не падает | ☐ PASS / ☐ FAIL |
| M09 | 03/21: `--config` флаг | `bun run dist/cli.js --config /tmp/test-config.json --help` | читает кастомный конфиг | ☐ PASS / ☐ FAIL |
| M10 | 03/22: Директория `~/.soba/` отсутствует | `mv ~/.soba ~/.soba.bak && bun run dist/cli.js --help` | создаёт директорию, не падает | ☐ PASS / ☐ FAIL |
| M11 | 02/17: `--max-completion-tokens` | `bun run dist/cli.js --max-completion-tokens 1 "reason step by step" --no-session` | ответ обрезается до ~1 токена | ☐ PASS / ☐ FAIL |
| M12 | 02/20: `--budget 1000` | `bun run dist/cli.js --budget 1000 --no-session "Write a long story"` | агент останавливается по бюджету | ☐ PASS / ☐ FAIL |
| M13 | 02/25: `--max-stalled-iterations 2` | `bun run dist/cli.js --max-stalled-iterations 2 --no-session --max-agent-iterations 10 "loop"` | останавливается после 2 stalled | ☐ PASS / ☐ FAIL |
| M14 | 02/27: `--max-run-minutes 0.1` | `bun run dist/cli.js --max-run-minutes 0.1 --no-session "complex task"` | останавливается через ~6 секунд | ☐ PASS / ☐ FAIL |

---

### 🎮 TUI — горячие клавиши — 6 шт

Запусти: `bun run dist/cli.js -i`

| # | Кейс | Шаги | Ожидание | Результат |
|---|------|------|----------|-----------|
| M15 | 05/04: Ctrl+C во время ответа | отправить промпт, пока модель отвечает → Ctrl+C | генерация прерывается, TUI жив | ☐ PASS / ☐ FAIL |
| M16 | 06/04: Ctrl+W — удалить слово | ввести "test command" → Ctrl+W | удаляется "command", остаётся "test " | ☐ PASS / ☐ FAIL |
| M17 | 06/05: Ctrl+U — очистить строку | ввести длинный текст → Ctrl+U | строка очищается | ☐ PASS / ☐ FAIL |
| M18 | 06/06: Page Up/Down — скролл | накопить много сообщений → PgUp/PgDn | скролл transcript вверх/вниз | ☐ PASS / ☐ FAIL |
| M19 | 06/07: Home/End | ввести длинную строку → Home/End | курсор в начало/конец | ☐ PASS / ☐ FAIL |
| M20 | 06/08: Ins — режим вставки | ввести текст → Ins → ввести ещё | overwrite/replace режим | ☐ PASS / ☐ FAIL |
| M21 | 06/09: Alt+Enter — многострочный ввод | Alt+Enter → ввести несколько строк → Enter | многострочный промпт отправляется | ☐ PASS / ☐ FAIL |

---

### 🖥 TUI — визуальные проверки — 5 шт

| # | Кейс | Шаги | Ожидание | Результат |
|---|------|------|----------|-----------|
| M22 | 05/16: Resize терминала | запустить TUI, изменить размер окна | UI перерисовывается, не ломается | ☐ PASS / ☐ FAIL |
| M23 | 05/17: Узкий терминал (< 40 колонок) | запустить TUI в окне 30 колонок | UI не ломается, элементы переносятся | ☐ PASS / ☐ FAIL |
| M24 | 09/12: Status bar при /lang | в TUI: `/lang ru` | статус-бар показывает русский | ☐ PASS / ☐ FAIL |
| M25 | 09/13: Status bar при /theme | в TUI: `/theme ember` | статус-бар меняет цвета | ☐ PASS / ☐ FAIL |
| M26 | 09/14: Status bar при /model | в TUI: `/model gpt4` | статус-бар показывает новую модель | ☐ PASS / ☐ FAIL |

---

### 🚀 One-shot — 2 шт

| # | Кейс | Шаги | Ожидание | Результат |
|---|------|------|----------|-----------|
| M27 | 04/09: One-shot с --budget 100 | `bun run dist/cli.js --budget 100 --no-session "Write a long article"` | агент останавливается по бюджету | ☐ PASS / ☐ FAIL |
| M28 | 04/11: One-shot с активацией skill | `bun run dist/cli.js --no-session "Activate git-summary skill and summarize"` | skill загружается и выполняется | ☐ PASS / ☐ FAIL |

---

### 🧪 Edge cases — 3 шт

| # | Кейс | Шаги | Ожидание | Результат |
|---|------|------|----------|-----------|
| M29 | 35/02: Специфическое окружение | см. `tests/core/edge-cases.md` | зависит от кейса | ☐ PASS / ☐ FAIL |
| M30 | 35/03: Специфическое окружение | см. `tests/core/edge-cases.md` | зависит от кейса | ☐ PASS / ☐ FAIL |
| M31 | 35/04-05,11,13,16: Edge cases | см. `tests/core/edge-cases.md` | зависит от кейса | ☐ PASS / ☐ FAIL |

---

## TUI-покрытие (программное, 79 тестов)

Все TUI-кейсы кроме SKIP_MANUAL протестированы без TTY:

| Файл | Что тестирует |
|------|---------------|
| `tests/tui.test.ts` | Colors, Theme, StatusBar, Spinner, ToolDetails, PrintRenderer |
| `tests/tui-slash-commands.test.ts` | TuiStore: /help, /session, /budget, /exit |
| `tests/tui-pty.test.ts` | CLI integration + TuiStore расширенные: /compact, /clear, /rewind, /capsule, /skill, /project-trust, history, unicode, empty input, граничные |
| `tests/widgets/` | OpenTUI Solid store: streaming, очередь, shell, cancel, /theme, /lang, git, input suggestions |

| Статус | Количество |
|--------|-----------|
| Автоматизировано (PASS) | **~217** кейсов |
| Ручной прогон (SKIP_MANUAL) | **32** кейса (см. таблицы выше) |
| Баги (FAIL) | **3** (см. ниже) |

---

## Mock API-сервер

В проекте есть `tests/mocks/api-server.ts` — легковесный HTTP-сервер на Bun.serve:

```typescript
const mock = new MockApiServer({ port: 8080 });
await mock.start();  // → http://localhost:8080
// POST /v1/responses → 200 { "choices": [{ "message": { "content": "Mock API response" } }] }
// GET /v1/models → 200 { "data": [{"id": "mock-model"}] }
mock.stop();
```

Также есть:
- `error-server.ts` — возвращает 500/4xx ошибки
- `rate-limit-server.ts` — 429 Too Many Requests
- `slow-server.ts` — задержка ответа
- `content-filter.ts` — фильтр контента

Может использоваться для полноценной интеграционной проверки API без реального провайдера.

---

## Найденные баги (FAIL)

### 🔴 Баг #1: `--no-color` не отключает все ANSI-коды
- **Файл:** 02-cli-flags.md, кейс 11
- **Симптом:** При `cat -v` видны `^[[1m` и `^[[0m` — ANSI escape-последовательности
- **Приоритет:** Средний
- **Воспроизведение:** `bun run dist/cli.js --no-color "Say ok" | cat -v | head -3`
- **Исправлено:** `src/tui/colors.ts` — `bold()/dim()/italic()` теперь проверяют `isColorDisabled()`

### 🔴 Баг #2: `--context-window 32000` вызывает fatal error
- **Файл:** 02-cli-flags.md, кейс 18
- **Симптом:** `Fatal error: Invalid compaction config: keepRecentTokens must be < hardLimit`
- **Приоритет:** Высокий
- **Работает при:** contextWindow >= 64000
- **Воспроизведение:** `bun run dist/cli.js --context-window 32000 --no-session "Say ok"`
- **Исправлено:** `src/core/config/config-loader.ts` — `resolveCompactionConfig()` авто-адаптирует `keepRecentTokens` под `hardLimit` вместо throw

### 🔴 Баг #3: Неизвестный флаг `--foobar` не вызывает ошибку
- **Файл:** 02-cli-flags.md, кейс 39
- **Симптом:** `--foobar` молча игнорируется, выводится welcome message
- **Приоритет:** Средний
- **Воспроизведение:** `bun run dist/cli.js --foobar`
- **Исправлено:** `src/cli/args.ts` — `parseArgs()` теперь выводит ошибку для неизвестных флагов и завершается с exit code 1

---

## Статус исправлений

| Баг | Статус | Приоритет |
|-----|--------|-----------|
| `--no-color` не отключает все ANSI | ✅ Исправлен | Средний |
| `--context-window 32000` → fatal | ✅ Исправлен | **Высокий** |
| `--foobar` молча игнорируется | ✅ Исправлен | Средний |

---

## Методология

Прогон выполнен в 3 этапа:

1. **Unit-тесты** — `bun test` (878 тестов, 50 файлов, 0 fail)
2. **CLI-тесты** — реальный запуск `bun run dist/cli.js` с флагами через API (16 тестов в `tests/tui-pty.test.ts`)
3. **TUI-тесты** — TuiStore + OpenTUI Solid store с mock executeCommand (TuiStore: slash-команды, история, граничные случаи; OpenTUI: streaming, shell, cancel, темы)

### Распределение SKIP_MANUAL

| Категория | Кол-во | Причина |
|-----------|--------|--------|
| Установка/конфигурация | 14 | Требуют манипуляции с ~/.soba, env, сетью |
| TUI горячие клавиши | 6 | Требуют реального TTY (Ctrl+W/U, PgUp/Dn, Home/End, Ins, Alt+Enter) |
| TUI визуальные | 5 | Требуют реального терминала (resize, узкий экран, status bar) |
| One-shot | 2 | Требуют длительного выполнения / активации skill |
| Edge cases | 3 | Требуют специфического окружения |
| **Баги (FAIL)** | **3** | Воспроизводятся в CLI (см. таблицу FAIL) |

### Инструкция по ручному прогону

1. Сверху в этой секции — 3 таблицы багов для проверки
2. После — 31 кейс SKIP_MANUAL с командами
3. Прогоняй по порядку, заполняй колонку «Результат»
4. Если нашёл новый баг — добавь в таблицу FAIL и отметь в кейсе
5. Верни заполненный SUMMARY.md разработчику
