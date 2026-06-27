# Регресс-кейсы: OpenResponses client и middleware

## Цель
Проверить OpenResponses-клиент, typed items, middleware-адаптер для провайдера.

## Окружение
- `.soba` собран
- Реальный API endpoint (или мок)

---

## Кейс 01: OpenResponses client — базовый вызов

**Шаги:**
1. `.soba "Ответь 'ok'"`

**Ожидаемый результат:** Клиент отправляет запрос в формате OpenResponses, получает ответ.

**Критерий PASS:** Ответ не пустой.

---

## Кейс 02: Streaming работает

**Шаги:**
1. `.soba --stream "Ответь 'ok'"`

**Ожидаемый результат:** Ответ получается чанками (видна задержка).

**Критерий PASS:** Частичный вывод.

---

## Кейс 03: Non-streaming работает

**Шаги:**
1. `.soba --no-stream "Ответь 'ok'"`

**Ожидаемый результат:** Весь ответ сразу.

**Критерий PASS:** Полный вывод.

---

## Кейс 04: Middleware адаптирует ответ провайдера

**Шаги:**
1. `.soba --model deepseek-chat "Тест"`
2. Проверить debug-логи

**Ожидаемый результат:** Middleware преобразует ответ провайдера в формат OpenResponses.

**Критерий PASS:** Ответ получен.

---

## Кейс 05: Провайдер возвращает ошибку

**Шаги:**
1. `.soba --model nonexistent "Тест"`

**Ожидаемый результат:** Ошибка от провайдера, SOBA не падает.

**Критерий PASS:** Ошибка обработана.

---

## Кейс 06: Провайдер возвращает 429 (rate limit)

**Шаги:**
1. Отправить много запросов подряд (rate limit)
2. Наблюдать

**Ожидаемый результат:** SOBA ждёт (retry) или сообщает о rate limit.

**Критерий PASS:** Не падает.

---

## Кейс 07: API key из окружения отправляется корректно

**Шаги:**
1. Удалить apiKey из config
2. `SOBA_API_KEY=sk-test .soba --model deepseek-chat "Тест"`

**Ожидаемый результат:** API key передан в заголовке Authorization.

**Критерий PASS:** Ответ получен.

---

## Кейс 08: Кастомный base-url

**Шаги:**
1. `.soba --base-url https://api.deepseek.com/v1 --api-key sk-test --model deepseek-chat "Тест"` (OpenAI-совместимый эндпоинт, любая модель)

**Ожидаемый результат:** Запрос к кастомному URL.

**Критерий PASS:** Ответ получен.

---

## Кейс 09: Middleware с несовместимым провайдером

**Шаги:**
1. `.soba --base-url https://nonexistent-api.example.com --api-key test --model test "hi"`

**Ожидаемый результат:** Ошибка соединения.

**Критерий PASS:** Graceful error handling.

---

## Кейс 10: Typed items (function_call, function_call_output)

**Шаги:**
1. `.soba "Создай файл types-test.txt"`
2. Проверить JSONL сессии

**Ожидаемый результат:** В JSONL: `type: "function_call"` и `type: "function_call_output"`.

**Критерий PASS:** Типизированные item'ы.
