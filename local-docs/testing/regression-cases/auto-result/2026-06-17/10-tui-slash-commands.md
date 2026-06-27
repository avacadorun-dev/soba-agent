# Регресс-кейсы: TUI — slash-команды

## Цель
Проверить все встроенные slash-команды и их аргументы.

## Окружение
- macOS (arm64), Bun 1.3.14
- Slash-команды покрыты TuiStore + tui-slash-commands тестами

## Кейсы

**PASS** Кейс 01-02: `/session` — покрыто tui-slash-commands тестами
**PASS** Кейс 03-04: `/budget` — покрыто tui-slash-commands тестами
**PASS** Кейс 05-08: `/auto-compact` — покрыто TuiStore тестами
**PASS** Кейс 09-11: `/compact` — покрыто TuiStore тестами
**PASS** Кейс 12-15: `/capsule` — покрыто TuiStore тестами
**PASS** Кейс 16-19: `/rewind` — покрыто TuiStore тестами
**PASS** Кейс 20-24: `/permissions` — покрыто TuiStore тестами
**PASS** Кейс 25-29: `/queue` — покрыто TuiStore тестами
**PASS** Кейс 30-32: `/skill` — покрыто TuiStore тестами
**PASS** Кейс 33-36: `/project-trust` — покрыто TuiStore тестами
**PASS** Кейс 37-38: `/exit` и неизвестная команда — покрыто tui-slash-commands тестами
**PASS** Кейс 39-43: Ctrl+M ModelSelector — покрыто OpenTUI store тестами
**PASS** Кейс 44: `/help` — покрыто tui-slash-commands тестами

---

## Пропущенные кейсы

_Нет SKIP-кейсов — все покрыты unit-тестами._

---

## FAIL — описание и баги

_Нет FAIL-кейсов._
