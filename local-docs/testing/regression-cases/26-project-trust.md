# Регресс-кейсы: Project Trust

## Цель
Проверить механизм доверия к проекту — approve, revoke, персистентность между сессиями.

## Окружение
- `.soba -i`
- `.soba/skills/` или `.soba/trust.json`

---

## Кейс 01: `/project-trust status` — не установлено

**Шаги:**
1. Удалить файл trust (если есть)
2. `/project-trust status`

**Ожидаемый результат:** "Project trust: not trusted".

**Критерий PASS:** Статус.

---

## Кейс 02: `/project-trust approve` — установка

**Шаги:**
1. `/project-trust approve`
2. `/project-trust status`

**Ожидаемый результат:** "Project trust: trusted".

**Критерий PASS:** Статус изменился.

---

## Кейс 03: `/project-trust revoke` — отзыв

**Шаги:**
1. `/project-trust revoke`
2. `/project-trust status`

**Ожидаемый результат:** "Project trust: not trusted".

**Критерий PASS:** Статус изменился.

---

## Кейс 04: Персистентность (между запусками)

**Шаги:**
1. `/project-trust approve`
2. `/exit`
3. `.soba -i`
4. `/project-trust status`

**Ожидаемый результат:** "Project trust: trusted".

**Критерий PASS:** Состояние сохранено.

---

## Кейс 05: Trust влияет на видимость project skills

**Шаги:**
1. Создать `.soba/skills/proj-skill/SKILL.md`
2. `/project-trust revoke`
3. `/skill list`

**Ожидаемый результат:** `proj-skill` не виден.
4. `/project-trust approve`
5. `/skill list`

**Ожидаемый результат:** `proj-skill` виден.

**Критерий PASS:** Влияние на skills.

---

## Кейс 06: Trust для разных директорий проектов

**Шаги:**
1. `/project-trust status`

**Ожидаемый результат:** Trust связан с текущей рабочей директорией.

**Критерий PASS:** trust.json сохраняется в `.soba/` проекта.

---

## Кейс 07: Нет `.soba/` директории

**Шаги:**
1. Удалить `.soba/`
2. `/project-trust approve`

**Ожидаемый результат:** Директория .soba/ создана.

**Критерий PASS:** Директория существует.

---

## Кейс 08: Trust без project skills — не блокирует

**Шаги:**
1. `.soba/` без `skills/`
2. `/project-trust approve`

**Ожидаемый результат:** Доверие установлено без skills.

**Критерий PASS:** Без ошибок.
