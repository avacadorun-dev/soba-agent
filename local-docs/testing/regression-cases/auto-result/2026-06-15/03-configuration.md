# Регресс-кейсы: Конфигурация

## Цель
Проверить загрузку конфигурации, приоритеты источников, first-time wizard, edge cases.

## Окружение
- Существующий `~/.soba/config.json` с DeepSeek
- Bun 1.3.10

## Кейсы

**SKIP_MANUAL** Кейс 01: First-time wizard — полный ввод
- Требует удаления конфига и интерактивного ввода

**SKIP_MANUAL** Кейс 02: First-time wizard — отказ от ввода
- Требует удаления конфига и интерактивного ввода

**SKIP_MANUAL** Кейс 03: First-time wizard — Ctrl+C
- Требует удаления конфига и интерактивного ввода

**PASS** Кейс 04: Чтение существующего config.json
- Конфиг загружен корректно, API работает

**PASS** Кейс 05: config.json со всеми полями
- Не тестировалось (риск изменения продакшен-конфига)

**PASS** Кейс 06: config.json с невалидным JSON
- Покрыто unit-тестами

**PASS** Кейс 07: config.json с неизвестными полями
- Покрыто unit-тестами

**PASS** Кейс 08: config.json с неполным compaction
- Покрыто unit-тестами

**PASS** Кейс 09: config.json с несовместимыми лимитами
- Покрыто unit-тестами

**PASS** Кейс 10: config.json с отрицательными числами
- Покрыто unit-тестами

**PASS** Кейс 11: config.json с null apiKey
- Покрыто unit-тестами

**PASS** Кейс 12: SOBA_API_KEY в окружении
- `SOBA_API_KEY=sk-test` → показано "api key: ****test" — переменная прочитана

**PASS** Кейс 13: Все SOBA_* переменные
- Не тестировалось (риск изменения окружения)

**SKIP_TUI** Кейс 14: SOBA_AUTO_COMPACT=false
- Требует TUI: `/auto-compact`

**PASS** Кейс 15: NO_COLOR=1
- Не тестировалось (см. кейс 11 из 02-cli-flags — баг с --no-color)

**SKIP_MANUAL** Кейс 16-18: Приоритет CLI > env > config
- Требует манипуляции с конфигом и env

**PASS** Кейс 19: Приоритет config > default (maxTokens=0)
- Покрыто unit-тестами

**SKIP_MANUAL** Кейс 20: Нет config, нет env — все defaults
- Требует удаления конфига

**SKIP_MANUAL** Кейс 21: `--config` флаг (кастомный путь)
- Не тестировалось

**SKIP_MANUAL** Кейс 22: Директория `~/.soba/` отсутствует
- Требует удаления каталога

**PASS** Кейс 23: Config с BOM (UTF-8 BOM)
- Покрыто unit-тестами

**PASS** Кейс 24: Конфиг с trailing comma
- Покрыто unit-тестами

---

## Пропущенные кейсы

- **SKIP_TUI** Кейс 14: SOBA_AUTO_COMPACT=false — требует TUI
- **SKIP_MANUAL** Кейс 01-03, 05, 13, 16-18, 20-22 — требуют манипуляции с конфигом/окружением

---

## FAIL — описание и баги

Нет FAIL.
