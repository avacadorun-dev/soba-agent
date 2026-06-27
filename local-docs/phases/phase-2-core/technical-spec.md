# Фаза 2 — Техническая спецификация

Этот документ является нормативным источником runtime-контрактов Phase 2. При расхождении с `design.md`, use cases
или plan применяется этот документ.

## Provider Contract

Context Intelligence не выводит возможности provider из имени adapter или URL. Каждый adapter обязан явно
предоставить identity, capabilities и классификацию ошибок:

Ниже показаны Phase 2 additions к существующему `ProviderAdapter`; Phase 1 convert/create/stream contract остаётся
обязательным.

```typescript
interface ProviderIdentity {
  adapterId: string;
  endpointOrigin: string;
  model: string;
}

interface ProviderCapabilities {
  nativeCompaction: boolean;
  structuredOutput: boolean;
  developerMessages: boolean;
  continuationCompatibilityKey?: string;
}

interface NativeCompactionInput {
  model: string;
  input: ItemParam[];
  instructions?: string;
  previousResponseId?: string;
}

type ProviderErrorKind =
  | "context_overflow"
  | "rate_limit"
  | "authentication"
  | "timeout"
  | "transient"
  | "unknown";

interface ProviderAdapter {
  getIdentity(config: ProviderConfig): ProviderIdentity;
  getCapabilities(config: ProviderConfig): ProviderCapabilities;
  classifyError(error: unknown): ProviderErrorKind;
  compactNative?(input: NativeCompactionInput, signal: AbortSignal): Promise<NativeContinuation>;
}
```

- `nativeCompaction: true` допустим только при наличии рабочего `compactNative`.
- Adapter для общего OpenAI-compatible endpoint по умолчанию объявляет `nativeCompaction: false`.
- `context_overflow` recovery запускается только после `classifyError(error) === "context_overflow"`.
- `classifyError` обязан принимать как transport exception, так и failed/incomplete provider response.
- Native continuation совместима только при точном совпадении непустого `continuationCompatibilityKey`. Совпадение
  только `adapterId`, endpoint или model недостаточно.
- Portable-only и deterministic стратегии обязаны работать без native compact API и structured output.
- `OpenResponsesClient` не приводит adapter к конкретному `OpenAIAdapter` и не хардкодит native compact transport:
  streaming state и native compaction доступны только через общий adapter contract.
- Adapter никогда не отбрасывает developer messages. При `developerMessages: false` он преобразует их в явно
  маркированные system messages с сохранением порядка; generic OpenAI-compatible adapter по умолчанию использует
  этот fallback.

## Session Format v2

### Migration

- Новые сессии создаются с `SessionHeader.version = 2`.
- Session v1 читается без изменения файла.
- При первой записи Phase 2 entry в v1-сессию добавляется `session_migration` entry и дальнейшие записи используют
  v2 contracts.
- Неизвестные v2 fields игнорируются при чтении, чтобы обеспечить forward compatibility.
- История остаётся append-only; migration не переписывает существующие строки.
- Legacy v1 `compaction` entries остаются читаемыми и продолжают определять effective input до появления первой
  `context_capsule` в выбранной ветке.
- Phase 2 session storage использует канонический полный `ItemParam` contract из client layer; migration не должна
  потерять developer/reasoning/reference или неизвестные forward-compatible items.

```typescript
interface SessionMigrationEntry {
  type: "session_migration";
  timestamp: string;
  fromVersion: 1;
  toVersion: 2;
}
```

Reader определяет effective session version по последнему валидному migration entry. Migration entry не участвует
в дереве conversation entries и не попадает в LLM input.

### Current Branch Cursor

Активная ветка должна однозначно восстанавливаться после перезапуска, включая случай rewind без следующего сообщения.
Для этого после каждого append tree entry и каждого перемещения leaf записывается sidecar entry:

```typescript
interface SessionCursorEntry {
  type: "session_cursor";
  timestamp: string;
  leafId: string | null;
  reason: "append" | "rewind" | "reset";
}
```

Reader использует последний валидный `session_cursor`. Для v1-сессии без cursor текущим leaf считается последний
tree entry в порядке файла. Cursor не участвует в дереве и не попадает в LLM input.

### Context Capsule Entry

```typescript
type CapsuleTrigger =
  | "hard_limit"
  | "context_overflow"
  | "user_request"
  | "turn_complete"
  | "milestone"
  | "plan_pivot";

interface PortableContextState {
  goal: string;
  constraints: string[];
  completed: string[];
  inProgress: string[];
  pending: string[];
  decisions: Array<{ decision: string; rationale?: string }>;
  blockers: string[];
  nextSteps: string[];
}

interface ArtifactLedger {
  readFiles: string[];
  modifiedFiles: string[];
  verificationCommands: string[];
  verificationStatus: "passed" | "failed" | "unknown";
}

interface NativeContinuation {
  provider: ProviderIdentity;
  compatibilityKey: string;
  responseId?: string;
  items: ItemParam[];
}

interface ActivatedSkillRef {
  name: string;
  scope: "project" | "user" | "bundled";
  revision: string;
  contentHash: string;
}

interface SkillActivationEntry extends SessionEntryBase {
  type: "skill_activation";
  action: "activate" | "deactivate";
  skill: ActivatedSkillRef;
}

interface ContextCapsuleEntry extends SessionEntryBase {
  type: "context_capsule";
  checkpointId: string;
  trigger: CapsuleTrigger;
  strategy: "native_portable" | "portable_only" | "deterministic";
  quality: "native" | "portable" | "degraded";
  portableState: PortableContextState;
  artifacts: ArtifactLedger;
  activatedSkills: ActivatedSkillRef[];
  nativeContinuation?: NativeContinuation;
  provenance: {
    firstCompactedEntryId: string;
    firstKeptEntryId: string;
    sourceEntryIds: string[];
  };
  metrics: {
    effectiveTokensBefore: number;
    estimatedTokensAfter: number;
    reclaimedTokens: number;
    savingsRatio: number;
    generationDurationMs: number;
  };
}
```

`checkpointId` имеет формат `ck_<12 lowercase hex chars>` и уникален внутри сессии.

`quality` имеет фиксированную семантику:

- `native` — сохранены native continuation и валидный portable state;
- `portable` — сохранён валидный model-generated portable state без native continuation;
- `degraded` — portable state создан deterministic fallback.

### Effective Input

`SessionManager.buildInput()` выбирает последнюю capsule текущей ветки. Active skill refs начинаются с
`ContextCapsuleEntry.activatedSkills`, затем к ним по порядку применяются `skill_activation` entries после capsule.
Если capsule нет, refs начинаются с пустого набора и к нему применяются все activation/deactivation entries ветки.

1. Если в ветке ещё нет `context_capsule`, применяется существующий Phase 1 алгоритм для последнего legacy
   `compaction`.
2. Если `nativeContinuation.compatibilityKey` точно совпадает с активным provider, используются native items.
3. Иначе portable state сериализуется как developer message с заголовком `SOBA Context Capsule`.
4. Затем добавляются session items начиная с `firstKeptEntryId`.
5. SkillManager ищет точную revision/content hash и добавляет полный `SKILL.md` как ephemeral developer message при
   построении request.

Если точная revision ранее активированного skill больше недоступна или не trusted, SOBA продолжает без неё,
добавляет diagnostic и не подменяет её другой revision с тем же именем.

Raw skill content не записывается в conversation items или tool outputs. `skill_activation` участвует в session tree,
но не попадает в provider input напрямую. Deactivation и project trust revoke прекращают ephemeral injection со
следующего inference.

## Context Meter

```typescript
interface ContextMeasurementWatermark {
  measuredThroughEntryId: string | null;
  requestFingerprint: string;
}

interface ContextSnapshot {
  source: "provider_usage" | "estimated";
  providerInputTokens: number;
  estimatedTrailingTokens: number;
  effectiveTokens: number;
  historicalTokens: number;
  systemPromptTokens: number;
  toolSchemaTokens: number;
  contextWindow: number;
  maxOutputTokens: number;
  safetyReserveTokens: number;
  hardLimit: number;
  watermark?: ContextMeasurementWatermark;
}
```

`requestFingerprint` является стабильным hash сериализованных system prompt, tool schemas, skills catalog, ephemeral
active skill messages и других не-session частей request.

Provider usage записывается вместе с `measuredThroughEntryId` и `requestFingerprint` отправленного request. Trailing
estimate включает:

- session items после `measuredThroughEntryId`;
- полную локальную оценку effective input, если watermark entry отсутствует в текущей ветке;
- полную локальную оценку effective request, если текущий `requestFingerprint` отличается от измеренного.

Изменение prompt/tools/catalog инвалидирует provider-based shortcut: до следующей usage snapshot получает
`source: "estimated"` и оценивает весь effective request локально. Provider usage не суммируется с уже измеренными
items повторно.

При `source: "provider_usage"` выполняется `effectiveTokens = providerInputTokens + estimatedTrailingTokens`. При
`source: "estimated"` поле `providerInputTokens` равно `0`, а `estimatedTrailingTokens` содержит оценку полного
effective request. `historicalTokens` оценивает все conversation tree entries для аудита и не включает sidecar
entries.

## Trigger Policy

```typescript
interface CompactionConfig {
  auto: boolean;
  compactOnTurnComplete: boolean;
  compactOnMilestone: boolean;
  minTokensForAutoCompact: number;
  minReclaimableTokens: number;
  minSavingsRatio: number;
  keepRecentTokens: number;
  safetyReserveTokens: number;
  backgroundTimeoutMs: number;
}
```

Phase 2 расширяет текущий `SobaConfig` вложенным полем `compaction`. Существующие `contextWindow` и `maxTokens`
сохраняются для обратной совместимости; `ContextSnapshot.maxOutputTokens` всегда получает значение из
`SobaConfig.maxTokens`. CLI-флаг `--max-output-tokens` и env `SOBA_MAX_TOKENS` продолжают изменять это же поле.
`SOBA_AUTO_COMPACT=false` и `--no-auto-compact` переопределяют `compaction.auto`; `/auto-compact on|off` меняет его
только для текущего процесса и не переписывает user config.

Defaults:

```json
{
  "auto": true,
  "compactOnTurnComplete": true,
  "compactOnMilestone": true,
  "minTokensForAutoCompact": 32000,
  "minReclaimableTokens": 12000,
  "minSavingsRatio": 0.25,
  "keepRecentTokens": 20000,
  "safetyReserveTokens": 8192,
  "backgroundTimeoutMs": 15000
}
```

`auto: false` отключает `turn_complete`, `milestone` и `plan_pivot`, но не отключает `hard_limit`,
`context_overflow` и `user_request`.

Приоритет trigger: `context_overflow` > `hard_limit` > `user_request` > `plan_pivot` > `milestone` >
`turn_complete`.

`user_request` игнорирует auto-compaction minima, но возвращает no-op без записи capsule, если
`estimatedTokensAfter >= effectiveTokensBefore`.

Config validation требует:

```text
contextWindow > 0
maxOutputTokens > 0
safetyReserveTokens >= 0
maxOutputTokens + safetyReserveTokens < contextWindow
keepRecentTokens < hardLimit
```

Перед inference ContextManager оценивает полный следующий request. Если он превышает `hardLimit`, request нельзя
отправлять до успешного blocking compaction. Blocking compaction успешна только если post-compaction snapshot
удовлетворяет `effectiveTokens <= hardLimit`. Если deterministic fallback также не освобождает достаточно места,
SOBA не отправляет заведомо переполненный request и возвращает actionable diagnostic.

## Checkpoint Control-Tool

```typescript
interface CheckpointArgs {
  kind: "milestone" | "plan_pivot";
  reason: string;
  completed?: string[];
  pending?: string[];
}
```

- Tool не завершает turn.
- Tool не выполняет compaction внутри параллельного tool batch.
- После завершения batch AgentLoop передаёт событие ContextManager.
- Вызов tool всегда сохраняется в сессии, даже если ROI policy пропустила compaction.

## Compaction Strategies

```typescript
interface CapsuleGenerationInput {
  sessionId: string;
  branchEntryIds: string[];
  sourceItems: ItemParam[];
  firstCompactedEntryId: string;
  firstKeptEntryId: string;
  trigger: CapsuleTrigger;
  customInstructions?: string;
  snapshotBefore: ContextSnapshot;
  provider: ProviderIdentity;
  capabilities: ProviderCapabilities;
}

interface ContextCapsuleDraft {
  strategy: ContextCapsuleEntry["strategy"];
  quality: ContextCapsuleEntry["quality"];
  portableState: PortableContextState;
  artifacts: ArtifactLedger;
  activatedSkills: ActivatedSkillRef[];
  nativeContinuation?: NativeContinuation;
  provenance: ContextCapsuleEntry["provenance"];
  metrics: ContextCapsuleEntry["metrics"];
}

interface CapsuleStrategy {
  name: "native_portable" | "portable_only" | "deterministic";
  supports(capabilities: ProviderCapabilities): boolean;
  generate(input: CapsuleGenerationInput, signal: AbortSignal): Promise<ContextCapsuleDraft>;
}
```

`native_portable` использует compact API только для `nativeContinuation`. Portable state генерируется отдельно и
никогда не извлекается из opaque `encrypted_content`.

`portable_only` использует обычный model response. При наличии structured output применяется schema; иначе ответ
парсится и валидируется как JSON с fallback на deterministic strategy.

`deterministic` извлекает данные из session entries:

- goal: последний пользовательский запрос;
- completed/next steps: accepted finish criteria и checkpoint args;
- modified/read files: tool calls;
- verification status: completion gate evidence и tool results;
- blockers: активные ошибки;
- pending: checkpoint args или пустой список.

## Capsule Validation

Blocking errors:

- отсутствует `goal`;
- `firstKeptEntryId` не принадлежит текущей ветке;
- `firstCompactedEntryId` расположен после `firstKeptEntryId`;
- потерян активный blocker или failed verification;
- source entry принадлежит другой сессии;
- native continuation указан без identity или compatibility key;
- `estimatedTokensAfter > hardLimit` для blocking compaction;
- tool call отделён от соответствующего result на compact/keep boundary.

Warnings:

- пустые pending/nextSteps;
- неизвестный verification status;
- savings ниже policy для ручного compaction;
- отсутствуют activated skills.

Background draft с blocking error отбрасывается. Blocking compaction при blocking error повторяется через
deterministic strategy. Если fallback не проходит post-compaction fit check, inference блокируется с diagnostic.

## Background Scheduling

- Одновременно разрешена одна background compaction operation на сессию.
- Operation получает immutable snapshot branch и leaf id.
- Перед append scheduler проверяет, что leaf id не изменился.
- Новый пользовательский turn отменяет operation.
- Operation timeout задаётся `backgroundTimeoutMs`.
- Background failure не изменяет текущую ветку.

## Skills Contract

### Supported Layout

Skill directory обязан содержать `SKILL.md`. Допустимы любые дополнительные файлы и директории; `scripts/`,
`references/` и `assets/` следуют Agent Skills, а `evals/` является SOBA-specific extension.

Required frontmatter:

```yaml
name: lowercase-hyphen-name
description: What the skill does and when to use it.
```

Optional standard fields: `license`, `compatibility`, `metadata`, `allowed-tools`.

SOBA-specific настройки допускаются только как namespaced string keys внутри standard `metadata`, например
`soba.disable-model-invocation: "true"`. Они сохраняют валидную форму Agent Skills metadata, но их поведение
переносимо только в SOBA.

`allowed-tools` парсится для совместимости и диагностики, но SOBA намеренно не трактует его как pre-approval:
runtime TrustManager всегда имеет приоритет. `/skill list` должен сообщать об этом отклонении.

### Catalog Entry

```typescript
interface SkillDiagnostic {
  code: string;
  severity: "warning" | "error";
  message: string;
  path?: string;
}

interface SkillCatalogEntry {
  name: string;
  description: string;
  location: string;
  scope: "project" | "user" | "bundled";
  trusted: boolean;
  enabled: boolean;
  revision?: string;
  contentHash?: string;
  modelInvocable: boolean;
  diagnostics: SkillDiagnostic[];
}
```

В system prompt попадают только enabled, trusted и model-invocable entries.

Для promoted skill `revision` берётся из immutable revision metadata; для bundled skill используется build-time
content hash. Для внешнего user/project skill без SOBA metadata revision и content hash разрешаются лениво при
activation: `revision = "external_" + contentHash.slice(0, 12)`. Catalog может хранить их как undefined до первой
activation. Это позволяет progressive disclosure не загружать полный skill в model context и сохраняет точный
`ActivatedSkillRef`.

`contentHash` вычисляется по отсортированным relative paths и bytes всего skill payload. Skills с symlinks не проходят
validation; runtime state, `.soba-revision.json`, draft/eval outputs и другие файлы вне опубликованного payload не
входят в hash. Чтение файлов для validation/hash не означает их инъекцию в provider request.

### Activation

```typescript
interface ActivateSkillArgs {
  name: string;
  revision?: string;
}
```

`activate_skill` возвращает короткое подтверждение с `ActivatedSkillRef`, absolute skill directory и списком
доступных resources. Полный `SKILL.md` инъецируется SkillManager как ephemeral developer message в следующий request;
он не сохраняется raw tool output. Tool не исполняет scripts и не регистрирует динамические tools. Runtime activation
фиксирует `SkillActivationEntry`; повторная активация той же revision дедуплицируется, а другая revision того же имени
требует нового activation.

`/skill:<name> [args]` сначала валидирует и сохраняет activation, затем преобразует `args` в обычное user message
следующего turn. Поэтому пользовательская инструкция остаётся в истории, а raw skill content — нет. При пустых
`args` создаётся короткое user message с явным запросом применить выбранный skill.

### Validation

Blocking validation errors:

- отсутствуют `name` или `description`;
- имя не соответствует `^[a-z0-9]+(?:-[a-z0-9]+)*$` или длиннее 64 символов;
- имя не совпадает с именем parent directory;
- description длиннее 1024 символов;
- compatibility длиннее 500 символов;
- metadata не является mapping строковых ключей в строковые значения;
- skill payload содержит symlink или path выходит за skill directory через traversal;
- ссылка на обязательный resource не существует;
- skill обещает sandbox/isolation, которой SOBA не предоставляет.

Unknown top-level fields создают warning, но не блокируют skill. Нарушения официального Agent Skills contract
блокируют cross-agent compatibility; SOBA-specific настройки разрешены только через `metadata` keys с prefix
`soba.`.

### Project Trust

Project trust является отдельной сущностью и не хранится в `TrustManager`, который продолжает отвечать только за
tool/command permissions:

```typescript
interface ProjectIdentity {
  canonicalRoot: string;
  gitCommonDir?: string;
}

interface ProjectTrustRecord {
  project: ProjectIdentity;
  trustedAt: string;
  skillsFingerprint: string;
}
```

- Project root — canonical realpath git root; вне git используется canonical realpath cwd.
- Trust key вычисляется из canonical root и optional git common dir; разные worktree roots не наследуют trust друг
  друга автоматически.
- Trust records хранятся в `~/.soba/project-trust.json`; `skillsFingerprint` является content hash skill tree,
  вычисленным после approval.
- До trust discovery может сообщить roots и количество project skill directories, но не читает их frontmatter/body
  и не добавляет их в catalog.
- `/project-trust status` показывает identity и detected roots. `/project-trust approve` сначала получает
  подтверждение, затем читает skills, сохраняет fingerprint и обновляет catalog. Повторный approve trusted project
  подтверждает изменившийся fingerprint.
- `/project-trust revoke` удаляет trust record и немедленно исключает project skills из catalog.
- Изменение `skillsFingerprint` не отменяет trust проекта, но создаёт visible diagnostic о новых/изменённых skills.
- Trust разрешает чтение project skill instructions, но не pre-approves ни один tool call.
- Project trust gates только project skills. Он не изменяет существующую загрузку `AGENTS.md`/project context.

### Skill Trust

- User и bundled skills доступны по умолчанию.
- Project skills доступны только после project trust.
- Trust разрешает загрузку инструкций, но не pre-approves tool calls.
- `allowed-tools` отображается как metadata и не обходит TrustManager.
- Persistent disable state хранится в `~/.soba/skill-settings.json`. Удаление user/project skill удаляет только
  опубликованную копию; immutable revision history сохраняется для аудита. Purge history не входит в Phase 2.

## Generated Skill Lifecycle

Drafts хранятся в `~/.soba/skill-drafts/<draft-id>/`. Promoted revisions хранятся как immutable snapshots в
`~/.soba/skill-revisions/<scope>/<name>/<revision>/`. Project/user skill directory содержит опубликованную копию
последней revision и `.soba-revision.json`.

Generative slash commands не заканчиваются созданием пустой директории. `/skill new` и `/skill edit ... [instructions]`
запускают `SkillOperationRunner`: отдельную model operation с входом из description/current revision и доступом на
запись только через draft-rooted filesystem facade. Core `bash`, network и произвольные workspace writes runner не
предоставляет. Raw generation/evaluation turns не загрязняют основной conversation input; в текущую сессию
добавляются operation summary, diff, diagnostics и eval result.

```typescript
interface SkillRevision {
  revision: string;
  createdAt: string;
  source: "generated" | "edited";
  scope: "project" | "user";
  contentHash: string;
  snapshotPath: string;
  evalRunId: string;
  previousRevision?: string;
}
```

Promotion требует:

- validation без blocking errors;
- минимум один eval case для generated skill;
- минимум один passed case и отсутствие failed cases для generated/edited skill;
- отсутствие semantic/safety regression; только tool/token metric regression допускает явный override;
- подтверждение target scope пользователем;
- target project scope уже trusted; promotion не доверяет весь project автоматически.

Rollback не изменяет старые revisions: он копирует выбранный immutable snapshot в новый draft, повторяет validation
и evals, затем создаёт новую revision после approval.

## Skill Evals

Минимальный `evals/cases.json`:

```json
[
  {
    "name": "generates a conventional commit proposal",
    "prompt": "Prepare a commit message for the staged changes",
    "expected": ["reads staged diff", "does not commit without confirmation"],
    "forbidden": ["git push", "commit without confirmation"]
  }
]
```

Phase 2 evaluator валидирует case schema и запускает отдельный evaluation turn с recording tool facade. По умолчанию
facade разрешает чтение fixtures и записывает намерения вызова tools без реальных side effects. Assertions
проверяются deterministic matchers для известных tool intents и evaluator model для semantic output. Неоднозначные
или опасные сценарии должны быть skipped с diagnostic.

```typescript
interface SkillEvalRun {
  id: string;
  revisionCandidateHash: string;
  evaluatorConfigHash: string;
  createdAt: string;
  cases: Array<{
    name: string;
    status: "passed" | "failed" | "skipped";
    expectedMatched: string[];
    expectedMissing: string[];
    forbiddenObserved: string[];
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    userInterventionRequired: boolean;
    transcriptHash: string;
    diagnostic?: string;
  }>;
}
```

Regression автоматически сравнивается только для одинаковых case names и `evaluatorConfigHash`. Новый failure,
исчезнувший expected или появившийся forbidden intent является non-overridable regression Phase 2. Превышение
настраиваемого лимита tool calls/tokens можно принять явным override. При изменении evaluator config требуется
явный re-baseline, а не автоматическое сравнение несопоставимых runs.

`/skill eval <name|draft-id> --rebaseline` повторно запускает latest promoted revision и target candidate под текущей
evaluator config, сохраняет сопоставимые runs и явно назначает run promoted revision новым baseline. Для draft без
promoted predecessor команда отклоняется как неприменимая. `/skill promote ... --override-metrics` может принять
только regression по tool/token metrics и никогда не отменяет validation, failed case, missing expected или
forbidden intent.

## Workflow Observation

Observation по умолчанию выключен. При включении observer получает события accepted turn completion независимо от
того, создавалась ли capsule. Хранятся только salted hashes нормализованных tool-name sequences, outcome и aggregate
counters; аргументы, пути, prompt и tool output не сохраняются. Данные находятся в
`~/.soba/workflow-observations.json`, очищаются через `/skill observe clear` и не используются после opt-out.

При достижении threshold предложение формируется из transient summary текущего accepted turn и совпавшей
последовательности tool names. Summary прошлых turns из observation store не восстанавливается и не сохраняется.

## Endurance Acceptance

Release benchmark использует фиксированный scripted workload и фиксирует:

```typescript
interface EnduranceResult {
  workloadId: string;
  environment: string;
  config: CompactionConfig;
  compactions: number;
  overflowErrors: number;
  manualRestarts: number;
  capsuleInvariantFailures: number;
  peakEffectiveTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  compactionInputTokens: number;
  compactionOutputTokens: number;
  totalTokens: number;
  baselineTotalTokens: number;
  savingsRatio: number;
}
```

`savingsRatio` рассчитывается как:

```text
(baselineTotalTokens - totalTokens) / baselineTotalTokens
```

Baseline выполняет тот же workload с proactive compaction off и достаточно большим context window, чтобы сравнение
не завершалось преждевременным overflow. `totalTokens` включает обычные и compaction input/output tokens; отчёт также
сохраняет peak effective context.

Сравниваемые runs используют одинаковые workload inputs, tool fixtures, provider/model, model parameters и evaluator
version. Если provider usage недоступна хотя бы в одном run, оба run используют один и тот же локальный estimator и
отчёт явно маркируется estimated.

Минимальный acceptance threshold Phase 2:

- не менее десяти последовательных compactions;
- один process restart/resume и один switch на provider без native compaction;
- `overflowErrors = 0`, `manualRestarts = 0`, `capsuleInvariantFailures = 0`;
- `savingsRatio >= 0.20` против baseline без proactive compaction; product target остаётся 0.30–0.40.

Benchmark не доказывает достижение KPI 6 часов сам по себе; он является воспроизводимым release proxy. Фактический
6-hour KPI измеряется отдельно на реальных dogfooding sessions.

## Commands

| Команда | Контракт |
|---|---|
| `/compact [instructions]` | Blocking manual compaction или no-op |
| `/auto-compact on\|off` | Переключает только proactive triggers |
| `/session` | Показывает context metrics, strategy и checkpoints |
| `/capsule <id>` | Показывает portable state и metrics |
| `/rewind [id]` | Список или переход к checkpoint |
| `/project-trust [status\|approve\|revoke]` | Показывает, подтверждает или отзывает trust текущего project identity |
| `/skill list [--invalid\|--disabled]` | Показывает catalog |
| `/skill:<name> [args]` | Явно активирует skill для следующего turn |
| `/skill new <description>` | Создаёт draft |
| `/skill edit <name> [instructions]` | Создаёт и при наличии instructions генерирует draft revision |
| `/skill validate <name\|draft-id>` | Запускает validation |
| `/skill eval <name\|draft-id> [--rebaseline]` | Запускает evals; re-baseline повторно оценивает predecessor и candidate |
| `/skill promote <draft-id> --scope project\|user [--override-metrics]` | Публикует после approval; override применим только к metrics |
| `/skill history <name>` | Показывает revisions |
| `/skill rollback <name> <revision>` | Создаёт draft из immutable revision; далее обычные eval/promotion |
| `/skill rm <name>` | Удаляет или отключает после подтверждения |
| `/skill observe on\|off\|clear` | Управляет privacy-safe workflow observation |

## Events

```typescript
type ContextEvent =
  | { type: "compaction_scheduled"; trigger: CapsuleTrigger; background: boolean }
  | { type: "compaction_started"; trigger: CapsuleTrigger; strategy: string }
  | { type: "compaction_completed"; checkpointId: string; metrics: ContextCapsuleEntry["metrics"] }
  | { type: "compaction_skipped"; trigger: CapsuleTrigger; reason: string }
  | { type: "compaction_failed"; trigger: CapsuleTrigger; error: string }
  | { type: "skill_catalog_updated"; count: number }
  | { type: "project_trust_changed"; projectRoot: string; trusted: boolean }
  | { type: "skill_activated"; skill: ActivatedSkillRef }
  | { type: "skill_deactivated"; skill: ActivatedSkillRef; reason: string }
  | { type: "skill_draft_created"; draftId: string }
  | { type: "skill_eval_completed"; target: string; passed: number; failed: number };
```

## Out of Scope

- Visual Layer и browser tools;
- dynamic executable extensions;
- marketplace и remote skill installation;
- настоящий OS/container sandbox;
- полностью автономное создание или promotion skills;
- semantic/vector search по тысячам skills.
