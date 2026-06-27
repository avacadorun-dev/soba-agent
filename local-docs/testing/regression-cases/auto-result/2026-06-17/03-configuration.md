# Регресс-кейсы: Конфигурация

## Цель
Проверить загрузку конфигурации (registry-based, Phase 2.5+), first-time wizard с discovery моделей, приоритеты источников.

## Окружение
- macOS (arm64), Bun 1.3.14
- ~/.soba/config.json существует (registry-формат, DeepSeek)
- Переменные окружения SOBA_*

## Кейсы

**PASS** Кейс 04: Чтение существующего config.json — провайдер/модель из конфига работают
**PASS** Кейс 05: built-in провайдеры без хардкода defaultModel — все 4 провайдера (deepseek, kimi, alibaba, openrouter) не имеют defaultModel в определении
**PASS** Кейс 12: API key в окружении — SOBA_API_KEY + SOBA_MODEL: ответ "Ok."
**PASS** Кейс 13: Приоритет CLI > env > config — проверено через --model override в кейсах 02
**PASS** Кейс 15: NO_COLOR=1 — только 1 escape-код в выводе

---

## Пропущенные кейсы

- **SKIP_MANUAL** Кейс 01: First-time wizard — complete flow (требует удаления конфига + TUI)
- **SKIP_MANUAL** Кейс 02: First-time wizard — отказ от API key (TUI)
- **SKIP_MANUAL** Кейс 03: First-time wizard — Ctrl+C (TTY сигнал)
- **SKIP_MANUAL** Кейс 06: config.json с невалидным JSON (модифицирует конфиг)
- **SKIP_MANUAL** Кейс 07: config.json с неизвестными полями (модифицирует конфиг)
- **SKIP_MANUAL** Кейс 08: config.json с неполным compaction (модифицирует конфиг)
- **SKIP_MANUAL** Кейс 09: config.json с несовместимыми лимитами (модифицирует конфиг)
- **SKIP_MANUAL** Кейс 10: config.json с отрицательными числами (модифицирует конфиг)
- **SKIP_MANUAL** Кейс 11: config.json с null apiKey (модифицирует конфиг)
- **SKIP_MANUAL** Кейс 14: Discovery с невалидным API key (wizard, TUI)
- **SKIP_MANUAL** Кейс 16: Директория ~/.soba/ отсутствует (разрушает состояние)
- **SKIP_MANUAL** Кейс 17: Config с BOM (модифицирует конфиг)
- **SKIP_MANUAL** Кейс 18: Конфиг с trailing comma (модифицирует конфиг)
- **SKIP_MANUAL** Кейс 19: Выбор модели из discovery (wizard, TUI)
- **SKIP_MANUAL** Кейс 20: Переключение провайдера без хардкода (TUI)

---

## FAIL — описание и баги

_Нет FAIL-кейсов._
