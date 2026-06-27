# Валидация регресс-кейсов: TUI — очередь сообщений

**Файл:** 08-tui-queue.md
**Дата:** 2026-06-17
**Общий вердикт:** 🟢 VALID

---

## Сводка

| Проверка | Результат |
|----------|-----------|
| Тестовые файлы | 1/1 VALID |
| Slash-команды | 1/1 VALID |

---

## Детали

- Очередь сообщений реализована в `src/widgets/tui/model/tui-store.ts` (queuedMessages signal) ✅
- Slash-команда `/queue` зарегистрирована в `src/cli/commands.ts` ✅
- Тесты: `tests/tui.test.ts` ✅
