# Регресс-кейсы: Context Manager и Context Meter

## Цель
Проверить подсчёт токенов, проверку лимитов и принятие решений о компакции.

## Окружение
- `.soba -i`

---

## Кейс 01: Context Meter считает effective tokens

**Шаги:**
1. Отправить 1 сообщение
2. `/session`

**Ожидаемый результат:** effective tokens > 0.

**Критерий PASS:** Число разумное.

---

## Кейс 02: Historical tokens >= effective

**Шаги:**
1. Отправить 2 сообщения
2. `/session`

**Ожидаемый результат:** Historical tokens >= effective tokens.

**Критерий PASS:** historical >= effective.

---

## Кейс 03: Historical tokens растут с каждым turn

**Шаги:**
1. Отправить 3 сообщения, после каждого проверять `/session`

**Ожидаемый результат:** Historical tokens монотонно растут.

**Критерий PASS:** Каждый раз больше.

---

## Кейс 04: Effective tokens = historical (без компакции)

**Шаги:**
1. Без компакции, effective == historical

**Ожидаемый результат:** effective === historical.

**Критерий PASS:** Равны.

---

## Кейс 05: Hard limit проверка

**Шаги:**
1. Установить compaction.hardLimitRatio = 0.3
2. Провести итерации до превышения

**Ожидаемый результат:** Context Manager инициирует blocking compaction.

**Критерий PASS:** Compact выполнен.

---

## Кейс 06: ROI расчёт

**Шаги:**
1. После длинной сессии выполнить `/compact`
2. Проверить логи или результат

**Ожидаемый результат:** Context Manager рассчитал ROI (savings / cost).

**Критейрий PASS:** Компакция выполнена или no-op с пояснением ROI.

---

## Кейс 07: Capsule savings tracking

**Шаги:**
1. Выполнить компакцию
2. `/capsule <id>`

**Ожидаемый результат:** savings: N tokens.

**Критерий PASS:** savings > 0 (если компакция real, не no-op).

---

## Кейс 08: Context window из config применяется

**Шаги:**
1. Установить contextWindow: 64000 в config
2. `.soba -i`
3. `/session`

**Ожидаемый результат:** Context window = 64000.

**Критерий PASS:** Совпадает.

---

## Кейс 09: hardLimit = contextWindow * hardLimitRatio

**Шаги:**
1. contextWindow = 64000, hardLimitRatio = 0.95
2. `/session`

**Ожидаемый результат:** Hard limit = 60800.

**Критерий PASS:** hardLimit = 64000 * 0.95.
