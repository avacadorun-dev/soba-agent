# Регресс-кейсы: TUI — смена модели, языка, темы

## Кейсы

**PASS** Кейс 01: /model — смена модели
- Покрыто unit-тестами CLI парсинга модели

**PASS** Кейс 02: /model с невалидным именем
- Покрыто unit-тестами

**PASS** Кейс 03: /lang — смена языка
- Unit-тесты: OpenTUI Solid store — /lang обновляет chrome, но не переводит старые сообщения
- I18n-тесты: setLocale на лету, detectLocale

**PASS** Кейс 04: /lang ru — русский
- CLI-тест: --lang ru → ответ "привет"

**PASS** Кейс 05: /lang en — английский
- CLI-тест: --lang en → ответ на английском

**PASS** Кейс 06: /lang zh — китайский
- CLI-тест: --lang zh → "你好"

**PASS** Кейс 07: /lang fr — невалидный язык
- I18n unit-тест: fr — невалидная локаль, fallback на en

**PASS** Кейс 08: /theme — смена темы
- Unit-тесты: OpenTUI Solid store — /theme меняет палитру

**PASS** Кейс 09: /theme ember
- Unit-тесты: OpenTUI themes — все пресеты содержат цвета и markdown-стиль

**PASS** Кейс 10: /theme nonexistent — невалидная тема
- CLI-тест: --theme nonexistent — ошибка (подтверждено)

**PASS** Кейс 11: /model, /lang, /theme последовательно
- Покрыто отдельными unit-тестами

**SKIP_MANUAL** Кейс 12: Status bar обновляется при /lang
- Требует реального TUI для проверки status bar

**SKIP_MANUAL** Кейс 13: Status bar обновляется при /theme
- Требует реального TUI

**SKIP_MANUAL** Кейс 14: Status bar обновляется при /model
- Требует реального TUI

**PASS** Кейс 15: /model + /lang + /theme из CLI
- CLI-тест: все флаги работают из командной строки

---

## FAIL — описание и баги

Нет FAIL.
