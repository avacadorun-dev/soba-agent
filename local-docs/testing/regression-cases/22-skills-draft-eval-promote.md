# Регресс-кейсы: Skills — draft, eval, promote, revision

## Цель
Проверить жизненный цикл skill: создание draft, eval, promote, rollback.

## Окружение
- `.soba -i`

---

## Кейс 01: `/skill new` — создание draft

**Шаги:**
1. `/skill new test-desc "Тестовый skill: выводит текущую дату"`

**Ожидаемый результат:** Draft создан в `~/.soba/skill-drafts/test-desc/SKILL.md`.

**Критерий PASS:** Файл существует.

---

## Кейс 02: `/skill new` — содержимое draft

**Шаги:**
1. Прочитать `~/.soba/skill-drafts/test-desc/SKILL.md`

**Ожидаемый результат:** SKILL.md содержит валидный frontmatter с name: "test-desc", description: "Тестовый skill: выводит текущую дату" и пустым body.

**Критерий PASS:** Структура корректна.

---

## Кейс 03: `/skill edit test-skill` — редактирование существующего

**Шаги:**
1. Создать user-skill с содержимым
2. `/skill edit test-skill`

**Ожидаемый результат:** Draft создан из существующего skill.

**Критерий PASS:** Draft в `~/.soba/skill-drafts/test-skill/`.

---

## Кейс 04: `/skill eval test-desc` — eval без ошибок

**Шаги:**
1. `/skill eval test-desc`

**Ожидаемый результат:** Eval запущен, результат в `~/.soba/eval-runs/`.

**Критерий PASS:** Результат содержит success/fail, errors (если есть).

---

## Кейс 05: Eval с ошибками

**Шаги:**
1. Создать draft с невалидной инструкцией
2. `/skill eval error-draft`

**Ожидаемый результат:** Отчёт с ошибками.

**Критерий PASS:** errors > 0, детали ошибок.

---

## Кейс 06: `/skill promote test-desc --scope=user` без eval

**Шаги:**
1. `/skill promote test-desc --scope=user` (без предварительного eval)

**Ожидаемый результат:** Ошибка: "Skill 'test-desc' has not been evaluated. Run /skill eval test-desc first."

**Критерий PASS:** Сообщение об ошибке.

---

## Кейс 07: `/skill promote test-desc --scope=user` с eval

**Шаги:**
1. Выполнить eval (Кейс 04)
2. `/skill promote test-desc --scope=user`

**Ожидаемый результат:** Skill опубликован в `~/.soba/skills/test-desc/SKILL.md`.

**Критерий PASS:** Файл существует, копия draft.

---

## Кейс 08: `/skill promote test-desc --scope=project` (без trust)

**Шаги:**
1. `/project-trust revoke` (если есть)
2. `/skill promote test-desc --scope=project`

**Ожидаемый результат:** Ошибка: "Project trust required for scope=project".

**Критерий PASS:** Сообщение.

---

## Кейс 09: `/skill promote test-desc --scope=project` (с trust)

**Шаги:**
1. `/project-trust approve`
2. `/skill promote test-desc --scope=project`

**Ожидаемый результат:** Skill опубликован в `.soba/skills/test-desc/SKILL.md`.

**Критерий PASS:** Файл существует.

---

## Кейс 10: `/skill history test-desc` — история revision

**Шаги:**
1. Выполнить несколько promote (разные версии)
2. `/skill history test-desc`

**Ожидаемый результат:** Список revisions с ID, временем, описанием.

**Критерий PASS:** Не пусто.

---

## Кейс 11: `/skill history` для несуществующего skill

**Шаги:**
1. `/skill history nonexistent`

**Ожидаемый результат:** "Skill 'nonexistent' not found".

**Критерий PASS:** Сообщение.

---

## Кейс 12: `/skill rollback test-desc <revision-id>`

**Шаги:**
1. Получить revision ID из history
2. `/skill rollback test-desc <revision-id>`

**Ожидаемый результат:** Новый draft создан из snapshot'а revision.

**Критерий PASS:** Draft в `~/.soba/skill-drafts/test-desc/` содержит содержимое revision.

---

## Кейс 13: `/skill rollback` несуществующего revision

**Шаги:**
1. `/skill rollback test-desc fake-revision`

**Ожидаемый результат:** "Revision 'fake-revision' not found".

**Критерий PASS:** Сообщение.

---

## Кейс 14: `/skill rm test-desc --confirm` — удаление

**Шаги:**
1. `/skill rm test-desc --confirm`

**Ожидаемый результат:** Skill удалён из каталога.

**Критерий PASS:** `/skill list` не содержит test-desc.

---

## Кейс 15: `/skill rm` без --confirm

**Шаги:**
1. `/skill rm test-desc`

**Ожидаемый результат:** "Use --confirm to confirm deletion".

**Критерий PASS:** Запрос подтверждения.

---

## Кейс 16: `/skill rm` несуществующего

**Шаги:**
1. `/skill rm nonexistent --confirm`

**Ожидаемый результат:** "Skill 'nonexistent' not found".

**Критерий PASS:** Сообщение.

---

## Кейс 17: Цикл: new → edit → eval → promote → history → rollback

**Шаги:**
1. `/skill new test-lifecycle "Описание"`
2. Отредактировать SKILL.md в draft
3. `/skill eval test-lifecycle`
4. `/skill promote test-lifecycle --scope=user`
5. `/skill history test-lifecycle`
6. `/skill rollback test-lifecycle <revision-id>`

**Ожидаемый результат:** Весь цикл проходит без ошибок.

**Критерий PASS:** Все шаги успешны.
