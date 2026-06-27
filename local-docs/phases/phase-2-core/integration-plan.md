# Фаза 2 — План интеграции в CLI/TUI/Agent Loop

**Версия:** SOBA 0.3.0  
**Статус:** готов к реализации  
**Дата:** 2026-06-15  
**Зависимости:** Все модули A.1-A.9, B.1-B.7 реализованы и протестированы

## Контекст

Все компоненты фазы 2 (ContextManager, BackgroundScheduler, SkillManager, checkpoint tool, activate-skill tool) написаны и покрыты unit-тестами, но **не подключены к реальному рантайму** CLI/TUI/Agent Loop. Этот план описывает wiring этих компонентов в работающее приложение.

## Правила выполнения

- Каждая задача заканчивается интеграционными тестами.
- После каждой задачи: `bunx biome check --write .`, `bun test`, `bun run build`.
- Задачи выполняются последовательно (есть зависимости).
- Каждая задача коммитится отдельно.

---

## Iteration 5: CLI/TUI Integration

### I.1 — Provider Identity и Capabilities в Client

**Use cases:** UC-A1, UC-A6  
**Файлы:** `src/core/client/openresponses-client.ts`, `src/core/middleware/openai-adapter.ts`, `src/cli.ts`

**Задачи:**

1. Добавить `ProviderIdentity` и `ProviderCapabilities` в `OpenResponsesClient` config.
2. Реализовать `getProviderIdentity()` и `getCapabilities()` методы в `OpenResponsesClient`.
3. Обновить `OpenAIAdapter` для возврата identity/capabilities через middleware contract.
4. В `cli.ts` передать provider identity/capabilities при создании client.

**Тесты:**
- Client возвращает корректный provider identity для OpenAI/Anthropic/custom.
- Capabilities включают `nativeCompact`, `developerMessage`, `structuredOutput`.
- Middleware adapter корректно мапит provider-specific поля.

**Критерии приёмки:**
- `client.getProviderIdentity()` возвращает `{ providerId, modelId, endpointHash }`.
- `client.getCapabilities()` возвращает объект с boolean флагами.

---

### I.2 — ContextManager в Agent Loop

**Use cases:** UC-A1, UC-A4, UC-A5  
**Файлы:** `src/core/loop/agent-loop.ts`, `src/cli.ts`

**Задачи:**

1. Создать `ContextManager` в `cli.ts` с config из `SobaConfig.compaction`.
2. Передать `ContextManager` в `AgentLoop` через options.
3. В `AgentLoop.runTurn()` добавить `preInferenceCheck()` перед каждым inference call.
4. Если `canProceed: false`, эмитить `context_error` event и прервать turn.
5. Если `compactionPerformed: true`, эмитить `compaction_done` event.
6. В error handler добавить обработку `context_overflow` через `handleContextOverflow()`.
7. Если recovery успешен, повторить inference call (один раз).

**Тесты:**
- Pre-inference check блокирует request при превышении hard limit.
- Blocking compaction эмитит `compaction_done` event.
- Context overflow error запускает emergency compaction и retry.
- Если recovery не удался, turn завершается с `context_error`.

**Критерии приёмки:**
- Agent loop не отправляет request, если effective tokens > hard limit.
- Context overflow error не прерывает turn, а запускает recovery.
- Все compaction events видны в TUI.

---

### I.3 — BackgroundScheduler и Turn Completion

**Use cases:** UC-A2, UC-A7  
**Файлы:** `src/core/loop/agent-loop.ts`, `src/cli.ts`, `src/tui/interactive-tui.ts`

**Задачи:**

1. Создать `BackgroundScheduler` в `cli.ts` с `ContextManager` и config.
2. Передать scheduler в `AgentLoop` через options.
3. В `AgentLoop` после успешного `turn_complete` вызвать `contextManager.evaluateTurnComplete()`.
4. Если `shouldCompact: true`, вызвать `scheduler.schedule()` с trigger и snapshot.
5. При начале нового user turn вызвать `scheduler.cancel("New user turn")`.
6. В `InteractiveTUI` подписаться на scheduler events и показывать background compaction status.

**Тесты:**
- Background compaction запускается после turn completion при достижении порога.
- Новый user turn отменяет background operation.
- Scheduler events эмитятся и отображаются в TUI.
- Background failure не модифицирует session branch.

**Критерии приёмки:**
- Background compaction не блокирует пользовательский ввод.
- TUI показывает индикатор background compaction (spinner/icon).
- Отмена background operation логируется.

---

### I.4 — Checkpoint Tool Registration

**Use cases:** UC-A3, UC-A7  
**Файлы:** `src/cli.ts`, `src/core/tools/checkpoint.ts`

**Задачи:**

1. Импортировать `checkpointTool` из `src/core/tools/checkpoint.ts`.
2. Зарегистрировать его в `ToolRegistry` в `cli.ts` после core tools.
3. В `AgentLoop` добавить обработку `checkpoint` tool call:
   - Эмитить `checkpoint_requested` event.
   - Вызвать `contextManager.evaluateMilestone()`.
   - Если `shouldCompact: true`, запустить compaction через scheduler.
   - Вернуть tool output с checkpoint ID и status.

**Тесты:**
- Checkpoint tool доступен в tool registry.
- Agent может вызвать checkpoint tool с `kind: "milestone"` или `kind: "plan_pivot"`.
- Milestone checkpoint запускает compaction при достижении ROI порога.
- Checkpoint event отображается в TUI.

**Критерии приёмки:**
- `tools.getNames()` включает `"checkpoint"`.
- Checkpoint tool call не прерывает agent loop.
- Checkpoint ID сохраняется в session entry.

---

### I.5 — SkillManager и ProjectTrustStore Bootstrap

**Use cases:** UC-B1, UC-B2  
**Файлы:** `src/cli.ts`, `src/core/skills/skill-manager.ts`, `src/core/skills/discovery.ts`, `src/core/skills/catalog.ts`, `src/core/skills/project-trust-store.ts`

**Задачи:**

1. В `cli.ts` создать `ProjectTrustStore` с persistence в `~/.soba/trust/`.
2. Создать `SkillDiscovery` с locations (bundled, user, project).
3. Создать `SkillCatalog` с discovery и trust store.
4. Создать `SkillManager` с catalog, discovery, trust store.
5. Вызвать `skillManager.refresh()` для initial scan.
6. Передать `SkillManager` в `AgentLoop` и `InteractiveTUI` через options.

**Тесты:**
- SkillManager инициализируется при старте CLI.
- Bundled skills обнаруживаются без копирования.
- Project skills не читаются до trust approval.
- Catalog refresh обновляет список skills без restart.

**Критерии приёмки:**
- CLI стартует без ошибок при наличии/отсутствии skills.
- `skillManager.getCatalogForPrompt()` возвращает список для system prompt.
- Trust store persistence работает между сессиями.

---

### I.6 — Activate Skill Tool Registration

**Use cases:** UC-B1, UC-B3  
**Файлы:** `src/cli.ts`, `src/core/tools/activate-skill.ts`, `src/core/loop/agent-loop.ts`

**Задачи:**

1. Импортировать `activateSkillTool` из `src/core/tools/activate-skill.ts`.
2. Зарегистрировать его в `ToolRegistry` в `cli.ts`.
3. В `AgentLoop` добавить обработку `activate_skill` tool call:
   - Вызвать `skillManager.activate(skillName)`.
   - Если success, добавить `SkillActivationEntry` в session.
   - Вернуть tool output с skill name и status.
4. В `buildSystemPrompt()` инжектировать skill catalog из `skillManager.getCatalogForPrompt()`.
5. В `buildInput()` инжектировать ephemeral developer messages из `skillManager.buildEphemeralMessages()`.

**Тесты:**
- Activate skill tool доступен в tool registry.
- Agent может вызвать activate_skill с skill name.
- Активированный skill добавляется в session entry.
- Skill catalog виден в system prompt.
- Ephemeral messages инжектируются только для trusted skills.

**Критерии приёмки:**
- `tools.getNames()` включает `"activate_skill"`.
- System prompt содержит секцию "Available Skills" с catalog.
- Активированный skill контент инжектируется эфемерно (не сохраняется в session).

---

### I.7 — Skill Slash Commands

**Use cases:** UC-B1, UC-B4, UC-B5  
**Файлы:** `src/cli/commands.ts`, `src/core/skills/slash-handler.ts`

**Задачи:**

1. Импортировать `handleSkillSlash` из `src/core/skills/slash-handler.ts`.
2. Добавить в `CommandContext` поле `skillManager?: SkillManager`.
3. В `executeCommand()` добавить обработку `/skill:*` паттерна:
   - `/skill:<name> [args]` → активация + user message.
   - `/skill new` → draft creation.
   - `/skill edit <name>` → draft revision.
   - `/skill eval <name>` → evaluator run.
   - `/skill list` → catalog listing.
   - `/skill history <name>` → revision history.
   - `/skill rollback <name> <revision>` → rollback.
   - `/skill remove <name>` → confirmed remove.
4. Добавить `/project-trust status|approve|revoke` команду.
5. В `cli.ts` передать `skillManager` в `CommandContext`.

**Тесты:**
- `/skill:commit-message` активирует skill и создаёт user message.
- `/skill list` показывает catalog с scopes.
- `/skill new` создаёт draft без активации.
- `/project-trust approve` разрешает чтение project skills.
- Неизвестный `/skill:*` возвращает ошибку.

**Критерии приёмки:**
- Все skill slash commands работают в REPL.
- `/skill:*` с аргументами создаёт user message после активации.
- Project trust gating работает корректно.

---

### I.8 — Manual /compact через ContextManager

**Use cases:** UC-A1  
**Файлы:** `src/cli/commands.ts`

**Задачи:**

1. В `handleCompact()` заменить legacy `compact()` на `contextManager.manualCompact()`.
2. Если `contextManager` не передан (undefined), fallback на legacy `compact()`.
3. Передать `systemPromptTokens`, `toolSchemaTokens`, `requestFingerprint` из context.
4. Отобразить `CompactionOutcome` в renderer (strategy, quality, metrics).

**Тесты:**
- `/compact` вызывает `contextManager.manualCompact()` при наличии.
- Fallback на legacy `compact()` работает при отсутствии contextManager.
- Outcome отображается с strategy, quality, metrics.

**Критерии приёмки:**
- `/compact` использует новый capsule-based compaction.
- Legacy compaction продолжает работать для v1 sessions.

---

### I.9 — ContextManager Metrics в /session

**Use cases:** UC-A5  
**Файлы:** `src/cli/commands.ts`

**Задачи:**

1. В `handleSession()` добавить отображение `contextManager.getSnapshot()` metrics.
2. Показать `effectiveTokens`, `historicalTokens`, `hardLimit`, `source`.
3. Если `contextManager` не передан, показать legacy metrics.

**Тесты:**
- `/session` показывает ContextManager metrics при наличии.
- Fallback на legacy metrics работает.

**Критерии приёмки:**
- `/session` отображает актуальные context metrics.

---

### I.10 — Auto-Compact Runtime Toggle

**Use cases:** UC-A7  
**Файлы:** `src/cli/commands.ts`, `src/core/loop/agent-loop.ts`

**Задачи:**

1. В `handleAutoCompact()` обновить `autoCompactOverride` объект.
2. В `AgentLoop` проверять `autoCompactOverride.enabled` перед `evaluateTurnComplete()`.
3. Если disabled, пропустить background scheduling.

**Тесты:**
- `/auto-compact off` отключает background compaction.
- `/auto-compact on` включает background compaction.
- Runtime toggle применяется сразу.

**Критерии приёмки:**
- Auto-compact можно включить/выключить во время сессии.

---

## Release Gate (обновлённый)

- [ ] Provider identity/capabilities доступны через client API.
- [ ] ContextManager интегрирован в agent loop (pre-inference check, overflow recovery).
- [ ] BackgroundScheduler запускается после turn completion и отменяется при новом turn.
- [ ] Checkpoint tool зарегистрирован и обрабатывается в agent loop.
- [ ] SkillManager инициализируется при старте CLI.
- [ ] Activate skill tool зарегистрирован и инжектирует ephemeral messages.
- [ ] Skill slash commands работают в REPL.
- [ ] `/compact` использует ContextManager (с fallback на legacy).
- [ ] `/session` показывает ContextManager metrics.
- [ ] `/auto-compact` runtime toggle работает.
- [ ] Все интеграционные тесты проходят.
- [ ] `bunx biome check .`, `bun test`, `bun run build` проходят.

---

## Зависимости между задачами

```
I.1 (Provider Identity)
  ↓
I.2 (ContextManager в Agent Loop)
  ↓
I.3 (BackgroundScheduler)
  ↓
I.8 (Manual /compact через ContextManager)
  ↓
I.9 (ContextManager Metrics в /session)
  ↓
I.10 (Auto-Compact Runtime Toggle)

I.4 (Checkpoint Tool) — независимо от I.1-I.3, но требует ContextManager

I.5 (SkillManager Bootstrap)
  ↓
I.6 (Activate Skill Tool)
  ↓
I.7 (Skill Slash Commands)
```

**Рекомендуемый порядок:**
1. I.1 → I.2 → I.3 → I.4 (Context Intelligence integration)
2. I.5 → I.6 → I.7 (Skills integration)
3. I.8 → I.9 → I.10 (Commands integration)

---

## Оценка трудозатрат

| Задача | Сложность | Время |
|---|---|---|
| I.1 | Low | 1-2 часа |
| I.2 | High | 4-6 часов |
| I.3 | Medium | 3-4 часа |
| I.4 | Medium | 2-3 часа |
| I.5 | Medium | 3-4 часа |
| I.6 | Medium | 3-4 часа |
| I.7 | High | 4-6 часов |
| I.8 | Low | 1-2 часа |
| I.9 | Low | 1 час |
| I.10 | Low | 1 час |
| **Итого** | | **23-32 часа** |

---

## Риски и митигация

| Риск | Влияние | Митигация |
|---|---|---|
| ContextManager API несовместим с agent loop | High | Написать adapter layer, если нужно |
| SkillManager замедляет startup | Medium | Lazy loading catalog, async refresh |
| Background scheduler race conditions | High | Immutable leaf snapshot, stale leaf rejection |
| Ephemeral messages pollute context | Medium | Inject только после trust check, не сохранять в session |
| Legacy compaction fallback сломан | Medium | Integration тесты для v1 sessions |

---

## Следующие шаги

1. Ревью этого плана пользователем.
2. Реализация I.1-I.10 последовательно.
3. После каждой задачи — commit и тесты.
4. После всех задач — обновление `manual-test-run.md` и endurance benchmark.
5. Финальный release gate check.
