# Валидация регресс-кейсов: TUI — горячие клавиши

**Файл:** 06-tui-hotkeys.md
**Дата:** 2026-06-17
**Общий вердикт:** 🟢 VALID

---

## Сводка

| Проверка | Результат |
|----------|-----------|
| Тестовые файлы | 3/3 VALID |
| Slash-команды | 2/2 VALID |
| Исходники | 1/1 VALID |

---

## Детали

- Тесты: `tests/widgets/tui/command-history.test.ts`, `tests/widgets/tui/input-suggestions.test.ts`, `tests/tui-pty.test.ts` ✅
- Исходники горячих клавиш: `src/widgets/tui/lib/command-history.ts`, `src/widgets/tui/lib/input-suggestions.ts` ✅
- Slash-команды для автодополнения подтверждены ✅
