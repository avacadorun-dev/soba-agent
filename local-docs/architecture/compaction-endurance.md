# Compaction — Endurance Use Cases

## Сценарий: Phase-long рефакторинг модуля авторизации

**Контекст:** Senior Engineer (Алексей) рефакторит модуль авторизации в монорепозитории на 50K строк. Использует SOBA Agent
в интерактивном режиме. Провайдер — OpenAI-compatible API с context window 128K, без native compaction.

**Длительность сценария:** ~90 минут, 12 задач, >100K токенов диалога, 4-5 компакций.

**Цель:** убедиться, что каждый компонент compaction-системы отрабатывает корректно в боевых условиях.

---

## Use Case 0: Валидация конфигурации на старте

**Что должно произойти:**

1. SOBA стартует с провайдером, у которого contextWindow=128K, maxOutputTokens=16K, safetyReserveTokens=120K
2. `validateCompactionConfig()` обнаруживает: maxOutputTokens + safetyReserveTokens (136K) >= contextWindow (128K)
3. SOBA отказывается стартовать с диагностическим сообщением
4. Алексей исправляет safetyReserveTokens на 8K
5. SOBA стартует успешно

**Какие компоненты проверяются:**

- `validateCompactionConfig()` — инварианты безопасности
- Обработка ошибки конфигурации до начала inference

**Верификация:**

- SOBA не запускает inference с заведомо нерабочей конфигурацией
- Диагностическое сообщение указывает причину

---

## Use Case 1: Provider-based точное измерение

**Что должно произойти:**

1. Алексей делает 5 запросов с чтением файлов, правками и тестами
2. После каждого запроса `recordProviderUsage()` сохраняет реальные inputTokens от провайдера и requestFingerprint
3. `ContextMeter.snapshot()` возвращает `source: "provider_usage"`
4. EffectiveTokens = реальные providerInputTokens + оценочные trailingTokens (новые элементы после watermark)
5. Алексей вводит `/session` → видит `source: provider_usage`, watermark fingerprint, effectiveTokens

**Какие компоненты проверяются:**

- `ContextMeter.recordProviderUsage()` — запись реальных токенов
- `ContextMeter.snapshot()` — гибридный режим (provider + trailing estimate)
- `ContextMeter._estimateTrailingTokens()` — оценка только элементов после watermark
- Команда `/session` — прозрачность контекста

**Верификация:**

- `/session` показывает `source: provider_usage` пока fingerprint совпадает
- EffectiveTokens ≈ providerInputTokens + недавние сообщения (не все исторические)

---

## Use Case 2: Watermark инвалидация при смене skills

**Что должно произойти:**

1. Алексей активирует skill `ts-morph-analyzer` командой `/skill:ts-morph-analyzer`
2. System prompt меняется → requestFingerprint меняется
3. `ContextMeter.invalidateWatermark()` сбрасывает watermark
4. Следующий `snapshot()` возвращает `source: "estimated"`
5. `/session` показывает `source: estimated`

**Какие компоненты проверяются:**

- `ContextMeter.invalidateWatermark()` — сброс при изменении fingerprint
- Переключение режима измерения с provider_usage на estimated
- `/session` отражает актуальный источник метрики

**Верификация:**

- После активации skill → source меняется на estimated
- EffectiveTokens пересчитываются локально

---

## Use Case 3: Hard-limit blocking compaction

**Что должно произойти:**

1. После 15+ сообщений контекст раздувается до ~95K эффективных токенов
2. hardLimit = 128K - 16K - 8K = 104K (пока не превышен)
3. Очередной большой вывод тестов (~15K токенов) приводит к effectiveTokens ≈ 108K
4. Перед следующим inference `preInferenceCheck()` выполняет snapshot
5. `TriggerPolicy.evaluateHardLimit()` → shouldCompact=true, trigger=hard_limit
6. `ContextManager._performCompaction()`:
   - `findCutPoint()` находит точку разреза (последнее user-сообщение после накопления 20K токенов)
   - CapsuleGenerator пробует portable-only стратегию (native недоступен)
   - CapsuleValidator проверяет: цель сохранена, блокировки не потеряны, tool calls не разорваны, estimatedTokensAfter < hardLimit
   - Капсула добавляется в сессию
7. Post-compaction snapshot: effectiveTokens ≈ 28K (капсула + 20K свежего контекста)
8. Inference продолжается без ошибки

**Какие компоненты проверяются:**

- `ContextManager.preInferenceCheck()` — блокирующая проверка
- `TriggerPolicy.evaluateHardLimit()` — триггер по превышению hardLimit
- `findCutPoint()` — алгоритм выбора точки разреза
- `CapsuleGenerator.generate()` — portable-only стратегия
- `CapsuleValidator.validate()` — все критические проверки
- `ContextMeter.snapshot()` — пост-компакшен измерение
- `SessionManager.appendContextCapsule()` — запись капсулы

**Верификация:**

- Сессия продолжается БЕЗ context overflow от провайдера
- Капсула содержит: goal, pending, blockers, nextSteps
- `/session` показывает checkpoint и уменьшенные effectiveTokens
- Post-compaction effectiveTokens < hardLimit
- Ни один tool call не был разорван на границе разреза

---

## Use Case 4: Context overflow recovery

**Что должно произойти:**

1. Алексей работает с провайдером, который имеет context window 64K (а не 128K)
2. EffectiveTokens достигает 50K — ниже hardLimit=40K (64K-16K-8K)
3. `evaluateHardLimit()` возвращает shouldCompact=true
4. **Но** блокирующая компакция не запущена вовремя (баг в integration, или watermark был невалиден и estimated промахнулась)
5. Провайдер возвращает ошибку `context_length_exceeded` / HTTP 400
6. Adapter классифицирует ошибку как `context_overflow`
7. `ContextManager.handleContextOverflow()`:
   - Emergency snapshot
   - `TriggerPolicy.evaluateContextOverflow()` → shouldCompact=true независимо от auto
   - Блокирующая компакция с portable-only стратегией
   - Валидация: estimatedTokensAfter < hardLimit
   - Капсула добавлена
8. `recovered: true, shouldRetry: true`
9. SOBA повторяет запрос — успешно

**Какие компоненты проверяются:**

- `ContextManager.handleContextOverflow()` — emergency recovery
- `TriggerPolicy.evaluateContextOverflow()` — всегда true, игнорирует auto
- Классификация ошибки провайдера как context_overflow
- Retry после компакции

**Верификация:**

- После overflow SOBA не падает, а восстанавливается
- Второй запрос (retry) успешен
- В логах виден trigger: context_overflow

---

## Use Case 5: Background compaction с отменой при новом вводе

**Что должно произойти:**

1. Алексей завершает большую задачу (эффективные токены ~75K, reclaimable ~55K, savingsRatio ~73%)
2. `evaluateTurnComplete()` → shouldCompact=true (ROI: savingsRatio 73% > 25%, reclaimable 55K > 12K, effectiveTokens 75K > 32K)
3. `BackgroundScheduler.schedule()` запускает фоновую операцию
4. Пользователь видит итоговый ответ агента БЕЗ задержки
5. Через 2 секунды (компакция ещё идёт) Алексей вводит новый запрос
6. `BackgroundScheduler.cancel("New user turn")` — abortController.abort()
7. `_runOperation()` ловит abort → операция отменяется
8. Следующий turn начинается с полным контекстом (капсула не создана)
9. Через 30 минут effectiveTokens достигает hardLimit → срабатывает blocking compaction (UC-3)

**Какие компоненты проверяются:**

- `TriggerPolicy.evaluateTurnComplete()` — ROI-анализ
- `BackgroundScheduler.schedule()` — запуск фоновой операции
- `BackgroundScheduler.cancel()` — отмена при новом вводе
- `_runOperation()` — Promise.race с AbortController
- Отсутствие race condition: старый leaf не портится

**Верификация:**

- Пользователь не ждёт компакцию после ответа
- При новом вводе фоновая компакция отменяется
- Сессия не повреждена (leaf не изменился до завершения)
- Позже срабатывает blocking compaction при достижении hardLimit

---

## Use Case 6: Background compaction успевает до нового ввода

**Что должно произойти:**

1. Алексей завершает задачу (effectiveTokens ~80K)
2. ROI check проходит → background compaction scheduled
3. Фоновая операция запускается
4. Pre-compaction leaf check: leafId совпадает → продолжаем
5. CapsuleGenerator создаёт капсулу через portable-only стратегию
6. CapsuleValidator: все проверки пройдены
7. `ContextManager.manualCompact()` добавляет капсулу в сессию
8. `onOperationCompleted` эмиттится с checkpointId
9. Алексей ещё не ввёл новый запрос — компакция успела
10. Следующий turn получает контекст с капсулой: effectiveTokens ≈ 25K

**Какие компоненты проверяются:**

- Полный цикл background compaction успешно
- Pre-compaction leaf check
- `onOperationCompleted` callback
- Следующий turn использует уменьшенный контекст

**Верификация:**

- `/session` показывает капсулу с trigger: turn_complete
- EffectiveTokens снижены
- Контекст содержит structured state из капсулы + 20K свежих сообщений

---

## Use Case 7: Tool call boundary validation (критическая ошибка)

**Что должно произойти:**

1. В сессии есть: `function_call(read, "auth.ts")` → `function_call_output(содержимое auth.ts)` → `user_message("добавь валидацию")`
2. `findCutPoint()` находит точку разреза ПОСЛЕ function_call_output, но ПЕРЕД user_message
3. **НО** из-за накопления токенов разрез попадает МЕЖДУ function_call и function_call_output
4. CapsuleGenerator создаёт черновик
5. `CapsuleValidator._checkToolCallBoundary()` обнаруживает: call_id "call_123" в sourceItems, но output в keptItems
6. Ошибка `tool_call_boundary` → валидация провалена
7. Generator пробует следующую стратегию (deterministic)
8. Если и deterministic создаёт разрыв → ошибка возвращается, inference блокируется
9. На практике: `findCutPoint()` не должен допускать такой разрез

**Какие компоненты проверяются:**

- `CapsuleValidator._checkToolCallBoundary()` — обнаружение разрыва
- `findCutPoint()` — корректность выбора точки разреза
- Fallback chain в CapsuleGenerator

**Верификация:**

- Если разрыв обнаружен → validation.errors содержит tool_call_boundary
- Inference не продолжается с разорванным tool call
- На практике findCutPoint не создаёт такой разрыв

---

## Use Case 8: Lost blocker validation (критическая ошибка)

**Что должно произойти:**

1. В сессии был запущен `bash("bun test")`, вывод содержит "5 failed"
2. Сообщение агента: "Тесты упали, это блокирует дальнейшую работу"
3. Контекст превышает hardLimit → blocking compaction
4. Portable-only стратегия генерирует капсулу, но **пропускает** информацию о падающих тестах
5. `CapsuleValidator._extractBlockersFromItems()` находит "failed" в выводах
6. `portableState.blockers` не содержит эту информацию → ошибка `lost_blocker`
7. Generator пробует deterministic fallback
8. Deterministic включает blocker в состояние → validation.valid = true
9. Капсула сохранена

**Какие компоненты проверяются:**

- `CapsuleValidator._extractBlockersFromItems()` — поиск ошибок в выводах
- Валидация `lost_blocker` — критическая информация не потеряна
- Fallback chain: portable-only → deterministic

**Верификация:**

- Капсула, созданная через deterministic, содержит blocker
- Информация о падающих тестах доступна агенту после компакции

---

## Use Case 9: Lost verification status (критическая ошибка)

**Что должно произойти:**

1. Алексей запускает тесты: `bash("bun test")` → exit_code=1, output содержит "3 failed"
2. Контекст превышает hardLimit
3. Portable-only стратегия генерирует капсулу с `verificationStatus: "passed"` (ошибка модели)
4. `CapsuleValidator._hasFailedVerification()` находит exit_code ≠ 0
5. `artifacts.verificationStatus !== "failed"` → ошибка `lost_failed_verification`
6. Generator пробует deterministic стратегию
7. Deterministic правильно определяет status как "failed" → валидация пройдена

**Какие компоненты проверяются:**

- `CapsuleValidator._hasFailedVerification()` — проверка exit_code
- Валидация `lost_failed_verification` — критическая ошибка
- Fallback chain

**Верификация:**

- Итоговая капсула содержит verificationStatus: "failed"
- Агент после компакции знает, что тесты красные

---

## Use Case 10: Exceeds hard limit после компакции

**Что должно произойти:**

1. После компакции `estimatedTokensAfter` = 110K (из-за очень больших kept items)
2. hardLimit = 104K
3. `CapsuleValidator` обнаруживает: `estimatedTokensAfter (110K) > hardLimit (104K)`
4. Для blocking compaction → ошибка `exceeds_hard_limit`
5. Generator пробует deterministic стратегию с более агрессивным keepRecentTokens
6. deterministic всё ещё > hardLimit
7. `preInferenceCheck()` возвращает `canProceed: false`
8. SOBA сообщает пользователю: "Post-compaction effective tokens still exceed hard limit. Consider /compact with custom instructions or start a new session."

**Какие компоненты проверяются:**

- `exceeds_hard_limit` валидация
- Отказ продолжать inference когда даже после компакции контекст слишком большой
- Диагностическое сообщение пользователю

**Верификация:**

- SOBA не отправляет запрос, который гарантированно получит overflow
- Пользователь видит осмысленное предложение (ручная компакция или новая сессия)

---

## Use Case 11: Ручная компакция с кастомными инструкциями

**Что должно произойти:**

1. Алексей вводит: `/compact Сохрани информацию о рефакторинге AuthService и плане миграции middleware`
2. `ContextManager.manualCompact()`:
   - `TriggerPolicy.evaluateUserRequest()` → always true (если есть reclaimable)
   - CapsuleGenerator использует portable-only с customInstructions
   - Модель фокусируется на AuthService и middleware
   - Валидация проходит
3. Капсула сохраняется с trigger: user_request

**Какие компоненты проверяются:**

- `TriggerPolicy.evaluateUserRequest()` — игнорирует ROI-минимумы
- `ContextManager.manualCompact()` — ручная компакция
- Custom instructions передаются в генератор

**Верификация:**

- Капсула содержит информацию об AuthService и middleware
- `/capsule <checkpoint-id>` показывает portable state

---

## Use Case 12: Ручная компакция — no-op (нечего компактить)

**Что должно произойти:**

1. EffectiveTokens = 8K, keepRecentTokens = 20K
2. reclaimable = 8K - 20K = -12K (отрицательное)
3. `evaluateUserRequest()` → shouldCompact=false, reason="No reclaimable context"
4. SOBA отвечает: "No context to compact — current context (8K tokens) is already within the keep window (20K)."

**Какие компоненты проверяются:**

- `TriggerPolicy.evaluateUserRequest()` — no-op когда нечего сжимать
- Отсутствие бессмысленных капсул

**Верификация:**

- Сессия не изменена
- Капсула не создана
- Пользователь видит объяснение

---

## Use Case 13: Отключение proactive compaction

**Что должно произойти:**

1. Алексей запускает: `soba -i --no-auto-compact`
2. `TriggerPolicy.auto = false`
3. После завершения задачи `evaluateTurnComplete()` → shouldCompact=false (auto disabled)
4. `evaluateMilestone()` → shouldCompact=false
5. Контекст достигает hardLimit → `evaluateHardLimit()` → shouldCompact=true (hard-limit защита всегда включена)
6. Блокирующая компакция выполняется

**Какие компоненты проверяются:**

- `TriggerPolicy.evaluateTurnComplete()` — учитывает auto: false
- `TriggerPolicy.evaluateMilestone()` — учитывает auto: false
- `TriggerPolicy.evaluateHardLimit()` — игнорирует auto (защита)

**Верификация:**

- Нет фоновых компакций пока auto=false
- Hard-limit защита работает всегда

---

## Use Case 14: Идемпотентность — повторная компакция

**Что должно произойти:**

1. В сессии уже есть капсула (создана через hard_limit)
2. `ContextManager._performCompaction()`:
   - Находит lastCapsule в ветке
   - `effectiveStartIdx` начинается с firstKeptEntryId предыдущей капсулы
   - sourceItems = только элементы ПОСЛЕ предыдущей капсулы (уже компактированное не трогаем)
3. Компакция применяется только к новым элементам
4. В сессии две капсулы подряд (каждая покрывает свой диапазон)

**Какие компоненты проверяются:**

- `_getEffectiveItems()` — уважение к существующим капсулам
- `_performCompaction()` — определение effectiveStartIdx
- Идемпотентность: не компактим уже компактированное

**Верификация:**

- Вторая капсула не ссылается на элементы, уже покрытые первой
- sourceItems второй компакции не включают элементы до firstKeptEntryId первой капсулы

---

## Use Case 15: Прозрачность — `/session` и `/capsule`

**Что должно произойти:**

1. В середине сценария Алексей вводит `/session`
2. SOBA показывает:
   - Effective tokens: 72,340
   - Источник метрики: provider_usage (watermark valid)
   - Hard limit: 104,000
   - Context window: 128,000
   - Safety reserve: 8,192
   - Капсулы: 2 (checkpoint-001, checkpoint-002)
   - Последняя капсула: quality=0.85, savingsRatio=0.58

3. Алексей вводит `/capsule checkpoint-002`
4. SOBA показывает portable state:
   - Goal: "Рефакторинг модуля авторизации"
   - Completed: [AuthService выделен, middleware обновлён, тесты AuthService зеленые]
   - In Progress: [миграция старых контроллеров]
   - Pending: [интеграционные тесты, обновление документации]
   - Decisions: [использовать JWT вместо сессий (rationale: stateless масштабирование)]
   - Blockers: []
   - Next Steps: [добавить rate limiting, обновить API docs]

**Какие компоненты проверяются:**

- Команда `/session` — отображение метрик контекста
- Команда `/capsule` — отображение portable state
- `ContextManager.getSnapshot()` и `getDebugInfo()`

**Верификация:**

- Информация соответствует реальному состоянию сессии
- Portable state читаемый и содержит ключевую информацию
- Пользователь понимает, что и почему было сжато

---

## Use Case 16: Endurance — 10 компакций без потери состояния

**Что должно произойти:**

1. Сценарий из 12 задач, ~120 сообщений, суммарно >200K токенов
2. Происходит 5 блокирующих компакций (hard_limit) и 2 фоновых (turn_complete)
3. После каждой компакции проверяется:
   - Goal не изменился
   - Blocker (если был) сохранён
   - Pending work актуален
   - Modified files в artifacts соответствуют реальности
4. В середине SOBA перезапускается и продолжает ту же сессию
5. Следующая компакция использует portable state (нет native continuation)
6. После перезапуска переключаемся на провайдера БЕЗ native compaction

**Какие компоненты проверяются:**

- Полный цикл: hard_limit → turn_complete → restart → продолжение → новая компакция
- Portable state после перезапуска
- Смена провайдера не ломает сессию
- Все компоненты системы работают вместе

**Верификация:**

- Сессия завершается без ручного restart/overflow
- SavingsRatio ≥ 0.20 по итогам сценария
- Goal, pending work, blockers сохранены во всех капсулах
- После перезапуска агент продолжает с portable state из последней капсулы

---

## Матрица покрытия компонентов

| Компонент | UC0 | UC1 | UC2 | UC3 | UC4 | UC5 | UC6 | UC7 | UC8 | UC9 | UC10 | UC11 | UC12 | UC13 | UC14 | UC15 | UC16 |
|-----------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|------|------|------|------|------|------|------|
| validateCompactionConfig | ● | | | | | | | | | | | | | | | | |
| ContextMeter.recordProviderUsage | | ● | | | | | | | | | | | | | | | |
| ContextMeter.snapshot (provider) | | ● | | ● | | | | | | | | | | | | | |
| ContextMeter.snapshot (estimated) | | | ● | | | | | | | | | | | | | | |
| ContextMeter.invalidateWatermark | | | ● | | | | | | | | | | | | | | |
| ContextMeter._getEffectiveItems | | | | | | | | | | | | | | | | ● | |
| TriggerPolicy.evaluateHardLimit | | | | ● | | | | | | | | | | ● | | | |
| TriggerPolicy.evaluateContextOverflow | | | | | ● | | | | | | | | | | | | |
| TriggerPolicy.evaluateTurnComplete | | | | | | ● | ● | | | | | | | ● | | | |
| TriggerPolicy.evaluateUserRequest | | | | | | | | | | | | ● | ● | | | | |
| TriggerPolicy._evaluateROI | | | | | | ● | ● | | | | | | | | | | |
| findCutPoint | | | | ● | | | | ● | | | | | | | | | |
| CapsuleGenerator.generate | | | | ● | ● | | ● | ● | ● | ● | ● | ● | | | | | |
| CapsuleGenerator._buildStrategyChain | | | | ● | ● | | ● | | | | | | | | | | |
| CapsuleValidator.validate | | | | ● | ● | | ● | ● | ● | ● | ● | ● | | | | | |
| CapsuleValidator._checkToolCallBoundary | | | | | | | | ● | | | | | | | | | |
| CapsuleValidator._extractBlockersFromItems | | | | | | | | | ● | | | | | | | | |
| CapsuleValidator._hasFailedVerification | | | | | | | | | | ● | | | | | | | |
| ContextManager.preInferenceCheck | | | | ● | | | | | | | ● | | | | | | |
| ContextManager.handleContextOverflow | | | | | ● | | | | | | | | | | | | |
| ContextManager.manualCompact | | | | | | | ● | | | | | ● | ● | | | | |
| ContextManager.evaluateTurnComplete | | | | | | ● | ● | | | | | | | | | | |
| ContextManager._performCompaction | | | | ● | ● | | ● | | | | | ● | | | ● | | |
| BackgroundScheduler.schedule | | | | | | ● | ● | | | | | | | | | | |
| BackgroundScheduler.cancel | | | | | | ● | | | | | | | | | | | |
| BackgroundScheduler._runOperation | | | | | | ● | ● | | | | | | | | | | |
| Команда /session | | | | | | | | | | | | | | | | ● | |
| Команда /capsule | | | | | | | | | | | | | | | | ● | |
| Идемпотентность | | | | | | | | | | | | | | | ● | | |
| Endurance (10+ компакций) | | | | | | | | | | | | | | | | | ● |

## Порядок выполнения для ручного тестирования

1. **UC-0** — сразу после старта, проверяем конфигурацию
2. **UC-1, UC-2** — первые 5-10 минут, наблюдаем за метриками через `/session`
3. **UC-3** — при достижении ~108K effectiveTokens, наблюдаем blocking compaction
4. **UC-7, UC-8, UC-9** — в процессе UC-3 проверяем корректность границ
5. **UC-5, UC-6** — после завершения крупных задач, наблюдаем background compaction
6. **UC-11, UC-12** — в любой момент, тестируем `/compact`
7. **UC-4** — симулируем с провайдером на 64K context window
8. **UC-13** — перезапуск с `--no-auto-compact`
9. **UC-14** — после нескольких компакций, проверяем идемпотентность
10. **UC-15** — периодически используем `/session` и `/capsule`
11. **UC-16** — полный прогон всего сценария с перезапуском
