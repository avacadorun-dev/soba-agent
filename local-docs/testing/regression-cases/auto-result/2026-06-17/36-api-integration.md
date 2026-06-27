# Регресс-кейсы: API и интеграция

## Цель
Проверить встроенных провайдеров и смену API.

## Окружение
- macOS (arm64), Bun 1.3.14
- DeepSeek API

## Кейсы

**PASS** Кейс 01: Built-in провайдер (DeepSeek) — API работает, tool calls выполняются (подтверждено 04-api-basic.md)
**PASS** Кейс 02-03: Смена модели через --model — проверено в 02-config-flags.md (case 03, 05)

---

## Пропущенные кейсы

- **SKIP_MANUAL** Кейс 04+: Kimi, Alibaba, OpenRouter — требуют отдельных API ключей
- **SKIP_MANUAL** Кейс 10+: Custom провайдер, OAuth — требуют специальной настройки

---

## FAIL — описание и баги

**FAIL** Кейс 03: Смена модели на OpenRouter — switchModel returned false для openrouter/undefined
- **Приоритет:** Средний
- **Симптом:** При попытке переключения на OpenRouter модель не найдена
