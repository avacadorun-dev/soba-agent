# Фаза 2 — Context Intelligence + Adaptive Skills: План реализации

**Версия:** SOBA 0.3.0
**Статус:** готов к реализации
**Нормативные контракты:** [technical-spec.md](./technical-spec.md)

## Правила выполнения

- Каждая задача заканчивается автоматическими тестами по связанным use cases.
- После каждых 2–3 задач обновляется и выполняется соответствующая секция `manual-test-run.md`.
- Перед каждым commit: `bunx biome check --write .`, `bunx biome check .`, `bun test`, `bun run lint`,
  `bun run build`.
- Track B начинается после стабильного Session v2, Context Capsule API и ProjectTrustStore contract.
- Задача не считается завершённой, если её downstream contract требует ещё не реализованную задачу.

## Iteration 1: Context Foundation

### A.1 — Session Format v2 и Context Capsule

**Use cases:** UC-A5, UC-A6

**Файлы:** `src/core/session/`, `src/core/compaction/capsule-types.ts`, `tests/core/session/`

**Задачи:**

1. Добавить v2 entry types, guards и parser compatibility с v1.
2. Добавить append-only migration marker, чтение смешанной v1/v2 сессии и continuation через legacy v1 compaction.
3. Перевести session storage на канонический полный client `ItemParam` без потери forward-compatible items.
4. Реализовать persistent `session_cursor` и однозначное восстановление active leaf.
5. Реализовать append/list/get для `ContextCapsuleEntry`.
6. Расширить `buildInput()` выбором native или portable continuation и exact skill revision refs.

**Тесты после каждой задачи:** migration, legacy compaction continuation, full ItemParam round-trip, rewind-before-
restart, multiple leaves, compatibility-key и portable buildInput.

### A.2 — Provider identity, capabilities и error classification

**Use cases:** UC-A1, UC-A6

**Файлы:** `src/core/middleware/types.ts`, `src/core/middleware/openai-adapter.ts`,
`src/core/client/openresponses-client.ts`, `tests/core/middleware/`, `tests/core/client/`

**Задачи:**

1. Добавить explicit provider identity и capabilities.
2. Добавить provider-issued continuation compatibility key.
3. Разделить native compact transport и portable summary response; поддержать structured output transport при
   объявленной capability.
4. Добавить классификацию `context_overflow` и других transport/response errors.
5. Убрать concrete `OpenAIAdapter` cast и hardcoded native compact transport из `OpenResponsesClient`; streaming и
   compaction должны работать через общий adapter contract.
6. Гарантировать передачу developer messages: native role при capability или маркированный system fallback.

**Тесты:** OpenAI-compatible default without native compact, exact compatibility key, changed endpoint/model,
overflow/non-overflow classification, generic streaming contract, developer-message fallback.

### A.3 — ContextMeter и TriggerPolicy

**Use cases:** UC-A1, UC-A2, UC-A7

**Файлы:** `src/core/compaction/context-meter.ts`, `src/core/compaction/trigger-policy.ts`,
`src/core/config/types.ts`, `src/core/config/config-loader.ts`, `src/cli/args.ts`

**Задачи:**

1. Сохранять usage watermark: measured entry и request fingerprint.
2. Собирать provider usage и trailing estimates, включая prompt/tools/skills без double-counting.
3. Рассчитывать `hardLimit`, snapshots и post-compaction fit.
4. Реализовать priority и ROI policy.
5. Добавить вложенный `compaction` config с defaults и invariant validation; сохранить совместимость
   `SobaConfig.maxTokens`/`SOBA_MAX_TOKENS`, добавить `SOBA_AUTO_COMPACT` и `--no-auto-compact`.

**Тесты:** provider usage precedence, watermark, prompt/catalog invalidation, estimated fallback, invalid config,
hard-limit boundary, ROI skip, `auto: false`.

**Manual checkpoint:** TC-F1.

### A.4 — CapsuleGenerator и CapsuleValidator

**Use cases:** UC-A1, UC-A4

**Файлы:** `src/core/compaction/capsule-generator.ts`, `capsule-validator.ts`, `strategies/`

**Задачи:**

1. Реализовать deterministic strategy и artifact ledger extraction.
2. Реализовать portable-only structured summary strategy.
3. Реализовать native+portable strategy через provider capabilities.
4. Реализовать quality gate, tool-call boundary validation, post-compaction fit и fallback chain.

**Тесты:** сохранение blockers/files/verification, custom instructions, native opacity, invalid draft rejection,
deterministic fallback, insufficient-reclaim rejection.

## Iteration 2: Proactive Compaction

### A.5 — ContextManager и blocking protection

**Use cases:** UC-A1, UC-A4

**Файлы:** `src/core/compaction/context-manager.ts`, `src/core/loop/`, `src/cli/commands.ts`

**Задачи:**

1. Оркестрировать snapshot, trigger, strategy, validation и append.
2. Проверять hard limit перед inference.
3. Обрабатывать только классифицированный context overflow одним emergency compact+retry.
4. Не отправлять request, если fallback не проходит post-compaction fit.
5. Перевести `/compact` на ContextManager с no-op contract.

**Тесты:** hard-limit prevents request, classified overflow retry, unrelated errors are not compacted, fallback fit,
insufficient-reclaim diagnostic, manual no-op.

**Manual checkpoint:** TC-A4.

### A.6 — Background scheduler и completion integration

**Use cases:** UC-A2, UC-A7

**Файлы:** `src/core/compaction/scheduler.ts`, `src/core/loop/`

**Задачи:**

1. Запускать background compaction после accepted completion.
2. Отменять operation при новом user turn и timeout.
3. Проверять immutable leaf перед append.
4. Эмитить context events.

**Тесты:** no perceived blocking, cancellation, stale leaf rejection, failure leaves branch unchanged.

### A.7 — Milestone checkpoint

**Use cases:** UC-A3

**Файлы:** `src/core/tools/checkpoint.ts`, `src/core/loop/`, ContextManager

**Задачи:**

1. Добавить control-tool и тип события.
2. Обрабатывать событие только после завершения tool batch.
3. Применять ROI policy и сохранять вызов при skip.

**Тесты:** milestone и pivot, parallel batch safety, no false turn completion.

**Manual checkpoint:** TC-A2, TC-A3, TC-A7.

### A.8 — Transparency и portable rewind

**Use cases:** UC-A5, UC-A6

**Файлы:** `src/cli/commands.ts`, `src/core/loop/types.ts`, TUI events/store, `src/core/session/session-manager.ts`

**Задачи:**

1. Расширить `/session` context metrics и checkpoints.
2. Добавить `/capsule`.
3. Обновить `/rewind` для checkpointId, persistent cursor и provider compatibility key.
4. Добавить runtime `/auto-compact on|off`.

**Тесты:** command output, strategy persistence, native/portable rewind, restart after rewind, branch preservation,
runtime toggle.

### A.9 — Endurance benchmark

**Use cases:** UC-A8

**Файлы:** `tests/endurance/`, `scripts/benchmark-context.ts`, `docs/phases/phase-2-core/endurance-results.md`

**Задачи:**

1. Создать воспроизводимый scripted workload минимум с десятью compactions.
2. Проверять capsule invariants, restart/resume и provider switch на portable continuation.
3. Сравнивать total token cost с baseline без proactive compaction и фиксировать peak effective context.
4. Сохранять environment, config, результаты и ограничения benchmark.

**Тесты:** deterministic benchmark fixtures, capsule continuity assertions, baseline comparison.

**Manual checkpoint:** TC-A1, TC-A5, TC-A6, TC-A8.

## Iteration 3: Standard Skills

### B.1 — Skill discovery, validation и catalog

**Use cases:** UC-B1, UC-B2, UC-B7

**Файлы:** `src/core/skills/discovery.ts`, `validator.ts`, `catalog.ts`, `project-trust-store.ts`, `types.ts`

**Задачи:**

1. Реализовать canonical project identity, persistent ProjectTrustStore и `/project-trust status|approve|revoke`.
2. Парсить Agent Skills frontmatter, official layout rules и SOBA extensions.
3. Сканировать locations с precedence и collision diagnostics.
4. Реализовать validation, name-directory match, traversal checks и запрет symlink payload.
5. Лениво разрешать exact revision/content hash внешних skills при activation.
6. Не читать project skill metadata до trust; после trust обновлять catalog без restart.

**Тесты:** compatible skill discovery, invalid skill, standard deviations diagnostic, collision, untrusted project
not read, canonical identity, worktree trust isolation, trust persistence/revoke/reapprove, fingerprint change,
external lazy content hash, symlink rejection, cross-agent location.

### B.2 — Progressive disclosure и activation

**Use cases:** UC-B1, UC-B3

**Файлы:** `src/core/skills/activator.ts`, session/build-request integration, system prompt,
`src/core/tools/activate-skill.ts`, slash routing

**Задачи:**

1. Добавить catalog в system prompt.
2. Реализовать `activate_skill` без исполнения scripts.
3. Реализовать `/skill:<name> [args]`.
4. Сохранять `SkillActivationEntry`, но инъецировать raw skill content только эфемерно после trust/revision check.
5. Восстанавливать active refs из capsule и последующих activation/deactivation entries.
6. Преобразовывать `/skill:<name> [args]` в activation плюс обычное user message.
7. Дедуплицировать exact revision activation и сохранять `ActivatedSkillRef` в capsule.

**Тесты:** catalog-only prompt, activation content/resources, explicit activation, exact-revision deduplication,
no raw skill content in session, explicit args persisted as user message, trust revoke stops injection, missing
revision diagnostic, capsule carry-over.

**Manual checkpoint:** TC-B1, TC-B2, TC-B3.

### B.3 — Bundled skills

**Use cases:** UC-B1

**Файлы:** `skills/<name>/SKILL.md`, build scripts

**Задачи:**

1. Создать небольшой набор качественных bundled skills: `commit-message`, `git-summary`, `lint-fix`,
   `pr-description`.
2. Добавить bundled discovery без копирования в user directory.
3. Включить skills в JS bundle и standalone binary distribution.

**Тесты:** validation, activation, build и binary resource discovery.

## Iteration 4: Self-Improving Skills

### B.4 — Drafts и generated skill candidates

**Use cases:** UC-B4

**Файлы:** `src/core/skills/drafts.ts`, `generator.ts`, `operation-runner.ts`, commands

**Задачи:**

1. Реализовать draft store и `SkillOperationRunner` с draft-rooted filesystem facade без bash/network.
2. Реализовать `/skill new` и генерацию Agent Skill с минимум одним eval case.
3. Добавлять в основную сессию только operation summary/diff/diagnostics.
4. Показывать diff и validation; draft остаётся неактивным до evaluator/promotion.

**Тесты:** draft isolation/write scope, generated eval case, main context not polluted, invalid draft blocked,
no activation before promotion.

### B.5 — Skill evaluator, revisions и promotion

**Use cases:** UC-B4, UC-B5

**Файлы:** `src/core/skills/evaluator.ts`, `revisions.ts`, eval fixtures, commands

**Задачи:**

1. Парсить `evals/cases.json`.
2. Реализовать deterministic tool-intent matchers и evaluator-model проверку semantic output.
3. Реализовать безопасный dry-run harness и skip dangerous cases.
4. Сохранять detailed eval runs с `evaluatorConfigHash`; сравнивать одинаковые cases только при совпадающей
   конфигурации; реализовать `/skill eval ... --rebaseline` с повторной оценкой predecessor и candidate.
5. Реализовать immutable revision snapshots и approved promotion в project/user scope.
6. Реализовать `--override-metrics`, который не может отменить validation или semantic/safety regression.
7. Обновлять catalog без restart после promotion.

**Тесты:** pass/fail/skip, dangerous case skip, detailed eval persistence, semantic/safety regression без override,
metric regression с explicit override, evaluator config re-baseline, approval required, immutable snapshot, untrusted
project promotion blocked, promotion without restart.

**Manual checkpoint:** TC-B4.

### B.6 — Edit, history, rollback и remove

**Use cases:** UC-B5

**Файлы:** `src/core/skills/revisions.ts`, `src/core/skills/catalog.ts`, `src/cli/commands.ts`

**Задачи:**

1. Реализовать `/skill edit <name> [instructions]` через draft revision и SkillOperationRunner.
2. Реализовать history и rollback через новый draft/eval/promotion flow.
3. Реализовать confirmed remove, persistent bundled disable и сохранение immutable history.

**Тесты:** revision chain, content snapshot restore, rollback creates new revision, remove confirmation,
bundled disable persists after restart.

### B.7 — Workflow observation и предложения

**Use cases:** UC-B6

**Файлы:** `src/core/skills/observer.ts`, completion flow, Context Capsule integration

**Задачи:**

1. Добавить opt-in observation accepted turns и собирать только salted hashes tool-name sequences и aggregate
   outcomes.
2. Предлагать skill только после настраиваемого числа повторений.
3. Формировать предложение из transient summary текущего accepted turn без сохранения raw observation data.
4. Запускать существующий draft flow после подтверждения.
5. Добавить opt-out, rejection suppression и гарантированную очистку observation data.

**Тесты:** threshold, rejection suppression, opt-out, no automatic promotion.

**Manual checkpoint:** TC-B5, TC-B6.

## Release Gate

- [ ] Session v1 открывается и продолжается после обновления.
- [ ] Legacy v1 compaction продолжает определять effective input до первой Context Capsule.
- [ ] Rewind, закрытие и повторное открытие сессии восстанавливают выбранную ветку.
- [ ] Hard-limit protection и overflow recovery работают с provider без compact API.
- [ ] Provider без developer-message role получает capsule/skill instructions через маркированный system fallback.
- [ ] Blocking compaction либо помещает request в hard limit, либо не отправляет его и показывает diagnostic.
- [ ] Каждая capsule имеет portable state и проходит quality gate.
- [ ] Background compaction не блокирует final response и безопасно отменяется.
- [ ] Rewind сохраняет историю и работает после смены provider.
- [ ] Skills совместимы с Agent Skills; SOBA extensions/deviations явно диагностируются.
- [ ] Project skills trust-gated отдельным ProjectTrustStore; skill actions не обходят TrustManager.
- [ ] Generated skill проходит validation, eval и approval до promotion.
- [ ] Semantic/safety regression нельзя override; metric regression требует явного `--override-metrics`.
- [ ] Skill revisions имеют immutable snapshots, detailed eval runs и поддерживают rollback.
- [ ] Endurance benchmark выполняет не менее 10 последовательных compactions, продолжает сессию после restart/provider
  switch и показывает total-token `savingsRatio >= 0.20` с учётом compaction cost против baseline без proactive
  compaction.
- [ ] `bunx biome check .`, `bun test`, `bun run lint`, `bun run build` проходят.
- [ ] Все ручные тест-кейсы заполнены.
