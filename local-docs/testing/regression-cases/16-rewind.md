# Регресс-кейсы: Rewind

## Цель
Проверить переключение между checkpoint'ами и создание веток.

## Окружение
- `.soba -i`
- Несколько checkpoint'ов создано

---

## Кейс 01: `/rewind` — список

**Шаги:**
1. Создать 2 checkpoint'а
2. `/rewind`

**Ожидаемый результат:** Список checkpoint'ов с ID и описанием.

**Критерий PASS:** 2+ checkpoint'а.

---

## Кейс 02: `/rewind <id>` — переключение

**Шаги:**
1. `/rewind <checkpoint-id>`
2. `/session`

**Ожидаемый результат:** Active leaf изменился на checkpoint.

**Критерий PASS:** Leaf == id checkpoint.

---

## Кейс 03: Rewind + новое сообщение

**Шаги:**
1. `/rewind <checkpoint-id>`
2. Отправить "Новое сообщение после rewind"
3. Проверить JSONL

**Ожидаемый результат:** parentId нового сообщения = id checkpoint.

**Критерий PASS:** Ветка создана от checkpoint.

---

## Кейс 04: Многократный rewind

**Шаги:**
1. Создать 3 checkpoint'а
2. `/rewind <checkpoint-1>`
3. Отправить "A"
4. `/rewind <checkpoint-2>`
5. Отправить "B"
6. `/rewind <checkpoint-3>`
7. Отправить "C"

**Ожидаемый результат:** Дерево с 3 ветками от разных checkpoint'ов.

**Критерий PASS:** Все 3 ветки в JSONL.

---

## Кейс 05: Rewind к несуществующему ID

**Шаги:**
1. `/rewind fake-id`

**Ожидаемый результат:** "Checkpoint not found".

**Критерий PASS:** Сообщение об ошибке.

---

## Кейс 06: Rewind без checkpoint'ов

**Шаги:**
1. Запустить свежий TUI
2. `/rewind`

**Ожидаемый результат:** "No checkpoints available".

**Критерий PASS:** Сообщение.

---

## Кейс 07: Rewind после компакции

**Шаги:**
1. Создать checkpoint
2. Выполнить компакцию
3. `/rewind <checkpoint-id>`

**Ожидаемый результат:** Rewind возможен (даже после компакции).

**Критерий PASS:** Leaf переключён.

---

## Кейс 08: Rewind и /session проверка

**Шаги:**
1. Create checkpoint
2. Отправить "A"
3. `/rewind <checkpoint-id>`
4. `/session`

**Ожидаемый результат:** Leaf = checkpoint, active branch показывает новый путь.

**Критерий PASS:** Информация корректна.

---

## Кейс 09: Rewind, продолжение, ещё rewind

**Шаги:**
1. Checkpoint → A → B (ветка 1)
2. Rewind к checkpoint → C (ветка 2)
3. Rewind к A → D (ветка 3)
4. Проверить JSONL

**Ожидаемый результат:** 3 ветки, все parentId корректны.

**Критерий PASS:** Дерево целостно.

---

## Кейс 10: Rewind к checkpoint, затем continue (`-c`)

**Шаги:**
1. `-c` продолжает активный leaf (после rewind)
2. Проверить

**Ожидаемый результат:** parentId → item после rewind.

**Критерий PASS:** Корректное продолжение.
