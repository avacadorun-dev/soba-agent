# Валидация регресс-кейсов: Skills — bundled

**Файл:** 20-skills-bundled.md
**Дата:** 2026-06-17
**Общий вердикт:** 🟢 VALID

---

## Сводка

| Проверка | Результат |
|----------|-----------|
| Тестовые файлы | 2/2 VALID |
| Slash-команды | 1/1 VALID |

---

## Детали

- 4 bundled skills: commit-message, git-summary, lint-fix, pr-description (из `skills/`) ✅
- Тесты: `tests/core/skills/bundled-skills.test.ts`, `tests/core/skills/skill-activation.test.ts` ✅
- `/skill list` и `/skill:name` реализованы ✅
