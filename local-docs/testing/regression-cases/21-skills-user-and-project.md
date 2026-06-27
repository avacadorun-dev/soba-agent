# Регресс-кейсы: Skills — user и project

## Цель
Проверить установку пользовательских и проектных skills, trust-механизм для project skills.

## Окружение
- `.soba -i`
- Возможность создавать/удалять файлы в `~/.soba/skills/` и `.soba/skills/`

---

## Кейс 01: User skill — создание валидного SKILL.md

**Шаги:**
1. Создать директорию: `mkdir -p ~/.soba/skills/test-skill`
2. Создать `~/.soba/skills/test-skill/SKILL.md`:
```markdown
---
name: test-skill
description: Тестовый пользовательский skill
---
Выполни команду ls и верни результат.
```
3. `/skill list`

**Ожидаемый результат:** `test-skill` в списке.

**Критерий PASS:** Skill отображается.

---

## Кейс 02: User skill — активация

**Шаги:**
1. `/skill:test-skill Выполни skill`

**Ожидаемый результат:** Skill активирован, инструкция выполнена.

**Критерий PASS:** Ответ содержит результат ls.

---

## Кейс 03: User skill — удаление

**Шаги:**
1. `rm -rf ~/.soba/skills/test-skill`
2. `/skill list`

**Ожидаемый результат:** `test-skill` отсутствует.

**Критерий PASS:** Skill удалён.

---

## Кейс 04: User skill — без frontmatter

**Шаги:**
1. Создать `~/.soba/skills/bad-skill/SKILL.md` без frontmatter: `Просто текст`

**Ожидаемый результат:** `bad-skill` не отображается (ошибка валидации).

**Критерий PASS:** Ошибка в логах или skill не в списке.

---

## Кейс 05: User skill — without name/description

**Шаги:**
1. Создать `~/.soba/skills/no-name-skill/SKILL.md`:
```markdown
---
name: ""
description: ""
---
Инструкция
```

**Ожидаемый результат:** Ошибка валидации (name required).

**Критерий PASS:** Skill не загружен.

---

## Кейс 06: Project skill — без trust

**Шаги:**
1. Создать `.soba/skills/proj-skill/SKILL.md` с валидным frontmatter
2. `/skill list`

**Ожидаемый результат:** `proj-skill` не отображается (trust not granted).

**Критерий PASS:** Skill не виден.

---

## Кейс 07: Project skill — после trust

**Шаги:**
1. `/project-trust approve`
2. `/skill list`

**Ожидаемый результат:** `proj-skill` появился в списке.

**Критерий PASS:** Skill виден.

---

## Кейс 08: Project skill — активация

**Шаги:**
1. `/skill:proj-skill Выполни`

**Ожидаемый результат:** Skill активирован.

**Критерий PASS:** Ответ.

---

## Кейс 09: Project skill — revoke trust

**Шаги:**
1. `/project-trust revoke`
2. `/skill list`

**Ожидаемый результат:** `proj-skill` исчез.

**Критерий PASS:** Skill не виден.

---

## Кейс 10: `~/.soba/skills/` и `.soba/skills/` — оба пути

**Шаги:**
1. Создать user skill в `~/.soba/skills/`
2. Создать project skill в `.soba/skills/` (с trust)
3. `/skill list`

**Ожидаемый результат:** Оба отображаются.

**Критерий PASS:** Оба.

---

## Кейс 11: Project skill с вложенными файлами (assets)

**Шаги:**
1. Создать `.soba/skills/asset-skill/SKILL.md` + `.soba/skills/asset-skill/data.txt`
2. `/project-trust approve`
3. Активировать skill

**Ожидаемый результат:** Skill загружен, вложенные файлы доступны.

**Критерий PASS:** Skill работает.

---

## Кейс 12: Символическая ссылка в skills

**Шаги:**
1. Создать skill через symlink
2. `/skill list`

**Ожидаемый результат:** Symlink-директория не загружается.

**Критерий PASS:** Пропущен (с сообщением или без).
