# Регресс-кейсы: Установка и сборка

## Цель
Проверить, что проект устанавливается, собирается и базово работает без ошибок.

## Окружение
- macOS (arm64)
- Bun 1.3.10
- Проект собран, модули установлены

## Кейсы

**PASS** Кейс 01: `bun install` — чистая установка
- `bun install` завершён за 59ms, 219 installs across 232 packages

**PASS** Кейс 02: `bun install` — повторная установка
- "Checked 219 installs across 232 packages (no changes)" — мгновенно

**PASS** Кейс 03: `bun run build` — сборка TypeScript
- exit 0, `dist/cli.js` 614897 bytes > 100KB

**PASS** Кейс 04: `bun run build:binary:mac-arm64` — сборка бинарника
- exit 0, `dist/bin/soba-darwin-arm64` создан (69MB, Mach-O 64-bit executable arm64)

**PASS** Кейс 05: `.soba version` — проверка версии
- `--version` → "soba v0.3.2"
- `version` как prompt уходит в агент (не баг — так спроектировано)

**PASS** Кейс 06: `.soba --help` — справка
- exit 0, все флаги и команды перечислены

**PASS** Кейс 07: `bun test` — полный прогон тестов
- 862 pass, 0 fail

**PASS** Кейс 08: `bun run lint` — линтинг
- 0 errors (2 infos — biome deprecation warnings, не ошибки)

**SKIP_MANUAL** Кейс 09: First-time wizard
- Требует удаления конфига и интерактивного ввода

**PASS** Кейс 10: Многопоточная сборка (3 раза подряд)
- Все 3 раза exit 0, идентичный размер 614897 bytes

**SKIP_MANUAL** Кейс 11: Офлайн-установка
- Требует отключения сети

**SKIP_MANUAL** Кейс 12: Изменённый package.json
- Требует модификации проекта

---

## Пропущенные кейсы

- **SKIP_MANUAL** Кейс 09: First-time wizard — требует удаления конфига и интерактивного ввода
- **SKIP_MANUAL** Кейс 11: Офлайн-установка — требует отключения сети
- **SKIP_MANUAL** Кейс 12: Изменённый package.json — требует модификации проекта

---

## FAIL — описание и баги

Нет FAIL.
