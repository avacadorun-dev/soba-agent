# Регресс-кейсы: Project Memory

## Цель
Проверить, что Project Memory сохраняет проектные знания, извлекает релевантный контекст для нового turn/session и не ломает системный промпт, capsule-flow и лимиты контекста.

## Окружение
- SOBA собран через `bun run build`
- Тесты запускаются через `bun test`
- Для автоматического прогона используется временный `SOBA_HOME` или изолированный temp-dir
- Реальный API не обязателен для unit/integration-кейсов; WOW-кейс покрывается мок-провайдером в release DoD

---

## Кейс 01: Knowledge Store сохраняет и ищет записи

**Шаги:**
1. Запустить `bun test tests/memory/knowledge-store.test.ts`

**Ожидаемый результат:** Записи создаются, читаются, фильтруются и ранжируются без ошибок.

**Критерий PASS:** Тесты завершаются с exit 0.

---

## Кейс 02: Entity Graph сохраняет связи между сущностями

**Шаги:**
1. Запустить `bun test tests/memory/entity-graph.test.ts`

**Ожидаемый результат:** Сущности и связи проекта сохраняются и доступны для поиска.

**Критерий PASS:** Тесты завершаются с exit 0.

---

## Кейс 03: Capsule Store импортирует переносимое состояние

**Шаги:**
1. Запустить `bun test tests/memory/capsule-store.test.ts`

**Ожидаемый результат:** Capsule-derived знания попадают в memory без потери обязательных полей.

**Критерий PASS:** Тесты завершаются с exit 0.

---

## Кейс 04: Memory Injector формирует bounded prompt section

**Шаги:**
1. Запустить `bun test tests/memory/memory-injector.test.ts`

**Ожидаемый результат:** Memory section ограничена бюджетом, содержит релевантные знания и не дублирует нерелевантные записи.

**Критерий PASS:** Тесты завершаются с exit 0.

---

## Кейс 05: Memory Tools доступны агенту

**Шаги:**
1. Запустить `bun test tests/memory/memory-tools.test.ts`

**Ожидаемый результат:** Tools для чтения/записи Project Memory зарегистрированы и валидируют входные данные.

**Критерий PASS:** Тесты завершаются с exit 0.

---

## Кейс 06: Новый session получает знание из предыдущего session

**Шаги:**
1. Запустить `bun test tests/release/v0.4.0-dod.test.ts`

**Ожидаемый результат:** Агент в новом session использует сохранённое архитектурное знание без повторного объяснения пользователем.

**Критерий PASS:** WOW-кейс Project Memory в release DoD проходит.

---

## Кейс 07: System Prompt получает Project Memory section

**Шаги:**
1. Запустить `bun test tests/release/v0.4.0-dod.test.ts`
2. Проверить, что `AgentLoop` передаёт `projectMemorySection` в `buildSystemPrompt`

**Ожидаемый результат:** Prompt содержит bounded Project Memory section при наличии релевантных знаний.

**Критерий PASS:** Release DoD тест проходит; `bunx tsc --noEmit` не выявляет несовместимость типов.

---

## Кейс 08: Project Memory не ломает one-shot без memory

**Шаги:**
1. Запустить `bun test tests/commands.test.ts`
2. Запустить `bun test tests/release/v0.4.0-dod.test.ts`

**Ожидаемый результат:** CLI и AgentLoop работают как с Project Memory, так и без неё.

**Критерий PASS:** Оба тестовых файла проходят.
