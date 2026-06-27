# Регресс-кейсы: Checkpoints

## Цель
Проверить создание checkpoint'ов через tool call, их структуру в JSONL, и отображение в TUI.

## Окружение
- `.soba -i` или one-shot

---

## Кейс 01: Создание checkpoint через tool call

**Шаги:**
1. `.soba "Поставь checkpoint с описанием 'тестовый checkpoint'"`

**Ожидаемый результат:** Checkpoint создан в сессии.

**Критерий PASS:** В JSONL сессии есть item: `{"type": "checkpoint", ...}`.

---

## Кейс 02: Структура checkpoint в JSONL

**Шаги:**
1. Выполнить Кейс 01
2. Прочитать JSONL, найти checkpoint

**Ожидаемый результат:** Checkpoint содержит:
```json
{
  "type": "checkpoint",
  "id": "...",
  "parentId": "...",
  "description": "тестовый checkpoint"
}
```

**Критерий PASS:** Все поля присутствуют.

---

## Кейс 03: Checkpoint с метаданными

**Шаги:**
1. `.soba "Поставь checkpoint с description 'этап 1'"`

**Ожидаемый результат:** description сохранён в JSONL.

**Критерий PASS:** description совпадает.

---

## Кейс 04: Множественные checkpoint'ы

**Шаги:**
1. `.soba "Создай 3 checkpoint'а: этап 1, этап 2, этап 3"`
2. Проверить JSONL

**Ожидаемый результат:** 3 checkpoint'а, каждый с уникальным id.

**Критерий PASS:** Все 3 присутствуют.

---

## Кейс 05: Checkpoint в TUI через `/rewind`

**Шаги:**
1. `.soba -i`
2. Отправить "test"
3. `/rewind`

**Ожидаемый результат:** Список checkpoint'ов (может быть пуст, если нет tool call checkpoint).

**Критерий PASS:** Не падает.

---

## Кейс 06: Checkpoint как точка ветвления

**Шаги:**
1. Создать checkpoint (через tool call или implicit)
2. Отправить новое сообщение
3. `/rewind` к checkpoint
4. Отправить другое сообщение
5. Проверить JSONL

**Ожидаемый результат:** Две ветки от checkpoint.

**Критерий PASS:** parentId обоих новых item'ов = id checkpoint.

---

## Кейс 07: Checkpoint с пустым описанием

**Шаги:**
1. `.soba "Поставь checkpoint без описания"` (или с пустым)

**Ожидаемый результат:** description может быть пустым.

**Критерий PASS:** Не падает.

---

## Кейс 08: 100+ checkpoint'ов

**Шаги:**
1. Создать 100 checkpoint'ов (скриптом или через агента)
2. Загрузить сессию

**Ожидаемый результат:** Загрузка без тайм-аута.

**Критерий PASS:** < 5 секунд загрузка.
