# Регресс-кейсы: TUI — горячие клавиши и навигация

## Кейсы

**PASS** Кейс 01: Ctrl+C — отмена генерации
- Unit-тесты: OpenTUI Solid store — cancel вызывает abort агента, cancel останавливает активный tool

**PASS** Кейс 02: ↑/↓ — навигация по истории
- Unit-тесты: CommandHistory — добавляет и навигирует, не добавляет дубликаты, reset сбрасывает
- TuiStore test: historyNavigate(1) возвращает предыдущие команды, historyNavigate(-1) возвращает новые
- Покрыто в tests/tui-pty.test.ts (два теста на older/newer)

**PASS** Кейс 03: Tab — автодополнение
- Unit-тесты: TUI input suggestions — показывает и фильтрует slash-команды
- Показывает файлы проекта после @ и подставляет выбранный путь
- Покрыто в tests/widgets/tui/test-input-suggestions.test.ts

**SKIP_MANUAL** Кейс 04: Ctrl+W — удаление слова
- Требует эмуляции ввода с реальными key-кодами

**SKIP_MANUAL** Кейс 05: Ctrl+U — очистка строки
- Требует эмуляции ввода с реальными key-кодами

**SKIP_MANUAL** Кейс 06: Page Up/Down — скролл
- Требует рендеринга экрана для верификации скролла

**SKIP_MANUAL** Кейс 07: Home/End — в начало/конец
- Требует реального терминала

**SKIP_MANUAL** Кейс 08: Ins — режим вставки
- Требует реального терминала

**SKIP_MANUAL** Кейс 09: Alt+Enter — многострочный ввод
- Требует real TUI с MultiLineInput

---

## Пропущенные кейсы

- **SKIP_MANUAL** Кейс 04: Ctrl+W — требует эмуляции key-кодов, реальный TTY
- **SKIP_MANUAL** Кейс 05: Ctrl+U — требует эмуляции key-кодов, реальный TTY
- **SKIP_MANUAL** Кейс 06: Page Up/Down — требует рендеринга экрана
- **SKIP_MANUAL** Кейс 07: Home/End — требует реального терминала
- **SKIP_MANUAL** Кейс 08: Ins — требует реального терминала
- **SKIP_MANUAL** Кейс 09: Alt+Enter — требует MultiLineInput в реальном TUI

## FAIL — описание и баги

Нет FAIL.
