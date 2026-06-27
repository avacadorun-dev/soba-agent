# Phase 3 — Use Cases (User Stories)

**Всего:** 6 use cases (UC-3.1 — UC-3.6)

> **Примечание:** Use cases UC-3.1–UC-3.10 (TUI/UX: Notifications, TrustDialog, ModelSelector,
> Enhanced Sidebar, Collapsible Results, Turn Separator, Context Visualizer, Search, Hotkeys Help,
> ~~Session Browser~~ (исключено)) вынесены в Phase 2.5 — `docs/phase-2.5-tui-ux/use-cases.md`.

---

## UC-3.1: Knowledge Store — чтение памяти проекта

**Актор:** Агент SOBA
**Предусловие:** В `.soba/memory/knowledge/` есть хотя бы один файл

**Основной сценарий:**
1. Пользователь запускает новую сессию
2. SOBA buildSystemPrompt() вызывает MemoryInjector
3. MemoryInjector читает файлы из `.soba/memory/knowledge/`
4. Форматирует секцию `<project_knowledge>` с architecture.md, conventions.md
5. Prompt передаётся провайдеру

**Альтернативный сценарий (пустая память):**
1. `.soba/memory/knowledge/` пуст или не существует
2. MemoryInjector возвращает пустую строку
3. System prompt не содержит `<project_knowledge>`

**Исключение (большой объём):**
1. Суммарный размер > budget (2000 tokens)
2. MemoryInjector включает только самые важные файлы (architecture > conventions)
3. Остальные файлы доступны через `read_project_memory` tool

**Критерии приёмки:**
- Создание шаблонов 4 файлов при первом запуске
- Чтение и форматирование существующих файлов
- Пустые файлы → пустая строка
- При привышении budget — priority-based inclusion
- Обновление через write

---

## UC-3.2: Капсулы памяти — запись и чтение структурированной памяти

**Актор:** Агент SOBA
**Предусловие:** ProjectMemory инициализирован

**Основной сценарий:**
1. Агент вызывает `write_project_memory` с капсулой
2. CapsuleStore сохраняет: `capsules/{id}.json` + обновляет `index.json`
3. Капсула имеет type, priority, tags, summary, content
4. При следующей сессии MemoryInjector включает релевантные капсулы

**Альтернативный сценарий (pruning):**
1. Капсул стало > 50
2. CapsuleStore удаляет старые low-приоритетные (>30 дней)
3. critical-капсулы никогда не удаляются

**Альтернативный сценарий (relevance):**
1. MemoryInjector запрашивает капсулы с tags matching текущему контексту
2. CapsuleStore.getRelevant сортирует: tags match + recency + priority
3. Возвращает топ-10 релевантных капсул

**Критерии приёмки:**
- Капсула сохраняется и читается
- index.json корректен
- Pruning удаляет только старые low/medium
- critical не удаляются никогда
- Relevance работает (tags + recency + priority)

---

## UC-3.3: Entity Graph — граф сущностей проекта

**Актор:** Агент SOBA
**Предусловие:** ProjectMemory инициализирован

**Основной сценарий:**
1. Агент запрашивает информацию о сущности (например, функция `parseCSV`)
2. System prompt содержит `read_project_memory type: "graph", filter: "parseCSV"`
3. EntityGraph возвращает neighbours (все файлы и функции, связанные с parseCSV)
4. Prompt содержит контекст графа

**Критерии приёмки:**
- Node создаётся с типом и метаданными
- Edge создаётся между двумя нодами
- getNode возвращает корректную ноду
- getNeighbors возвращает все связанные ноды
- save/load сохраняет и восстанавливает граф
- Пустой граф не вызывает ошибок

---

## UC-3.4: Fix-Until-Green — автоисправление кода

**Актор:** Пользователь SOBA → Агент SOBA → Fix-Until-Green loop
**Предусловие:** Проект имеет test/lint команды (определены CommandDetector)

**Основной сценарий:**
1. Пользователь: «напиши функцию parseCSV»
2. Агент пишет код (write/edit) и запускает bash
3. Fix-Until-Green автоматически запускает `bun test`
4. Тесты падают с 3 ошибками
5. ErrorDiagnostics парсит ошибки: TypeError в parse.ts:23
6. LLM генерирует фикс
7. Агент применяет фикс
8. Attempt 2: запуск `bun test` → 1 ошибка (import path)
9. LLM чинит import
10. Attempt 3: 🟢 All tests pass
11. Auto-Extractor создаёт капсулу `type: "fix"` с ошибкой + фиксом
12. FixProgress показывает: ✅ 3 attempts, 12.4s, 8,432 tokens

**Альтернативный сценарий (проект без тестов):**
1. CommandDetector не находит test команды
2. Fallback: lint → build → runtime check
3. Ничего не найдено → Fix-Until-Green не запускается

**Альтернативный сценарий (превышение лимита):**
1. FixUntilGreenLoop превышает maxTokens или maxAttempts
2. Фикс останавливается с partialFix: true
3. Уведомление: "Fix-Until-Green: partially fixed (2/3 errors resolved)"
4. Auto-Extractor сохраняет прогресс

**Исключение (невозможная ошибка):**
1. После 3 attempts ошибка остаётся
2. FixResult: success: false, lastError: "TypeError: cannot read property..."
3. FixProgress показывает: 🔴 3 attempts failed
4. Агент сообщает пользователю: «не удалось починить — требуется ручное вмешательство»

**Критерии приёмки:**
- CommandDetector определяет test команды для JS/TS, Rust, Python, Go
- ErrorDiagnostics парсит TS, test, lint, runtime ошибки
- FixUntilGreenLoop: generate → run → detect → fix → repeat (max 3)
- Budget-aware (maxTokens, maxAttempts)
- Partial progress: если стало лучше — доп итерация
- /fix on/off переключает фичу
- Auto-Extractor создаёт капсулы

---

## UC-3.5: Project Memory — память между сессиями

**Актор:** Пользователь SOBA
**Предусловие:** Есть предыдущая сессия с капсулами в `.soba/memory/`

**Основной сценарий:**
1. Пользователь завершает сессию (компакция или /exit)
2. ProjectMemory.save() сохраняет все капсулы и граф
3. Пользователь запускает новую сессию
4. ProjectMemory.load() восстанавливает состояние
5. MemoryInjector формирует `<project_knowledge>` и `<project_memory>` секции
6. Агент знает архитектуру, конвенции и предыдущие фиксы
7. Пользователь: «добавь feature X» — агент знает проект без изучения заново

**Критерии приёмки:**
- Сохранение памяти между сессиями
- Восстановление при новой сессии
- Инжекция в system prompt
- Токен-лимиты не превышают budget
- Auto-Extractor наполняет память автоматически

---

## UC-3.6: CI/CD Pipeline — непрерывная интеграция

**Актор:** Разработчик SOBA
**Предусловие:** Git-репозиторий

**Основной сценарий (pre-commit):**
1. Разработчик запускает `git commit`
2. Pre-commit hook: `biome check --write` → `tsc --noEmit` → `bun test`
3. Если всё ок — commit проходит

**Основной сценарий (CI):**
1. Разработчик пушит в main
2. GitHub Actions: `biome check` → `bun test` → `bun run build`
3. Зелёный статус

**Основной сценарий (release):**
1. Разработчик запускает `bun run release`
2. Версия инкрементируется
3. Changelog генерируется
4. Бинарники собираются для macOS и Linux
5. GitHub release с assets

**Критерии приёмки:**
- Pre-commit hook установлен
- CI pipeline проходит
- Release pipeline создаёт релиз
- 0 ошибок линтера
- Все тесты зелёные
- Сборка проходит
