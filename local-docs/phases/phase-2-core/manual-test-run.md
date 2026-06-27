# Phase 2 — Manual Test Run

**Дата:** 2026-06-14  
**Версия:** SOBA 0.3.0  
**Статус:** Готово к ручному тестированию

## Инструкция

1. Запустите каждый тест-кейс вручную
2. Заполните колонку "Результат" (✅ Pass / ❌ Fail / ⚠️ Partial)
3. Добавьте комментарии при необходимости
4. Создайте issue для найденных багов

---

## A. Session v2 и Context Capsule

### TC-A1: Session Format v2 Migration
**Цель:** Проверить автоматическую миграцию сессии v1 → v2

**Шаги:**
1. Создайте новую сессию: `bun run start`
2. Выполните несколько команд (read, write, bash)
3. Выполните `/compact` для создания первой capsule
4. Проверьте файл сессии: `cat ~/.soba/sessions/<session-id>.jsonl | jq`

**Ожидаемый результат:**
- Файл содержит `"type":"session_format_v2"` запись
- Все последующие записи используют v2 формат
- `session_cursor` записи присутствуют после каждого действия

**Результат:** _____  
**Комментарий:** _____

---

### TC-A2: Context Capsule Creation
**Цель:** Проверить создание capsule через /compact

**Шаги:**
1. Загрузите большой файл: `read package.json` (или любой >1000 строк)
2. Выполните несколько операций
3. Выполните `/compact`
4. Выполните `/capsule list`

**Ожидаемый результат:**
- Capsule создана с checkpoint ID (формат: `ck_<8 hex>`)
- `/capsule list` показывает capsule с метриками
- `/capsule show <checkpoint_id>` показывает portable state

**Результат:** _____  
**Комментарий:** _____

---

### TC-A3: Portable Rewind
**Цель:** Проверить rewind с portable continuation

**Шаги:**
1. Создайте 2-3 capsules через `/compact`
2. Выполните `/rewind` для списка checkpoints
3. Выполните `/rewind <checkpoint_id>` для возврата
4. Проверьте, что контекст восстановлен корректно
5. Продолжите работу после rewind

**Ожидаемый результат:**
- Rewind восстанавливает состояние из portable state
- Контекст содержит goal, completed, pending из capsule
- Работа продолжается без ошибок

**Результат:** _____  
**Комментарий:** _____

---

### TC-A4: Native vs Portable Continuation
**Цель:** Проверить выбор между native и portable continuation

**Шаги:**
1. Используйте OpenAI провайдер (native compaction)
2. Создайте capsule через `/compact`
3. Выполните `/capsule show <id>` — проверьте `continuation_type`
4. Переключитесь на другой провайдер: `/provider anthropic`
5. Выполните `/rewind <checkpoint_id>`

**Ожидаемый результат:**
- С OpenAI: `continuation_type: "native"`
- После смены провайдера: автоматически используется portable
- Rewind работает с portable state

**Результат:** _____  
**Комментарий:** _____

---

## B. Context Meter и Trigger Policy

### TC-B1: Context Meter Accuracy
**Цель:** Проверить точность измерения контекста

**Шаги:**
1. Выполните `/session` для просмотра метрик
2. Загрузите несколько файлов через `read`
3. Снова выполните `/session`
4. Сравните `effective_tokens` с реальным размером

**Ожидаемый результат:**
- `effective_tokens` растет после каждой операции
- `historical_tokens` показывает общий объем истории
- Метрики обновляются корректно

**Результат:** _____  
**Комментарий:** _____

---

### TC-B2: Hard Limit Protection
**Цель:** Проверить защиту от превышения hard limit

**Шаги:**
1. Установите низкий `max_tokens` в конфиге (например, 8000)
2. Загружайте файлы до приближения к лимиту
3. Проверьте, что система предупреждает о приближении к лимиту
4. Выполните `/compact` до достижения лимита

**Ожидаемый результат:**
- Система предупреждает при >80% использования
- Hard limit не превышается
- Compaction освобождает место

**Результат:** _____  
**Комментарий:** _____

---

### TC-B3: Auto-Compact Trigger
**Цель:** Проверить автоматический запуск compaction

**Шаги:**
1. Убедитесь, что `auto_compact: true` в конфиге
2. Загружайте файлы до срабатывания триггера
3. Проверьте, что compaction запускается автоматически
4. Выполните `/auto-compact off`
5. Повторите загрузку — compaction не должен запускаться

**Ожидаемый результат:**
- Auto-compact срабатывает при достижении порога
- `/auto-compact off` отключает автоматический запуск
- Manual compaction (`/compact`) работает всегда

**Результат:** _____  
**Комментарий:** _____

---

## C. Capsule Generator и Validator

### TC-C1: Deterministic Strategy
**Цель:** Проверить deterministic fallback

**Шаги:**
1. Отключите LLM провайдер (или используйте mock)
2. Выполните несколько операций
3. Выполните `/compact`
4. Проверьте содержимое capsule через `/capsule show`

**Ожидаемый результат:**
- Capsule создана с `strategy: "deterministic"`
- Portable state содержит базовую информацию
- `quality: "degraded"`

**Результат:** _____  
**Комментарий:** _____

---

### TC-C2: Portable-Only Strategy
**Цель:** Проверить генерацию portable state через LLM

**Шаги:**
1. Используйте провайдер без native compaction (например, Anthropic)
2. Выполните несколько операций с файлами
3. Выполните `/compact`
4. Проверьте содержимое capsule

**Ожидаемый результат:**
- Capsule создана с `strategy: "portable_only"`
- Portable state содержит детальную информацию:
  - goal, completed, pending
  - files_read, files_modified
  - decisions, blockers
- `quality: "portable"`

**Результат:** _____  
**Комментарий:** _____

---

### TC-C3: Native+Portable Strategy
**Цель:** Проверить гибридную стратегию

**Шаги:**
1. Используйте OpenAI провайдер
2. Выполните несколько операций
3. Выполните `/compact`
4. Проверьте содержимое capsule

**Ожидаемый результат:**
- Capsule создана с `strategy: "native_portable"`
- Содержит both native continuation и portable state
- `quality: "native"`

**Результат:** _____  
**Комментарий:** _____

---

### TC-C4: Capsule Validation
**Цель:** Проверить валидацию capsule

**Шаги:**
1. Создайте capsule через `/compact`
2. Проверьте, что capsule проходит валидацию
3. Попробуйте создать capsule с невалидным состоянием (если возможно)

**Ожидаемый результат:**
- Валидные capsules принимаются
- Невалидные capsules отклоняются с понятным сообщением
- Validation warnings логируются

**Результат:** _____  
**Комментарий:** _____

---

## D. Context Manager

### TC-D1: Blocking Protection
**Цель:** Проверить блокирующую защиту от overflow

**Шаги:**
1. Установите очень низкий `max_tokens` (например, 4000)
2. Загружайте большие файлы
3. Проверьте, что система блокирует операции при приближении к лимиту
4. Выполните `/compact` для освобождения места

**Ожидаемый результат:**
- Система блокирует операции при >90% использования
- Предупреждение показывает текущее использование и лимит
- После compaction операции снова доступны

**Результат:** _____  
**Комментарий:** _____

---

### TC-D2: Emergency Compaction
**Цель:** Проверить экстренную compaction при overflow

**Шаги:**
1. Создайте ситуацию, когда контекст превышает лимит
2. Проверьте, что система автоматически запускает emergency compaction
3. Проверьте, что операция продолжается после compaction

**Ожидаемый результат:**
- Emergency compaction запускается автоматически
- Операция не прерывается
- Логируется событие emergency compaction

**Результат:** _____  
**Комментарий:** _____

---

### TC-D3: Context Overflow Recovery
**Цель:** Проверить восстановление после context overflow

**Шаги:**
1. Создайте ситуацию context overflow
2. Проверьте, что система восстанавливается
3. Проверьте, что контекст корректно восстановлен

**Ожидаемый результат:**
- Система восстанавливается без потери данных
- Контекст содержит необходимую информацию
- Работа продолжается без ошибок

**Результат:** _____  
**Комментарий:** _____

---

## E. Background Scheduler

### TC-E1: Background Compaction
**Цель:** Проверить фоновую compaction

**Шаги:**
1. Выполните несколько операций
2. Дождитесь завершения turn
3. Проверьте, что background compaction запустилась
4. Выполните `/capsule list` для проверки

**Ожидаемый результат:**
- Background compaction запускается после завершения turn
- Не блокирует пользовательский ввод
- Capsule создается в фоне

**Результат:** _____  
**Комментарий:** _____

---

### TC-E2: Cancellation on New Turn
**Цель:** Проверить отмену background compaction

**Шаги:**
1. Запустите background compaction (загрузите много файлов)
2. Сразу начните новый turn (введите команду)
3. Проверьте, что background compaction отменена

**Ожидаемый результат:**
- Background compaction отменяется при новом user turn
- Отмена логируется
- Система продолжает работу без ошибок

**Результат:** _____  
**Комментарий:** _____

---

### TC-E3: Stale Leaf Rejection
**Цель:** Проверить отклонение устаревших операций

**Шаги:**
1. Запустите background compaction
2. Выполните несколько операций до завершения compaction
3. Проверьте, что stale compaction отклонена

**Ожидаемый результат:**
- Stale compaction отклоняется
- Логируется предупреждение о stale leaf
- Система продолжает работу с актуальным состоянием

**Результат:** _____  
**Комментарий:** _____

---

## F. Checkpoint Tool

### TC-F1: Milestone Checkpoint
**Цель:** Проверить milestone checkpoint

**Шаги:**
1. Выполните несколько операций
2. Вызовите checkpoint tool с `kind: "milestone"`
3. Проверьте, что checkpoint создан
4. Выполните `/capsule list`

**Ожидаемый результат:**
- Checkpoint создан с правильным типом
- Reason сохраняется
- Checkpoint виден в списке capsules

**Результат:** _____  
**Комментарий:** _____

---

### TC-F2: Plan Pivot Checkpoint
**Цель:** Проверить plan_pivot checkpoint

**Шаги:**
1. Выполните несколько операций
2. Вызовите checkpoint tool с `kind: "plan_pivot"`
3. Проверьте, что checkpoint создан
4. Проверьте содержимое через `/capsule show`

**Ожидаемый результат:**
- Checkpoint создан с типом `plan_pivot`
- Reason и completed/pending сохраняются
- Checkpoint можно использовать для rewind

**Результат:** _____  
**Комментарий:** _____

---

### TC-F3: Checkpoint with Agent Loop
**Цель:** Проверить интеграцию checkpoint с agent loop

**Шаги:**
1. Попросите агента выполнить сложную задачу
2. Агент должен вызвать checkpoint в процессе работы
3. Проверьте, что checkpoints создаются корректно
4. Выполните `/rewind` для проверки

**Ожидаемый результат:**
- Агент вызывает checkpoint автоматически
- Checkpoints создаются в правильных местах
- Rewind работает с checkpoints

**Результат:** _____  
**Комментарий:** _____

---

## G. Transparency Commands

### TC-G1: /session Command
**Цель:** Проверить расширенную команду /session

**Шаги:**
1. Выполните `/session`
2. Проверьте, что вывод содержит:
   - version (v1/v2)
   - capsule count
   - context manager metrics (если доступен)

**Ожидаемый результат:**
- Все метрики отображаются корректно
- Формат вывода читаемый
- Локализация работает (en/ru/zh)

**Результат:** _____  
**Комментарий:** _____

---

### TC-G2: /capsule Command
**Цель:** Проверить команду /capsule

**Шаги:**
1. Создайте несколько capsules
2. Выполните `/capsule list`
3. Выполните `/capsule show <checkpoint_id>`
4. Проверьте содержимое вывода

**Ожидаемый результат:**
- `/capsule list` показывает все capsules
- `/capsule show` показывает детальную информацию
- Поддерживается partial checkpoint ID matching

**Результат:** _____  
**Комментарий:** _____

---

### TC-G3: /auto-compact Command
**Цель:** Проверить команду /auto-compact

**Шаги:**
1. Выполните `/auto-compact` для проверки статуса
2. Выполните `/auto-compact off`
3. Проверьте, что статус изменился
4. Выполните `/auto-compact on`

**Ожидаемый результат:**
- Команда показывает текущий статус
- `off` отключает auto-compact
- `on` включает auto-compact
- Изменения применяются сразу

**Результат:** _____  
**Комментарий:** _____

---

### TC-G4: /rewind Command
**Цель:** Проверить расширенную команду /rewind

**Шаги:**
1. Создайте несколько checkpoints (compaction и capsule)
2. Выполните `/rewind` для списка
3. Выполните `/rewind <checkpoint_id>`
4. Проверьте, что контекст восстановлен

**Ожидаемый результат:**
- `/rewind` показывает все checkpoints (compaction и capsule)
- Rewind работает с обоими типами
- Контекст восстанавливается корректно

**Результат:** _____  
**Комментарий:** _____

---

## H. End-to-End Scenarios

### TC-H1: Long Session with Multiple Compactions
**Цель:** Проверить длинную сессию с несколькими compactions

**Шаги:**
1. Начните новую сессию
2. Выполните 20+ операций с файлами
3. Позвольте auto-compact сработать несколько раз
4. Выполните `/capsule list` для проверки
5. Выполните `/rewind` к первому checkpoint
6. Продолжите работу

**Ожидаемый результат:**
- Несколько capsules созданы автоматически
- Rewind работает корректно
- Работа продолжается без ошибок
- Контекст не теряется

**Результат:** _____  
**Комментарий:** _____

---

### TC-H2: Provider Switch with Rewind
**Цель:** Проверить смену провайдера с rewind

**Шаги:**
1. Используйте OpenAI провайдер
2. Создайте несколько capsules
3. Переключитесь на Anthropic: `/provider anthropic`
4. Выполните `/rewind` к capsule, созданной с OpenAI
5. Проверьте, что portable state используется

**Ожидаемый результат:**
- Rewind работает после смены провайдера
- Portable state используется вместо native continuation
- Контекст восстанавливается корректно

**Результат:** _____  
**Комментарий:** _____

---

### TC-H3: Error Recovery
**Цель:** Проверить восстановление после ошибок

**Шаги:**
1. Создайте ситуацию с ошибкой (например, неверный API ключ)
2. Исправьте ошибку
3. Проверьте, что система восстанавливается
4. Выполните несколько операций

**Ожидаемый результат:**
- Система восстанавливается после исправления ошибки
- Контекст не теряется
- Работа продолжается без перезапуска

**Результат:** _____  
**Комментарий:** _____

---

## I. Performance и Stability

### TC-I1: Memory Usage
**Цель:** Проверить использование памяти

**Шаги:**
1. Запустите SOBA
2. Выполните 50+ операций
3. Проверьте использование памяти (Activity Monitor / top)
4. Выполните несколько compactions
5. Снова проверьте память

**Ожидаемый результат:**
- Использование памяти растет линейно
- После compaction память не растет бесконечно
- Нет memory leaks

**Результат:** _____  
**Комментарий:** _____

---

### TC-I2: Large File Handling
**Цель:** Проверить работу с большими файлами

**Шаги:**
1. Загрузите файл >10000 строк
2. Выполните несколько операций с файлом
3. Выполните `/compact`
4. Проверьте, что система работает стабильно

**Ожидаемый результат:**
- Большие файлы обрабатываются корректно
- Compaction работает с большими файлами
- Нет crashes или hangs

**Результат:** _____  
**Комментарий:** _____

---

### TC-I3: Concurrent Operations
**Цель:** Проверить параллельные операции

**Шаги:**
1. Запустите background compaction
2. Сразу выполните несколько операций
3. Проверьте, что нет race conditions
4. Проверьте целостность данных

**Ожидаемый результат:**
- Нет race conditions
- Данные не повреждаются
- Система работает стабильно

**Результат:** _____  
**Комментарий:** _____

---

## J. Localization

### TC-J1: Russian Localization
**Цель:** Проверить русскую локализацию

**Шаги:**
1. Установите `lang: "ru"` в конфиге
2. Выполните все команды (/session, /capsule, /rewind, /auto-compact)
3. Проверьте, что все сообщения на русском

**Ожидаемый результат:**
- Все сообщения переведены
- Форматирование корректное
- Нет пропущенных переводов

**Результат:** _____  
**Комментарий:** _____

---

### TC-J2: Chinese Localization
**Цель:** Проверить китайскую локализацию

**Шаги:**
1. Установите `lang: "zh"` в конфиге
2. Выполните все команды
3. Проверьте, что все сообщения на китайском

**Ожидаемый результат:**
- Все сообщения переведены
- Иероглифы отображаются корректно
- Нет пропущенных переводов

**Результат:** _____  
**Комментарий:** _____

---

## K. CLI/TUI Integration (I.1-I.10)

### TC-K1: Provider Identity и Capabilities (I.1)
**Цель:** Проверить, что клиент возвращает корректную информацию о провайдере

**Шаги:**
1. Запустите SOBA с OpenAI провайдером
2. Выполните `/session` и проверьте вывод
3. Проверьте, что provider identity доступен в логах (если debug mode)

**Ожидаемый результат:**
- Клиент успешно инициализируется с provider identity
- Capabilities возвращают корректные флаги (nativeCompact, developerMessage, structuredOutput)
- Нет ошибок при старте

**Результат:** _____  
**Комментарий:** _____

---

### TC-K2: ContextManager Pre-Inference Check (I.2)
**Цель:** Проверить, что ContextManager блокирует inference при превышении hard limit

**Шаги:**
1. Установите низкий `max_tokens` в конфиге (например, 8000)
2. Загружайте большие файлы до приближения к hard limit
3. Попытайтесь выполнить следующую операцию
4. Проверьте, что система блокирует request и запускает compaction

**Ожидаемый результат:**
- Pre-inference check срабатывает перед каждым inference
- При превышении hard limit запускается blocking compaction
- Если compaction успешен, inference продолжается
- Если compaction не успешен, эмитится `context_error` event

**Результат:** _____  
**Комментарий:** _____

---

### TC-K3: Context Overflow Recovery (I.2)
**Цель:** Проверить восстановление после context overflow ошибки от провайдера

**Шаги:**
1. Создайте ситуацию, когда провайдер возвращает context_overflow ошибку
2. Проверьте, что система автоматически запускает emergency compaction
3. Проверьте, что inference повторяется один раз после compaction

**Ожидаемый результат:**
- Context overflow ошибка классифицируется корректно
- Запускается emergency compaction
- Inference повторяется один раз
- Если recovery успешен, операция продолжается
- Если recovery не успешен, эмитится `context_error` event

**Результат:** _____  
**Комментарий:** _____

---

### TC-K4: Background Scheduler после Turn Completion (I.3)
**Цель:** Проверить, что background compaction запускается после завершения turn

**Шаги:**
1. Выполните несколько операций, чтобы достичь порога auto-compact
2. Дождитесь завершения turn (агент завершает ответ)
3. Проверьте, что background compaction запустилась
4. Выполните `/capsule list` для проверки

**Ожидаемый результат:**
- После успешного завершения turn вызывается `evaluateTurnComplete()`
- Если `shouldCompact: true`, запускается background compaction
- Background compaction не блокирует пользовательский ввод
- Capsule создается в фоне

**Результат:** _____  
**Комментарий:** _____

---

### TC-K5: Background Scheduler Cancellation (I.3)
**Цель:** Проверить, что background compaction отменяется при новом user turn

**Шаги:**
1. Запустите background compaction (загрузите много файлов)
2. Сразу начните новый turn (введите команду)
3. Проверьте, что background compaction отменена

**Ожидаемый результат:**
- При начале нового user turn вызывается `scheduler.cancel("New user turn")`
- Background operation отменяется
- Отмена логируется
- Система продолжает работу без ошибок

**Результат:** _____  
**Комментарий:** _____

---

### TC-K6: Checkpoint Tool Registration (I.4)
**Цель:** Проверить, что checkpoint tool зарегистрирован и доступен

**Шаги:**
1. Запустите SOBA
2. Выполните `/help` и проверьте, что checkpoint tool доступен
3. Попросите агента выполнить сложную задачу, которая требует checkpoint
4. Проверьте, что агент вызывает checkpoint tool

**Ожидаемый результат:**
- Checkpoint tool зарегистрирован в ToolRegistry
- Tool доступен для агента
- Агент может вызывать checkpoint с `kind: "milestone"` или `kind: "plan_pivot"`
- Checkpoint event эмитится корректно

**Результат:** _____  
**Комментарий:** _____

---

### TC-K7: SkillManager Bootstrap (I.5)
**Цель:** Проверить, что SkillManager и ProjectTrustStore инициализируются при старте

**Шаги:**
1. Запустите SOBA
2. Проверьте, что bundled skills обнаружены
3. Выполните `/skill list` для проверки catalog
4. Проверьте, что project skills не читаются до trust approval

**Ожидаемый результат:**
- SkillManager инициализируется при старте CLI
- Bundled skills обнаруживаются без копирования
- `/skill list` показывает доступные skills
- Project skills не читаются до trust approval

**Результат:** _____  
**Комментарий:** _____

---

### TC-K8: Activate Skill Tool (I.6)
**Цель:** Проверить, что activate_skill tool зарегистрирован и работает

**Шаги:**
1. Запустите SOBA
2. Выполните `/skill list` для просмотра доступных skills
3. Попросите агента активировать skill через activate_skill tool
4. Проверьте, что skill активирован и добавлен в session

**Ожидаемый результат:**
- Activate skill tool зарегистрирован в ToolRegistry
- Агент может вызвать activate_skill с skill name
- Активированный skill добавляется в session entry
- Skill catalog виден в system prompt
- Ephemeral messages инжектируются только для trusted skills

**Результат:** _____  
**Комментарий:** _____

---

### TC-K9: Skill Slash Commands (I.7)
**Цель:** Проверить все skill slash commands

**Шаги:**
1. Выполните `/skill:commit-message` для активации skill
2. Выполните `/skill:commit-message "fix bug"` для активации с аргументами
3. Выполните `/skill list` для просмотра catalog
4. Выполните `/skill new test-skill` для создания draft
5. Выполните `/skill eval test-skill` для запуска evaluation
6. Выполните `/skill promote test-skill --scope=user` для promotion
7. Выполните `/project-trust status` для проверки trust status
8. Выполните `/project-trust approve` для approval проекта

**Ожидаемый результат:**
- `/skill:<name>` активирует skill и создает user message
- `/skill:<name> [args]` активирует и передает аргументы как user message
- `/skill list` показывает catalog с scopes
- `/skill new` создает draft без активации
- `/skill eval` запускает evaluation
- `/skill promote` promotes draft после approval
- `/project-trust status` показывает trust status
- `/project-trust approve` разрешает чтение project skills

**Результат:** _____  
**Комментарий:** _____

---

### TC-K10: Manual /compact через ContextManager (I.8)
**Цель:** Проверить, что /compact использует ContextManager (с fallback на legacy)

**Шаги:**
1. Выполните несколько операций с файлами
2. Выполните `/compact`
3. Проверьте, что используется ContextManager.manualCompact()
4. Проверьте, что outcome отображается в renderer

**Ожидаемый результат:**
- `/compact` вызывает `contextManager.manualCompact()` при наличии
- Fallback на legacy `compact()` работает при отсутствии contextManager
- Outcome отображается с strategy, quality, metrics
- Для v1 sessions legacy compaction продолжает работать

**Результат:** _____  
**Комментарий:** _____

---

### TC-K11: ContextManager Metrics в /session (I.9)
**Цель:** Проверить, что /session показывает ContextManager metrics

**Шаги:**
1. Выполните `/session`
2. Проверьте, что вывод содержит:
   - `effectiveTokens`
   - `historicalTokens`
   - `hardLimit`
   - `source` (provider_usage или estimated)

**Ожидаемый результат:**
- `/session` показывает ContextManager metrics при наличии
- Fallback на legacy metrics работает
- Все метрики отображаются корректно

**Результат:** _____  
**Комментарий:** _____

---

### TC-K12: Auto-Compact Runtime Toggle (I.10)
**Цель:** Проверить, что /auto-compact on|off переключает auto-compact в runtime

**Шаги:**
1. Выполните `/auto-compact` для проверки текущего статуса
2. Выполните `/auto-compact off` для отключения
3. Загрузите несколько файлов и дождитесь завершения turn
4. Проверьте, что background compaction не запускается
5. Выполните `/auto-compact on` для включения
6. Повторите загрузку файлов
7. Проверьте, что background compaction запускается

**Ожидаемый результат:**
- `/auto-compact off` отключает background compaction
- `/auto-compact on` включает background compaction
- Runtime toggle применяется сразу без перезапуска
- AgentLoop проверяет `autoCompactOverride.enabled` перед `evaluateTurnComplete()`

**Результат:** _____  
**Комментарий:** _____

---

## Summary

**Всего тест-кейсов:** 40  
**Пройдено:** _____  
**Провалено:** _____  
**Частично:** _____

**Общие замечания:**
_____

**Рекомендации:**
_____

**Подпись тестировщика:** _____  
**Дата:** _____
