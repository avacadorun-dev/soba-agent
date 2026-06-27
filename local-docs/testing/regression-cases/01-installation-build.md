# Регресс-кейсы: Установка и сборка

## Цель
Проверить, что проект устанавливается, собирается и базово работает без ошибок.

## Окружение
- macOS (arm64)
- Bun (последняя стабильная версия)
- Чистый клон репозитория (опционально: модули удалены)

---

## Кейс 01: `bun install` — чистая установка

**Шаги:**
1. Удалить `node_modules` и `bun.lock` (если есть)
2. Выполнить `bun install`

**Ожидаемый результат:**
- exit code 0
- `bun.lock` создан
- `node_modules` заполнен
- Нет ошибок о missing dependencies или peer dependency conflicts

**Критерий PASS:** `bun install` завершён без ошибок, все зависимости в lock-файле.

---

## Кейс 02: `bun install` — повторная установка (lock уже есть)

**Шаги:**
1. Выполнить `bun install`

**Ожидаемый результат:**
- exit code 0
- Сообщение "Lockfile is up to date" (или аналогичное)
- `node_modules` не переустанавливается без необходимости

**Критерий PASS:** Установка мгновенная (< 2 сек), без скачивания пакетов.

---

## Кейс 03: `bun run build` — сборка TypeScript

**Шаги:**
1. Выполнить `bun run build`

**Ожидаемый результат:**
- exit code 0
- `dist/cli.js` создан
- Размер файла > 100KB
- `dist/` содержит все необходимые файлы (не только cli.js)

**Критерий PASS:** `dist/cli.js` существует, валидный JavaScript, размер > 100KB.

---

## Кейс 04: `bun run build:binary:mac-arm64` — сборка бинарника

**Шаги:**
1. Выполнить `bun run build:binary:mac-arm64`

**Ожидаемый результат:**
- exit code 0
- `dist/bin/soba-darwin-arm64` создан
- Это исполняемый Mach-O binary (проверить `file dist/bin/soba-darwin-arm64`)

**Критерий PASS:** Бинарник существует и исполняемый.

---

## Кейс 05: `.soba version` — проверка версии

**Шаги:**
1. Выполнить `bun run dist/cli.js version` или `./dist/bin/soba-darwin-arm64 version`

**Ожидаемый результат:**
- Вывод: `soba v0.3.2`
- Никаких ошибок, дополнительного вывода

**Критерий PASS:** Версия совпадает с `version` в `package.json`.

---

## Кейс 06: `.soba --help` — справка

**Шаги:**
1. Выполнить `.soba --help`

**Ожидаемый результат:**
- exit code 0
- Вывод содержит: `Usage:`, `Options:`, `Commands:`
- Все флаги: `--interactive`, `--continue`, `--session`, `--model`, `--debug`, `--budget`, `--max-tokens`, `--lang`, `--theme`, `--no-color`, `--stream`, `--no-stream`, `--no-session`, `--no-auto-compact`, `--max-agent-iterations`, `--max-stalled-iterations`, `--max-run-minutes`, `--context-window`, `--api-key`, `--base-url`, `--max-completion-tokens`
- Все команды: `version`, `help`

**Критерий PASS:** Все флаги из `src/cli/commands.ts` перечислены.

---

## Кейс 07: `bun test` — полный прогон тестов

**Шаги:**
1. Выполнить `bun test`

**Ожидаемый результат:**
- exit code 0
- Все тесты PASS (0 fail)
- Количество тестов совпадает с ожидаемым (например, 834+)

**Критерий PASS:** 0 fails, 0 errors.

---

## Кейс 08: `bun run lint` — линтинг

**Шаги:**
1. Выполнить `bun run lint` (что соответствует `biome check .`)

**Ожидаемый результат:**
- exit code 0
- Нет сообщений об ошибках

**Критерий PASS:** Biome не нашёл ошибок.

---

## Кейс 09: `bun run dist/cli.js "Привет"` — базовый запуск без конфига

**Шаги:**
1. Удалить или переименовать `~/.soba/config.json`
2. Выполнить `bun run dist/cli.js "Привет"`

**Ожидаемый результат:**
- First-time wizard: выбор провайдера из списка (OpenAI, DeepSeek, Kimi, Alibaba, OpenRouter)
- Discovery моделей через `/v1/models` выбранного провайдера
- После выбора — обычный one-shot запуск

**Критерий PASS:** Wizard запущен, провайдер выбран, модели обнаружены, не краш.

---

## Кейс 10: Многопоточная сборка

**Шаги:**
1. Выполнить `bun run build` 3 раза подряд

**Ожидаемый результат:**
- Все 3 раза exit code 0
- Идентичные бинарники/файлы

**Критерий PASS:** Идемпотентная сборка.

---

## Кейс 11: `bun install` в офлайн-режиме (если кеш есть)

**Шаги:**
1. Отключить сеть
2. Выполнить `bun install --frozen-lockfile`

**Ожидаемый результат:**
- exit code 0 (если кеш есть и lock совпадает)

**Критерий PASS:** Установка из кеша без сети.

---

## Кейс 12: `bun install` при изменённом package.json

**Шаги:**
1. Добавить новую зависимость в package.json
2. Выполнить `bun install`
3. Проверить, что зависимость установлена

**Ожидаемый результат:**
- exit code 0
- Новая зависимость в node_modules

**Критерий PASS:** Новая зависимость установлена, старые не сломаны.
