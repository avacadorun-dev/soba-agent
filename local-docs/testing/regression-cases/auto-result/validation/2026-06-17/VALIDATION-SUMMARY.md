# Валидация регресс-кейсов: Сводный отчёт (исправленный)

**Дата:** 2026-06-17 (исправлено 2026-06-17)
**Версия:** 0.3.7
**Проверено файлов:** 36/36
**Тип:** Автоматический (regression-validator skill) + автоисправление

---

## Общая статистика (после исправлений)

| Статус | Количество |
|--------|------------|
| 🟢 VALID | 36 |
| 🟡 MINOR | 0 |
| 🟠 STALE | 0 |
| 🔴 BROKEN | 0 |

---

## Детализация по файлам

| # | Файл | Вердикт |
|---|------|---------|
| 01 | installation-build.md | 🟢 VALID |
| 02 | cli-flags.md | 🟢 VALID ✅ (исправлено) |
| 03 | configuration.md | 🟢 VALID ✅ (исправлено) |
| 04 | one-shot.md | 🟢 VALID ✅ (исправлено) |
| 05 | tui-basic.md | 🟢 VALID |
| 06 | tui-hotkeys.md | 🟢 VALID |
| 07 | tui-shell-commands.md | 🟢 VALID |
| 08 | tui-queue.md | 🟢 VALID |
| 09 | tui-switching.md | 🟢 VALID |
| 10 | tui-slash-commands.md | 🟢 VALID |
| 11 | agent-tools.md | 🟢 VALID |
| 12 | agent-loop.md | 🟢 VALID |
| 13 | sessions.md | 🟢 VALID |
| 14 | session-tree.md | 🟢 VALID |
| 15 | checkpoints.md | 🟢 VALID |
| 16 | rewind.md | 🟢 VALID |
| 17 | compaction-capsules.md | 🟢 VALID |
| 18 | context-manager-meter.md | 🟢 VALID |
| 19 | background-scheduler.md | 🟢 VALID |
| 20 | skills-bundled.md | 🟢 VALID |
| 21 | skills-user-and-project.md | 🟢 VALID |
| 22 | skills-draft-eval-promote.md | 🟢 VALID |
| 23 | skills-discovery-trust-catalog.md | 🟢 VALID |
| 24 | skills-workflow-observer.md | 🟢 VALID |
| 25 | trust-manager.md | 🟢 VALID |
| 26 | project-trust.md | 🟢 VALID |
| 27 | openresponses-middleware.md | 🟢 VALID |
| 28 | i18n.md | 🟢 VALID |
| 29 | themes.md | 🟢 VALID |
| 30 | budget-limits.md | 🟢 VALID |
| 31 | system-prompt.md | 🟢 VALID |
| 32 | completion-gate.md | 🟢 VALID |
| 33 | loop-guard.md | 🟢 VALID |
| 34 | endurance.md | 🟢 VALID |
| 35 | edge-cases.md | 🟢 VALID |
| 36 | api-integration.md | 🟢 VALID ✅ (исправлено) |

---

## Исправленные расхождения

| Файл | Кейс | Было | Стало |
|------|------|------|-------|
| 03 | Окружение | `--provider, --model, --api-key` | `--model, --api-key, --base-url` |
| 03 | Кейс 12 | `SOBA_PROVIDER=deepseek SOBA_MODEL=...` | `SOBA_MODEL=deepseek-chat` |
| 03 | Кейс 16 | `soba --provider deepseek --model ...` | `soba --model deepseek-chat` |
| 02 | Кейс 56 | `SOBA_PROVIDER=deepseek SOBA_MODEL=...` | `SOBA_MODEL=deepseek-chat` |
| 04 | Кейс 17 | `SOBA_PROVIDER=deepseek SOBA_MODEL=...` | `SOBA_MODEL=deepseek-chat` |
| 36 | Кейс 01,02,08,09 | `soba --provider <id> --model` | `soba provider use <id> && soba --model` |

---

## Готовность к regression-runner

- 🟢 **Готово** — все 36 файлов 🟢 VALID, можно запускать regression-runner.
