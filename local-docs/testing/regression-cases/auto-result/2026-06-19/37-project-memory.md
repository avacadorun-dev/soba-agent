# Регресс-кейсы: Project Memory

## Цель
Проверить, что Project Memory сохраняет проектные знания, извлекает релевантный контекст для нового turn/session и не ломает системный промпт, capsule-flow и лимиты контекста.

## Окружение
- Дата прогона: 2026-06-19
- Runtime: Bun
- Тип прогона: automated targeted regression
- Команда:

```bash
bun test tests/memory/knowledge-store.test.ts tests/memory/entity-graph.test.ts tests/memory/capsule-store.test.ts tests/memory/memory-injector.test.ts tests/memory/memory-tools.test.ts tests/release/v0.4.0-dod.test.ts tests/commands.test.ts
```

## Кейсы

**PASS** Кейс 01: Knowledge Store сохраняет и ищет записи.

**PASS** Кейс 02: Entity Graph сохраняет связи между сущностями.

**PASS** Кейс 03: Capsule Store импортирует переносимое состояние.

**PASS** Кейс 04: Memory Injector формирует bounded prompt section.

**PASS** Кейс 05: Memory Tools доступны агенту.

**PASS** Кейс 06: Новый session получает знание из предыдущего session.

**PASS** Кейс 07: System Prompt получает Project Memory section.

**PASS** Кейс 08: Project Memory не ломает one-shot без memory.

---

## Пропущенные кейсы

Нет.

---

## FAIL — описание и баги

Нет.

---

## Итог

- PASS: 8
- FAIL: 0
- SKIP_MANUAL: 0
- SKIP_TUI: 0
