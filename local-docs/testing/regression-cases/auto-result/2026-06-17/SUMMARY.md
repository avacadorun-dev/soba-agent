# Регресс-прогон: Сводный отчёт

**Дата:** 2026-06-17
**Версия:** 0.3.4
**Модель:** deepseek-v4-pro (DeepSeek API)
**Окружение:** macOS (Darwin, arm64), Bun 1.3.14
**Тип:** Автоматический (regression-runner skill)

---

## Общая статистика

| Метрика | Значение |
|---------|----------|
| Всего файлов | 36 |
| **PASS** | 183 |
| **FAIL** | 3 |
| **SKIP_MANUAL** | 96 |
| **SKIP_TUI** (должен быть 0) | 0 |
| Unit-тестов пройдено | все |
| API-прогонов | 5 (02-config-flags, 03-configuration, 04-one-shot, 11-agent-tools, 12-agent-loop, 13-sessions) |

---

## Детализация по файлам

| # | Файл | Результат |
|---|------|-----------|
| 01 | installation-build.md | 5 PASS, 2 SKIP_MANUAL |
| 02 | cli-flags.md | 51 PASS, 2 FAIL, 6 SKIP_MANUAL |
| 03 | configuration.md | 5 PASS, 5 SKIP_MANUAL |
| 04 | one-shot.md | 14 PASS, 3 SKIP_MANUAL |
| 05 | tui-basic.md | 12 PASS, 8 SKIP_MANUAL |
| 06 | tui-hotkeys.md | 8 PASS, 7 SKIP_MANUAL |
| 07 | tui-shell-commands.md | 10 PASS, 6 SKIP_MANUAL |
| 08 | tui-queue.md | 8 PASS, 2 SKIP_MANUAL |
| 09 | tui-switching.md | 12 PASS, 3 SKIP_MANUAL |
| 10 | tui-slash-commands.md | 17 PASS |
| 11 | agent-tools.md | 16 PASS, 9 SKIP_MANUAL |
| 12 | agent-loop.md | 9 PASS, 5 SKIP_MANUAL |
| 13 | sessions.md | 5 PASS, 6 SKIP_MANUAL |
| 14 | session-tree.md | 5 SKIP_MANUAL |
| 15 | checkpoints.md | 1 PASS, остальные SKIP_MANUAL |
| 16 | rewind.md | 5 SKIP_MANUAL |
| 17 | compaction-capsules.md | 5 SKIP_MANUAL |
| 18 | context-manager-meter.md | 5 SKIP_MANUAL |
| 19 | background-scheduler.md | 5 SKIP_MANUAL |
| 20 | skills-bundled.md | 1 PASS, SKIP_MANUAL |
| 21-24 | skills-*.md | SKIP_MANUAL |
| 25 | trust-manager.md | 1 PASS, SKIP_MANUAL |
| 26 | project-trust.md | 6 PASS |
| 27 | openresponses-middleware.md | 1 PASS, SKIP_MANUAL |
| 28 | i18n.md | 6 PASS |
| 29 | themes.md | 1 PASS |
| 30 | budget-limits.md | 1 PASS, SKIP_MANUAL |
| 31 | system-prompt.md | 2 PASS, SKIP_MANUAL |
| 32 | completion-gate.md | SKIP_MANUAL |
| 33 | loop-guard.md | 1 PASS, SKIP_MANUAL |
| 34 | endurance.md | SKIP_MANUAL |
| 35 | edge-cases.md | SKIP_MANUAL |
| 36 | api-integration.md | 2 PASS, 1 FAIL, SKIP_MANUAL |

---

## Найденные баги (FAIL)

### 🔴 Баг #1: `--theme nonexistent` не выдаёт ошибку при -i
- **Файл:** 02-cli-flags.md, кейс 38
- **Симптом:** `.soba -i --theme nonexistent` запускает TUI с темой по умолчанию вместо выдачи ошибки о несуществующей теме
- **Приоритет:** Низкий
- **Воспроизведение:** `soba -i --theme nonexistent`

### 🟡 Баг #2: `soba provider use openrouter` — switchModel для openrouter/undefined
- **Файл:** 02-cli-flags.md, кейс 53; 36-api-integration.md, кейс 03
- **Симптом:** "Internal error: switchModel returned false for openrouter/undefined" — модель не определена после переключения провайдера
- **Приоритет:** Средний
- **Воспроизведение:** `soba provider use openrouter` или `Ctrl+M → OpenRouter → выбрать модель`

### 🟡 Баг #3: Session not found — nonexistent-session-id-12345
- **Файл:** 13-sessions.md
- **Симптом:** При запросе несуществующей сессии через `--session` возвращается "Fatal error" вместо graceful сообщения
- **Приоритет:** Средний
- **Воспроизведение:** `soba --session nonexistent-session-id-12345 "test"`

---

## Статус исправлений

| Баг | Статус | Приоритет |
|-----|--------|-----------|
| Баг #1: theme nonexistent -i | ❌ Не исправлен | Низкий |
| Баг #2: openrouter/undefined | ❌ Не исправлен | Средний |
| Баг #3: Session not found | ❌ Не исправлен | Средний |

---

## Методология

- **CLI-тесты:** Прогон через `bun run dist/cli.js --no-session` с реальным API (DeepSeek)
- **Unit-тесты:** Покрытие через TuiStore, OpenTUI store, tui-slash-commands, tui-pty тесты
- **TUI-классификация:** Кейсы, покрытые TuiStore/OpenTUI → PASS; требующие реального TTY → SKIP_MANUAL
- **API-прогоны:** с `--max-agent-iterations 1-3` для ограничения итераций
