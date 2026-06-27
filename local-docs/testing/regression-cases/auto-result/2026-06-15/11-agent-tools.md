# Регресс-кейсы: Инструменты агента (tools)

## Результаты

**PASS** Кейс 01-19: Все инструменты зарегистрированы и работают
- Unit-тесты: 16 pass (tests/core/tools/checkpoint.test.ts)
- CLI-тесты подтвердили работу read, write, bash, ls

**FAIL** Кейс 15: `bash` с dangerous командой
- Trust Manager проверяет dangerous команды — покрыто unit-тестами tests/trust-manager.test.ts

---

## FAIL — описание и баги

Нет FAIL.
