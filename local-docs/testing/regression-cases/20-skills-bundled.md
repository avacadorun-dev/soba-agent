# Регресс-кейсы: Skills — bundled

## Цель
Проверить загрузку и активацию встроенных skills (bundled).

## Окружение
- `.soba -i`
- Git-репозиторий с изменениями (для git-зависимых skills)

---

## Кейс 01: `/skill list` содержит bundled

**Шаги:**
1. `/skill list`

**Ожидаемый результат:** Список содержит 4 bundled skills:
- commit-message
- git-summary
- lint-fix
- pr-description

**Критерий PASS:** Все 4 присутствуют.

---

## Кейс 02: `/skill:git-summary` — git-summary

**Шаги:**
1. Сделать изменения в репозитории
2. `/skill:git-summary Покажи сводку изменений`

**Ожидаемый результат:** Skill активирован, ответ содержит git-анализ (изменённые файлы, коммиты, статистику).

**Критерий PASS:** Ответ не пустой, содержит git-информацию.

---

## Кейс 03: `/skill:commit-message` — commit-message

**Шаги:**
1. Сделать изменения в файлах
2. `/skill:commit-message Предложи commit message`

**Ожидаемый результат:** Skill анализирует staged/unstaged changes и предлагает commit message.

**Критерий PASS:** Предложение содержит conventional commit format (feat/fix/docs/etc).

---

## Кейс 04: `/skill:lint-fix` — lint-fix

**Шаги:**
1. Внести ошибку линтинга (нарушить форматирование)
2. `/skill:lint-fix Исправь ошибки`

**Ожидаемый результат:** Skill запускает линтер и исправляет найденные ошибки.

**Критерий PASS:** После активации `biome check .` показывает 0 ошибок.

---

## Кейс 05: `/skill:pr-description` — pr-description

**Шаги:**
1. Внести изменения, создать коммит
2. `/skill:pr-description Опиши PR`

**Ожидаемый результат:** Skill анализирует diff и генерирует описание PR.

**Критерий PASS:** Ответ содержит summary, changes, testing notes.

---

## Кейс 06: Активация через `activate_skill` tool call

**Шаги:**
1. `.soba "Активируй skill lint-fix и выполни его"`

**Ожидаемый результат:** Агент вызывает `activate_skill`, skill инъецирован, выполнен.

**Критерий PASS:** Skill выполнен.

---

## Кейс 07: `/skill rm git-summary --confirm` — удаление bundled

**Шаги:**
1. `/skill rm git-summary --confirm`

**Ожидаемый результат:** Ошибка: "Cannot remove bundled skill 'git-summary'".

**Критерий PASS:** Сообщение об ошибке.

---

## Кейс 08: Повторная активация одного skill

**Шаги:**
1. `/skill:lint-fix ...`
2. `/skill:lint-fix ...`

**Ожидаемый результат:** Оба раза skill отрабатывает.

**Критерий PASS:** Не падает, работает.

---

## Кейс 09: Skill без стейджинга (git-summary без изменений)

**Шаги:**
1. `/skill:git-summary Покажи сводку` (без изменений)

**Ожидаемый результат:** "No changes since last commit" или аналогично.

**Критерий PASS:** Не падает.

---

## Кейс 10: `/skill:commit-message` без staged изменений

**Шаги:**
1. `/skill:commit-message`

**Ожидаемый результат:** "No staged changes found" или анализ unstaged.

**Критерий PASS:** Не падает.

---

## Кейс 11: Progressive disclosure — catalog не показывает полный SKILL.md

**Шаги:**
1. `/skill list`

**Ожидаемый результат:** Показаны только name и description, не полный SKILL.md.

**Критерий PASS:** Без тела инструкции.

---

## Кейс 12: Полная инъекция при активации

**Шаги:**
1. Активировать skill
2. Проверить system prompt в логах/сессии

**Ожидаемый результат:** После активации полный SKILL.md присутствует в промпте.

**Критерий PASS:** Текст инструкции инъецирован.
