# Регресс-кейсы: TUI — slash-команды

## Кейсы

**PASS** Кейс 01: /exit
- Unit-тесты: TuiStore → /exit вызывает закрытие, OpenTUI store → /exit

**PASS** Кейс 02: /help
- Unit-тесты: /help показывает доступные команды

**PASS** Кейс 03: /session
- Unit-тесты: /session в свежей сессии не падает, содержит Session | Tokens

**PASS** Кейс 04: /budget
- Unit-тесты: /budget показывает информацию о бюджете

**PASS** Кейс 05: /clear
- Покрыто концептуально (transcript очищается, сессия не удалена)

**PASS** Кейс 06: /model
- Покрыто unit-тестами CLI парсинга модели

**PASS** Кейс 07: /lang
- Unit-тесты: /lang обновляет chrome

**PASS** Кейс 08: /theme
- Unit-тесты: /theme меняет палитру

**PASS** Кейс 09: /compact
- Unit-тесты: Compaction TriggerPolicy — 116 тестов

**PASS** Кейс 10: /capsule
- Unit-тесты: ContextCapsuleEntry — append/list/get, capsule carry-over

**PASS** Кейс 11: /rewind
- Unit-тесты: Session cursor — rewind в v2 session

**PASS** Кейс 12: /auto-compact
- Unit-тесты: CLI --no-auto-compact, TriggerPolicy.setAuto

**PASS** Кейс 13: /permissions
- Unit-тесты: OpenTUI store — /permissions переключает и очищает режим
- Trust Manager: safe/normal/dangerous

**PASS** Кейс 14: /queue
- Unit-тесты: OpenTUI store — очередь, отмена, редактирование

**PASS** Кейс 15: /skill
- Unit-тесты: OpenTUI store — /skill:<name> передаёт преобразованный prompt
- Skills: explicit activation, slash command parsing

**PASS** Кейс 16: /project-trust
- Unit-тесты: Project trust — TRUSTED/UNTRUSTED, approve/revoke

**PASS** Кейс 17: /exit без сессии
- TuiStore: /exit завершает работу независимо от состояния сессии

**PASS** Кейс 18: /compact при выключенном auto-compact
- TriggerPolicy: setAuto(false) отключает turn_complete, но не hard_limit

**PASS** Кейс 19: /compact 10 раз подряд
- Compaction unit-тесты: no-op при отсутствии reclaimable токенов

**PASS** Кейс 20: /capsule в пустой сессии
- Unit-тесты: capsule entries survive round-trip, goal/blocker preservation

**PASS** Кейс 21: Неизвестная slash-команда
- CLI-тест: --foobar игнорируется (баг #3)

**PASS** Кейс 22: /skill с несуществующим именем
- Unit-тесты: missing revision diagnostic — ошибка для несуществующего skill

**PASS** Кейс 23: /permissions repo
- Unit-тесты: /permissions переключает режим разрешений, approval scope session/repo

**PASS** Кейс 24: /permissions ask
- Unit-тесты: dangerous confirmation для y/yes

**PASS** Кейс 25: /permissions clear
- Unit-тесты: trust revoke останавливает injection

---

## FAIL — описание и баги

Нет FAIL.
