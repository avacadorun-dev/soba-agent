# Регресс-кейсы: Skills — discovery, trust, catalog

## Цель
Проверить механизмы обнаружения skills (bundled, user, project), управление доверием и каталог.

## Окружение
- `.soba -i`

---

## Кейс 01: SkillDiscovery — все bundled

**Шаги:**
1. Запустить SOBA
2. `/skill list`

**Ожидаемый результат:** 4 bundled skills: commit-message, git-summary, lint-fix, pr-description.

**Критерий PASS:** Все 4.

---

## Кейс 02: SkillDiscovery — user skills

**Шаги:**
1. Создать `~/.soba/skills/user-test/SKILL.md` с валидным frontmatter
2. `/skill list`

**Ожидаемый результат:** `user-test` присутствует.

**Критерий PASS:** Обнаружен.

---

## Кейс 03: SkillDiscovery — project без trust

**Шаги:**
1. Создать `.soba/skills/proj-test/SKILL.md`
2. `/skill list`

**Ожидаемый результат:** `proj-test` отсутствует.

**Критерий PASS:** Не обнаружен.

---

## Кейс 04: SkillDiscovery — project после trust

**Шаги:**
1. `/project-trust approve`
2. `/skill list`

**Ожидаемый результат:** `proj-test` появился.

**Критерий PASS:** Обнаружен.

---

## Кейс 05: SkillCatalog — progressive disclosure

**Шаги:**
1. `/skill list`

**Ожидаемый результат:** Только name и description, не полное тело SKILL.md.

**Критерий PASS:** Без тела.

---

## Кейс 06: SkillCatalog — полная инъекция при активации

**Шаги:**
1. Активировать skill: `/skill:git-summary ...`
2. Проверить system prompt в debug-логах

**Ожидаемый результат:** После активации полный текст SKILL.md в промпте.

**Критерий PASS:** Тело инъецировано.

---

## Кейс 07: ProjectTrustStore — персистентность

**Шаги:**
1. `/project-trust approve`
2. Выйти из SOBA
3. Запустить снова
4. `/skill list`

**Ожидаемый результат:** Trust сохранён, project skills видны.

**Критерий PASS:** Состояние переживает рестарт.

---

## Кейс 08: ProjectTrustStore — revoke

**Шаги:**
1. `/project-trust revoke`
2. Выйти
3. Запустить
4. `/skill list`

**Ожидаемый результат:** Trust revoked, project skills не видны.

**Критерий PASS:** Состояние сохранено.

---

## Кейс 09: Trust для .soba/skills/ vs .agents/skills/

**Шаги:**
1. Создать `.soba/skills/` и `.agents/skills/` с разными skills
2. `/project-trust approve`

**Ожидаемый результат:** Оба каталога сканируются.

**Критерий PASS:** Skills из обоих каталогов видны.

---

## Кейс 10: SkillDiscovery не падает при повреждённой директории

**Шаги:**
1. Создать `~/.soba/skills/corrupted` (файл вместо директории)
2. `/skill list`

**Ожидаемый результат:** Corrupted пропущен, остальные отображаются.

**Критерий PASS:** Не падает.

---

## Кейс 11: Catalog deduplication (если имя совпадает)

**Шаги:**
1. Создать user skill с именем "git-summary" (как у bundled)
2. `/skill list`

**Ожидаемый результат:** User skill переопределяет bundled (или предупреждение).

**Критерий PASS:** Определённое поведение.
