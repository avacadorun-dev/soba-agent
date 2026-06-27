# Валидация регресс-кейсов: Agent Loop

**Файл:** 12-agent-loop.md
**Дата:** 2026-06-17
**Общий вердикт:** 🟢 VALID

---

## Сводка

| Проверка | Результат |
|----------|-----------|
| Тестовые файлы | 2/2 VALID |
| CLI-флаги | 3/3 VALID |

---

## Детали

- Agent loop: `src/core/loop/agent-loop.ts` ✅
- Тесты: `tests/agent-loop.test.ts`, `tests/loop-guard.test.ts` ✅
- Флаги `--max-agent-iterations`, `--max-stalled-iterations`, `--max-run-minutes` в --help ✅
