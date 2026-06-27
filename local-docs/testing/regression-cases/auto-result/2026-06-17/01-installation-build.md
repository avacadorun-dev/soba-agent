# Регресс-кейсы: Установка и сборка

## Цель
Проверить, что проект устанавливается, собирается и базово работает без ошибок.

## Окружение
- macOS (arm64), Bun 1.3.14
- ~/Projects/ai-projects/soba-agent

## Кейсы

**PASS** Кейс 01: `bun install` — чистая установка (230 installs across 242 packages, no changes, 61ms)
**PASS** Кейс 02: `bun install` — повторная установка (lockfile up to date, <61ms)
**PASS** Кейс 03: `bun run build` — сборка TypeScript (dist/cli.js: 783702 bytes)
**PASS** Кейс 04: `bun run build:binary:mac-arm64` — сборка бинарника (Mach-O 64-bit executable arm64)
**PASS** Кейс 05: `soba --version` — версия 0.3.4 совпадает с package.json
**PASS** Кейс 06: `soba --help` — все флаги и команды перечислены
**PASS** Кейс 07: `bun test` — 1142 pass, 0 fail
**PASS** Кейс 08: `bun run lint` — biome check, 0 errors
**PASS** Кейс 10: Многопоточная сборка (3 раза, идентичный размер 783702 bytes)

---

## Пропущенные кейсы

- **SKIP_MANUAL** Кейс 09: `bun run dist/cli.js "Привет"` без конфига (требует first-time wizard с TTY)
- **SKIP_MANUAL** Кейс 11: `bun install` в офлайн-режиме (требует отключения сети)
- **SKIP_MANUAL** Кейс 12: `bun install` при изменённом package.json (модифицирует package.json)

---

## FAIL — описание и баги

_Нет FAIL-кейсов._
