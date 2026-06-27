# Регресс-кейсы: Конфигурация

## Цель
Проверить загрузку конфигурации (registry-based, Phase 2.5+), first-time wizard с
discovery моделей через `/v1/models`, приоритеты источников, отсутствие хардкода моделей.

## Окружение
- `~/.soba/config.json` (registry-формат: activeProvider, activeModel, providers, customProviders)
- Переменные окружения `SOBA_*`
- CLI-флаги `--model`, `--api-key`, `--base-url`

## Формат config.json (Phase 2.5+)

```json
{
  "registry": {
    "activeProvider": "deepseek",
    "activeModel": "deepseek-v4-pro",
    "providers": {
      "deepseek": { "apiKey": "sk-..." },
      "openrouter": { "apiKey": "sk-..." }
    },
    "customProviders": {}
  }
}
```

Модели не хардкодятся — пользователь выбирает из списка, полученного через `GET /v1/models`.

---

## Кейс 01: First-time wizard — complete flow with discovery

**Шаги:**
1. Удалить `~/.soba/config.json`
2. `soba`
3. Выбрать провайдера из списка built-in (deepseek/kimi/alibaba/openrouter)
4. Ввести API key
5. SOBA делает discovery (`GET /v1/models`) и показывает список доступных моделей
6. Выбрать модель из списка (по номеру или id)

**Ожидаемый результат:** `~/.soba/config.json` создан в registry-формате, модель выбрана
пользователем (а не хардкод), SOBA продолжает.

**Критерий PASS:** Файл существует, содержит валидный JSON с registry, модель — не хардкод.

---

## Кейс 02: First-time wizard — отказ от API key

**Шаги:**
1. Удалить `~/.soba/config.json`
2. `soba`
3. На запрос API key: оставить пустым / нажать Enter без ввода

**Ожидаемый результат:** SOBA завершается с сообщением "API key required".

**Критерий PASS:** exit != 0, сообщение об ошибке.

---

## Кейс 03: First-time wizard — Ctrl+C при вводе

**Шаги:**
1. Удалить `~/.soba/config.json`
2. `soba`
3. На любом запросе нажать Ctrl+C

**Ожидаемый результат:** SOBA завершается, файл config не создан.

**Критерий PASS:** exit != 0, config.json не существует.

---

## Кейс 04: Чтение существующего config.json (registry-формат)

**Шаги:**
1. Создать `~/.soba/config.json`:
   ```json
   {
     "registry": {
       "activeProvider": "deepseek",
       "activeModel": "deepseek-chat",
       "providers": {
         "deepseek": { "apiKey": "sk-test" }
       },
       "customProviders": {}
     }
   }
   ```
2. `soba "Тест"`

**Ожидаемый результат:** SOBA читает конфиг, использует deepseek с моделью deepseek-chat.

**Критерий PASS:** Ответ получен, провайдер/модель из конфига.

---

## Кейс 05: config.json — built-in провайдер не содержит хардкод моделей

**Шаги:**
1. Проверить файл `src/core/provider/providers.ts`
2. У каждого built-in проверить `defaultModel` — должно быть пусто или отсутствовать

**Ожидаемый результат:** Ни один built-in провайдер не содержит хардкоднутого `defaultModel`.

**Критерий PASS:** `defaultModel ?? ""` === `""` для всех BUILTIN_PROVIDERS.

---

## Кейс 06: config.json с невалидным JSON

**Шаги:**
1. Создать `~/.soba/config.json` с содержимым `{ bad json `
2. `soba "Тест"`

**Ожидаемый результат:** Ошибка парсинга с сообщением о синтаксической ошибке.

**Критерий PASS:** Сообщение: "Error parsing config.json...".

---

## Кейс 07: config.json с неизвестными полями

**Шаги:**
1. Создать конфиг:
   ```json
   {
     "registry": {
       "activeProvider": "deepseek",
       "activeModel": "deepseek-chat",
       "providers": { "deepseek": { "apiKey": "sk-test" } },
       "customProviders": {}
     },
     "unknownField": true,
     "anotherUnknown": "value"
   }
   ```

**Ожидаемый результат:** Неизвестные поля игнорируются, без ошибок.

**Критерий PASS:** Работает без предупреждений.

---

## Кейс 08: config.json с неполным compaction

**Шаги:**
1. Создать конфиг с registry + compaction:
   ```json
   {
     "registry": {
       "activeProvider": "deepseek",
       "activeModel": "deepseek-chat",
       "providers": { "deepseek": { "apiKey": "sk-test" } },
       "customProviders": {}
     },
     "compaction": { "enabled": true }
   }
   ```

**Ожидаемый результат:** Отсутствующие поля compaction дополняются значениями по умолчанию.

**Критерий PASS:** Работает, compaction активен.

---

## Кейс 09: config.json с несовместимыми лимитами

**Шаги:**
1. Создать конфиг с registry + лимитами:
   ```json
   {
     "registry": {
       "activeProvider": "deepseek",
       "activeModel": "deepseek-chat",
       "providers": { "deepseek": { "apiKey": "sk-test" } },
       "customProviders": {}
     },
     "maxTokens": 999999999,
     "contextWindow": 100
   }
   ```

**Ожидаемый результат:** Значения clamped/capped до допустимых пределов.

**Критерий PASS:** Не падает, значения скорректированы.

---

## Кейс 10: config.json с отрицательными числами

**Шаги:**
1. Создать конфиг с registry + `"maxTokens": -100`
2. `soba "Тест"`

**Ожидаемый результат:** Значение заменено на умолчание или ошибка валидации.

**Критерий PASS:** Не падает.

---

## Кейс 11: config.json с null apiKey для активного провайдера

**Шаги:**
1. Создать конфиг:
   ```json
   {
     "registry": {
       "activeProvider": "deepseek",
       "activeModel": "deepseek-chat",
       "providers": { "deepseek": { "apiKey": null } },
       "customProviders": {}
     }
   }
   ```

**Ожидаемый результат:** Запускается wizard или ошибка "API key required".

**Критерий PASS:** wizard или сообщение об ошибке.

---

## Кейс 12: API key в окружении (без config.json)

**Шаги:**
1. Удалить config.json
2. `SOBA_MODEL=deepseek-chat SOBA_DEEPSEEK_API_KEY=sk-test soba "Тест"`

**Ожидаемый результат:** Ключ и модель из окружения.

**Критерий PASS:** Ответ получен.

---

## Кейс 13: Приоритет CLI > env > config (model)

**Шаги:**
1. config.json: `activeModel: "deepseek-chat"`
2. `SOBA_MODEL=deepseek-v4-pro soba --model deepseek-reasoner "Тест"`

**Ожидаемый результат:** Используется `deepseek-reasoner` (CLI).

**Критерий PASS:** Проверить по логам.

---

## Кейс 14: Discovery с невалидным API key

**Шаги:**
1. Создать конфиг с невалидным API key для built-in провайдера
2. `soba` → wizard пытается discovery → ошибка
3. Пользователь вводит модель вручную

**Ожидаемый результат:** При ошибке discovery пользователь может ввести модель руками.

**Критерий PASS:** Wizard предлагает ввод модели вручную.

---

## Кейс 15: NO_COLOR=1

**Шаги:**
1. `NO_COLOR=1 soba "Тест"`

**Ожидаемый результат:** Вывод без ANSI-цветов.

**Критерий PASS:** Нет escape-кодов 1b.

---

## Кейс 16: Директория `~/.soba/` отсутствует

**Шаги:**
1. `rm -rf ~/.soba/`
2. `soba --model deepseek-chat --api-key sk-test "Тест"`

**Ожидаемый результат:** Директория создаётся при необходимости.

**Критерий PASS:** `~/.soba/` существует после запуска.

---

## Кейс 17: Config с BOM (UTF-8 BOM)

**Шаги:**
1. Создать config.json с BOM-символом \uFEFF в начале
2. `soba "Тест"`

**Ожидаемый результат:** BOM игнорируется, конфиг загружен.

**Критерий PASS:** Работает.

---

## Кейс 18: Конфиг с trailing comma

**Шаги:**
1. Создать config.json с trailing comma (запятая после последнего поля)
2. `soba "Тест"`

**Ожидаемый результат:** Ошибка парсинга JSON.

**Критерий PASS:** Сообщение об ошибке.

---

## Кейс 19: Выбор модели — из списка discovery, не хардкод

**Шаги:**
1. Создать конфиг с valid API key для провайдера (deepseek/kimi/etc.)
2. Убедиться что activeModel пуст (модель ещё не выбрана)
3. `soba` → wizard делает discovery → показывает список из `/v1/models`
4. Пользователь выбирает модель из списка

**Ожидаемый результат:** Модель выбрана из живого API, а не хардкод.

**Критерий PASS:** Выбранная модель есть в ответе `/v1/models`.

---

## Кейс 20: Переключение провайдера без хардкода defaultModel

**Шаги:**
1. Конфиг с activeProvider: "deepseek", activeModel: "deepseek-chat"
2. `soba` → `Ctrl+M` → переключиться на "kimi"
3. SOBA делает discovery для kimi → показывает список моделей из `/v1/models`

**Ожидаемый результат:** Модели kimi получены через discovery, нет хардкоднутой kimi-k2.

**Критерий PASS:** Список моделей из `/v1/models`, а не один хардкоднутый вариант.
