# Валидация регресс-кейсов: Установка и сборка

**Файл:** 01-installation-build.md
**Дата:** 2026-06-17
**Общий вердикт:** 🟡 MINOR

---

## Сводка

| Проверка | Результат |
|----------|-----------|
| Тестовые файлы | 1/1 VALID |
| CLI-флаги | 17/20 (3 MISMATCH) |
| Инструменты | 0/0 (не применимо) |
| Slash-команды | 2/2 VALID |
| Исходники | 1/1 VALID |
| Версия | ⚠️ MISMATCH (v0.3.2 → v0.3.4) |

---

## Детальные результаты

### Кейс 05: `.soba version` — проверка версии
- **Статус:** ⚠️ MISMATCH
- **Версия в кейсе:** v0.3.2
- **Актуальная версия:** v0.3.4
- **Рекомендация:** Обновить v0.3.2 → v0.3.4

### Кейс 06: `.soba --help` — справка
- **Статус:** ⚠️ MISMATCH
- **Проверки флагов:**
  - `--interactive` → в коде ✅ (алиас -i, в help показан как -i)
  - `--continue` → в коде ✅ (алиас -c, в help показан как -c)
  - `--session` → в коде ✅ (алиас -s, в help показан как -s)
  - `--model` → в --help ✅
  - `--debug` → в --help ✅
  - `--budget` → в --help ✅
  - `--lang` → в --help ✅
  - `--theme` → в --help ✅
  - `--no-color` → в --help ✅
  - `--stream` → в --help ✅
  - `--no-stream` → в --help ✅
  - `--no-session` → в --help ✅
  - `--no-auto-compact` → в --help ✅
  - `--max-agent-iterations` → в --help ✅
  - `--max-stalled-iterations` → в --help ✅
  - `--max-run-minutes` → в --help ✅
  - `--context-window` → в --help ✅
  - `--api-key` → в --help ✅
  - `--base-url` → в --help ✅
  - `--max-tokens` → ⚠️ deprecated (работает, но в --help не показан, рекомендуется `--max-output-tokens`)
  - `--max-completion-tokens` → ⚠️ в коде есть, но **нет в --help** (не задокументирован)
- **Рекомендация:** Обновить список флагов: `--max-tokens` → `--max-output-tokens`; добавить `--max-completion-tokens` в --help или удалить из кейса; `--interactive`/`--continue`/`--session` отображаются как -i/-c/-s в help.

### Кейс 07-08, 12: Тесты, линтер, исходники
- `src/cli/commands.ts` → EXISTS ✅
- `tests/project-setup.test.ts` → EXISTS ✅

---

## Рекомендации

1. **Кейс 05:** Обновить `v0.3.2` → `v0.3.4`
2. **Кейс 06:** `--max-tokens` заменить на `--max-output-tokens`; `--max-completion-tokens` задокументировать в --help или убрать из кейса
