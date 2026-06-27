# Регресс-кейсы: CLI-флаги и аргументы

## Цель
Проверить все флаги командной строки и их комбинации.

## Окружение
- macOS (arm64), Bun 1.3.14
- Собранный бинарник (dist/cli.js)
- ~/.soba/config.json с DeepSeek API key
- Реальный DeepSeek endpoint

## Кейсы

**PASS** Кейс 01: `--version` — soba v0.3.4
**PASS** Кейс 02: `--help` — все флаги и команды перечислены
**PASS** Кейс 03: `--model deepseek-chat` — ответ "ok"
**PASS** Кейс 04: `--model` без аргумента — показывает справку, не интерпретирует промпт как модель
**PASS** Кейс 05: `--base-url` — переопределение эндпоинта работает
**PASS** Кейс 06: `--base-url` невалидный — graceful error "Unable to connect"
**PASS** Кейс 07: `--api-key` — ответ получен
**PASS** Кейс 08: `--lang ru` — ответ "Привет"
**PASS** Кейс 09: `--lang en` — ответ "hello"
**PASS** Кейс 10: `--lang zh` — ответ "你好"
**PASS** Кейс 11: `--no-color` — ANSI escape-коды минимальны
**PASS** Кейс 12: `--stream` — частичный вывод виден (чанки)
**PASS** Кейс 13: `--no-stream` — полный вывод одним блоком
**PASS** Кейс 14: `--stream --no-stream` — последний флаг побеждает, не падает
**PASS** Кейс 15: `--max-output-tokens 20` — ответ "hello" (короткий)
**PASS** Кейс 16: `--max-output-tokens 0` — "yes", без лимита
**PASS** Кейс 17: `--max-completion-tokens 50` — "ok"
**PASS** Кейс 18: `--context-window 32000` — "Yes.", без ошибок
**PASS** Кейс 19: `--context-window 0` — "yes"
**PASS** Кейс 20: `--budget 1000` — история сгенерирована, бюджет не превышен
**PASS** Кейс 21: `--budget 99999999` — "Да", без сообщений о превышении
**PASS** Кейс 22: `--budget 0` — "yes", бюджет не применяется
**PASS** Кейс 23: `--max-agent-iterations 2` — лимит enforced (loop-guard stop)
**PASS** Кейс 24: `--max-agent-iterations 0` — "yes", без лимита
**PASS** Кейс 27: `--max-run-minutes 0.1` — ответ получен в пределах времени
**PASS** Кейс 28: `--max-run-minutes 0` — "Yes.", без лимита
**PASS** Кейс 29: `--no-session` — сессия не создана (число сессий не изменилось)
**PASS** Кейс 30: `--debug` — debug-вывод присутствует (модель, тайминги)
**PASS** Кейс 32: `-c` / `--continue` — агент помнит контекст ("Вас зовут Регресс")
**PASS** Кейс 33: `-c` без предыдущей сессии — продолжает последнюю сессию, не падает
**PASS** Кейс 35: `-s <session-id>` — сессия восстановлена ("Вас зовут Регресс")
**PASS** Кейс 36: `-s <prefix>` — сессия найдена по префиксу ("Вас зовут Регресс")
**PASS** Кейс 39: `--foobar` — "Unknown flag --foobar", exit=1
**PASS** Кейс 40: `-m deepseek-chat` — "Yes" (короткий флаг работает)
**PASS** Кейс 41: Пустой промпт — показывает справку, не падает
**PASS** Кейс 42: Промпт из stdin — "Yes"
**PASS** Кейс 43: Комбинация всех флагов — "Hello! I'm SOBA Agent..."
**PASS** Кейс 44: `-m` == `--model` — "Yes"
**PASS** Кейс 45: `soba provider list` — список провайдеров (deepseek, kimi, alibaba, openrouter)
**PASS** Кейс 46: `soba provider show deepseek` — валидный JSON
**PASS** Кейс 47: `soba provider show nonexistent` — "Provider not found", exit=1
**PASS** Кейс 49: `soba provider add deepseek` (дубликат) — "already exists", exit=1
**PASS** Кейс 52: `soba provider remove deepseek` (built-in) — "cannot be removed", exit=1
**PASS** Кейс 54: `soba provider use no-such-provider` — "not found", exit=1
**PASS** Кейс 56: `SOBA_MODEL=deepseek-chat` — env var работает, "Yes"
**FAIL** Кейс 38: `--theme nonexistent -i` — TUI запустился с темой по умолчанию, вместо ошибки
**FAIL** Кейс 53: `soba provider use openrouter` — "Internal error: switchModel returned false for openrouter/undefined"

---

## Пропущенные кейсы

- **SKIP_MANUAL** Кейс 25: `--max-stalled-iterations` — stall recovery (трудно воспроизвести)
- **SKIP_MANUAL** Кейс 26: `--max-stalled-iterations 0` — без детекции (трудно воспроизвести)
- **SKIP_MANUAL** Кейс 31: `--no-auto-compact -i` — требует TUI
- **SKIP_MANUAL** Кейс 34: `-r` — интерактивный выбор сессии (TUI)
- **SKIP_MANUAL** Кейс 37: `--theme ember -i` — требует визуальной верификации TUI
- **SKIP_MANUAL** Кейс 48: `soba provider add <id>` — модифицирует config.json
- **SKIP_MANUAL** Кейс 50: `soba provider add --from-file` — требует создания файла
- **SKIP_MANUAL** Кейс 51: `soba provider remove <id>` — модифицирует config.json
- **SKIP_MANUAL** Кейс 55: `soba provider use` persistence — требует перезапуска терминала

---

## FAIL — описание и баги

### Баг: Кейс 38: `--theme nonexistent -i` не выдаёт ошибку

**Статус:** Не исправлено
**Приоритет:** Низкий
**Задача:** Несуществующая тема должна вызывать ошибку парсинга/валидации, а не молча запускать TUI с темой по умолчанию.

### Баг: Кейс 53: `soba provider use openrouter` — switchModel returned false

**Статус:** Не исправлено
**Приоритет:** Средний
**Задача:** Переключение на провайдера OpenRouter падает с "Internal error: switchModel returned false for openrouter/undefined". Модель не определяется после переключения провайдера.
