# Валидация регресс-кейсов: TUI — базовая функциональность

**Файл:** 05-tui-basic.md
**Дата:** 2026-06-17
**Общий вердикт:** 🟢 VALID

---

## Сводка

| Проверка | Результат |
|----------|-----------|
| Тестовые файлы | 3/3 VALID |
| CLI-флаги | 2/2 VALID |
| Slash-команды | 17/17 VALID |

---

## Детали

- Все slash-команды из кейса 08 подтверждены в `src/cli/commands.ts`: /compact, /rewind, /session, /capsule, /auto-compact, /budget, /config, /lang, /theme, /queue, /permissions, /notifications, /skill, /project-trust, /clear, /help, /exit ✅
- Тесты: `tests/tui.test.ts`, `tests/tui-pty.test.ts`, `tests/tui-slash-commands.test.ts` ✅
- Исходники: `src/tui/interactive-tui.ts`, `src/widgets/tui/model/tui-store.ts` ✅
