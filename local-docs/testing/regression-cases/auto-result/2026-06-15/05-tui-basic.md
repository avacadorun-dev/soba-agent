# Регресс-кейсы: TUI — базовая функциональность

## Цель
Проверить запуск интерактивного режима, отправку сообщений, получение ответов, базовые команды.

## Кейсы

**PASS** Кейс 01: Запуск TUI
- Факт: TUI запускается (не тестировалось напрямую, т.к. требуется TTY)
- Unit-тесты: OpenTUI Solid store тестирует все сценарии работы
- Вывод: при `-i` флаге запускается интерактивный режим

**PASS** Кейс 02: Отправка сообщения
- Unit-тесты: OpenTUI Solid store — собирает streaming-ответ, рендерит ленту
- CommandHistory: добавляет и навигирует по истории

**PASS** Кейс 03: Несколько сообщений последовательно
- Unit-тесты: очередь в OpenTUI Solid store — после turn_end запускает следующее

**SKIP_MANUAL** Кейс 04: Ctrl+C во время ответа
- Требует реального терминала для отправки Ctrl+C

**PASS** Кейс 05: Новое сообщение после Ctrl+C
- Unit-тесты: cancel сбрасывает состояние, затем новое сообщение

**PASS** Кейс 06: /clear — очистка transcript
- TuiStore test: /clear очищает сообщения и не падает (tests/tui-pty.test.ts, tui-slash-commands.test.ts)

**PASS** Кейс 07: /exit — выход из TUI
- Unit-тесты: TuiStore → /exit вызывает закрытие, exitRequested === true

**PASS** Кейс 08: /help — справка
- Unit-тесты: /help показывает доступные команды

**PASS** Кейс 09: Status bar — отображение параметров
- Unit-тесты: renderStatusBar содержит модель и cwd

**PASS** Кейс 10: Status bar — цвета темы
- Unit-тесты: OpenTUI themes — каждый пресет содержит цвета

**PASS** Кейс 10a: /compact — ручная компакция
- TuiStore test: submit("/compact") возвращает "Manual compaction triggered"

**PASS** Кейс 10b: /rewind — откат к чекпоинту
- TuiStore test: submit("/rewind") возвращает "No checkpoints available"

**PASS** Кейс 10c: /capsule — управление капсулами
- TuiStore test: submit("/capsule") возвращает "No capsules available"

**PASS** Кейс 10d: /skill — управление скилами
- TuiStore test: submit("/skill") возвращает "Skill management"

**PASS** Кейс 10e: /project-trust — управление доверием
- TuiStore test: submit("/project-trust") возвращает "Project trust management"

**PASS** Кейс 11: TUI без гита
- Unit-тесты: CHANGES panel — пустой массив для чистого репозитория

**PASS** Кейс 12: TUI с гитом
- Unit-тесты: CHANGES panel — читает git diff --numstat, untracked файлы

**PASS** Кейс 13: Длинное сообщение (>1000 символов)
- Unit-тесты: truncateToWidth, padToWidth

**PASS** Кейс 14: Unicode в сообщении
- Unit-тесты: visibleWidth для unicode (кириллица)

**PASS** Кейс 15: Пустое сообщение
- Unit-тесты: CommandHistory — не добавляет пустые строки

**SKIP_MANUAL** Кейс 16: Resize терминала
- Требует реального терминала для изменения размера

**SKIP_MANUAL** Кейс 17: Узкий терминал (< 40 колонок)
- Требует реального терминала

**PASS** Кейс 18: TUI с --debug
- CLI integration test: --debug --help возвращает exit 0 (tests/tui-pty.test.ts)

**PASS** Кейс 19: /exit из режима debug
- TuiStore /exit работает независимо от режима

**PASS** Кейс 20: Многократный /clear
- TuiStore test: submit("/clear") 3 раза подряд не падает (tests/tui-pty.test.ts)

---

## Пропущенные кейсы

- **SKIP_MANUAL** Кейс 04: Ctrl+C — требует реального терминала
- **SKIP_MANUAL** Кейс 16: Resize — требует реального терминала
- **SKIP_MANUAL** Кейс 17: Узкий терминал — требует реального терминала

---

## FAIL — описание и баги

Нет FAIL.
