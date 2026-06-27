# Фаза 2 — Context Intelligence + Adaptive Skills

**Версия:** SOBA 0.3.0
**Runtime:** Bun
**Предыдущая фаза:** Phase 1 — MVP (v0.2.x)
**Scope:** proactive context management и Agent Skills
**Не входит:** Visual Layer — перенесён в Phase 3

## Цель фазы

Phase 2 должна позволить разработчику вести длинные сессии без ручных рестартов и превращать повторяемые рабочие
процессы в переносимые навыки.

Два трека образуют единый цикл:

1. **Context Intelligence** сохраняет проверяемое состояние работы в `ContextCapsule`.
2. **Adaptive Skills** загружает специализированные инструкции по необходимости и позволяет создавать новые skills
   из успешных процессов.

Ключевая продуктовая идея:

> SOBA не просто сжимает историю и загружает инструкции. Он превращает накопленный опыт сессии в проверяемое
> состояние и повторно используемые навыки.

## Принципы

- Фактическая provider usage имеет приоритет над локальной оценкой токенов.
- Provider capabilities и overflow errors объявляются adapter явно, а не угадываются по endpoint/model.
- Ephemeral developer messages с capsule/skill instructions не могут быть молча отброшены adapter: используется
  native role или маркированный system fallback.
- Compaction не должен происходить только потому, что обнаружена граница задачи: требуется измеримая экономия.
- Blocking compaction считается успешным только если следующий полный request помещается в hard limit.
- Каждый checkpoint содержит переносимое состояние, даже если provider поддерживает native compact API.
- Skills следуют открытому формату Agent Skills и используют progressive disclosure.
- Skill — инструкции и ресурсы, а не привилегированный динамический tool.
- Исполняемый код skill запускается существующими tools и проходит обычный TrustManager flow.
- Project-local skills загружаются только после подтверждения доверия проекту.
- Автоматическое обучение предлагает изменения, но не применяет их без подтверждения пользователя.

## Архитектура

```text
AgentLoop
  |
  +-- ContextManager
  |     +-- ContextMeter
  |     +-- TriggerPolicy
  |     +-- CapsuleGenerator
  |     +-- CapsuleValidator
  |     +-- CompactionScheduler
  |
  +-- SessionManager v2
  |     +-- ContextCapsule entries
  |     +-- native continuation items
  |     +-- persistent branch cursor
  |     +-- portable rewind
  |
  +-- SkillManager
        +-- SkillDiscovery
        +-- SkillCatalog
        +-- SkillActivator
        +-- SkillValidator
        +-- SkillEvaluator
        +-- ProjectTrustStore
```

## Track A: Context Intelligence

### Контекстные уровни

SOBA различает три размера контекста:

| Метрика | Назначение |
|---|---|
| `providerInputTokens` | Последняя фактическая usage с watermark request; основной источник истины |
| `estimatedTrailingTokens` | Items, добавленные после последней provider usage |
| `historicalTokens` | Полная append-only история сессии для аудита |

Текущий effective context:

```text
effectiveTokens = providerInputTokens + estimatedTrailingTokens
hardLimit = contextWindow - maxOutputTokens - safetyReserveTokens
```

Provider usage сохраняется вместе с последним измеренным session entry и fingerprint non-session input. При
изменении system prompt, tool schemas или skills catalog provider-based measurement инвалидируется до следующего
успешного response. При отсутствии валидной usage весь effective request оценивается локально.

### Триггеры compaction

| Триггер | Режим | Назначение |
|---|---|---|
| `hard_limit` | blocking | Не допустить context overflow перед следующим inference |
| `context_overflow` | blocking + retry | Восстановиться после ошибки provider |
| `user_request` | blocking | Явный `/compact` |
| `turn_complete` | background | Освободить контекст между пользовательскими задачами |
| `milestone` | background или blocking | Зафиксировать завершённую внутреннюю подзадачу |
| `plan_pivot` | background или blocking | Сохранить старый подход перед сменой плана |

`turn_complete` берётся из существующего completion flow AgentLoop. Для внутренних границ добавляется control-tool
`checkpoint`, который не завершает пользовательский turn. Это внутренний orchestration tool, а не новая общая
capability или динамический extension tool.

### Политика запуска

Blocking compaction выполняется всегда, если иначе следующий полный request превысит `hardLimit`. После compaction
ContextManager повторно измеряет request; если даже deterministic fallback не помещается в limit, inference не
отправляется и пользователь получает diagnostic.

Background compaction выполняется только если:

```text
reclaimableTokens >= minReclaimableTokens
AND estimatedSavingsRatio >= minSavingsRatio
AND effectiveTokens >= minTokensForAutoCompact
```

Background operation отменяется, если пользователь отправил новый запрос до её завершения. Следующий hard-limit
trigger повторит compaction синхронно при необходимости.

### Context Capsule

Каждый успешный compaction создаёт `ContextCapsule` с двумя слоями:

- **portable state** — человекочитаемое структурированное состояние для rewind, аудита и смены provider;
- **native continuation** — opaque provider-native compaction items, если provider их поддерживает.

Portable state сохраняет:

- цель и ограничения;
- завершённую, текущую и ожидающую работу;
- решения и rationale;
- blockers и следующие шаги;
- прочитанные и изменённые файлы;
- команды и статус верификации;
- точные references активированных skills: scope, revision и content hash;
- provenance исходных session entries.

Точный формат определён в [technical-spec.md](./technical-spec.md).

### Стратегии генерации capsule

1. **Native + portable**: provider compact API создаёт continuation items, отдельный structured-summary вызов создаёт
   portable state.
2. **Portable only**: обычный model response со structured output, если compact API недоступен.
3. **Deterministic fallback**: извлечение файлов, tool outcomes, finish criteria, ошибок и последних user messages без
   дополнительного LLM-вызова.

Fallback должен всегда создавать валидную capsule, но может выставить `quality: "degraded"`.

### Quality Gate

До записи capsule валидатор проверяет:

- присутствует goal и определены поля pending work и next steps; пустые списки дают diagnostic, но не делают
  завершённую задачу невалидной;
- сохранены modified files, failed verification и blockers;
- tool call не отделён от соответствующего result;
- `firstKeptEntryId` существует в текущей ветке;
- capsule не ссылается на entries другой сессии;
- ожидаемая экономия соответствует trigger policy.
- blocking capsule действительно уменьшает следующий request до `hardLimit`.

При ошибке background compaction отбрасывается. Ошибка blocking compaction переводит систему на deterministic
fallback.

### Rewind

`/rewind` перемещает leaf текущей append-only сессии к выбранному checkpoint. Persistent session cursor сохраняет
выбранный leaf даже при перезапуске до следующего сообщения. Следующее сообщение создаёт новую ветку.

Native continuation используется только при точном совпадении provider-issued compatibility key. При несовместимости
или смене provider используется portable state. История не удаляется.

## Track B: Adaptive Skills

### Модель skill

SOBA принимает формат Agent Skills:

```text
my-skill/
├── SKILL.md
├── scripts/
├── references/
├── assets/
└── evals/
```

`SKILL.md` содержит YAML frontmatter и инструкции:

```markdown
---
name: commit-message
description: Generates a conventional commit message from staged changes. Use when preparing a git commit.
compatibility: Requires git.
metadata:
  soba.disable-model-invocation: "false"
---

# Commit Message

Read the staged diff, propose a conventional commit message, and ask for confirmation before committing.
```

Обязательны только `name` и `description`; имя должно совпадать с parent directory. SOBA не вводит собственные
`triggers`: описание является основным семантическим сигналом активации. `evals/` и namespaced `metadata` keys с
prefix `soba.` являются явными SOBA extensions. Standard `allowed-tools` не даёт pre-approval, потому что
TrustManager всегда имеет приоритет.

### Progressive disclosure

1. При старте в model context загружается только catalog: `name`, `description`, `location`, `scope`.
2. Catalog добавляется в system prompt.
3. Модель вызывает `activate_skill(name)` или пользователь вводит `/skill:<name>`.
4. В session tree сохраняется точная activation reference, а полный `SKILL.md` эфемерно добавляется в request после
   повторной проверки trust/revision.
5. References, scripts и assets читаются только при необходимости существующими tools.

Активированный skill дедуплицируется по точной revision и сохраняется в capsule как reference с content hash всего
опубликованного payload. Для внешнего skill revision/hash разрешаются лениво при activation. При rewind SOBA не
подменяет отсутствующую revision новой revision с тем же именем. Raw skill content не сохраняется в conversation
items, поэтому revoke/deactivation прекращает его загрузку со следующего inference.

### Discovery и precedence

От высокого приоритета к низкому:

1. `.soba/skills/` текущего проекта;
2. `.agents/skills/` текущего проекта и родителей до git root;
3. `~/.soba/skills/`;
4. `~/.agents/skills/`;
5. bundled skills.

Project-local skills не читаются и не попадают в catalog до подтверждения project trust. Project trust хранится
отдельно от tool permissions и привязан к canonical git root/realpath. При коллизии имён выбирается skill с более
высоким приоритетом, а пользователь получает diagnostic. Trust можно отозвать без перезапуска; он gates только
project skills и не меняет существующий механизм загрузки `AGENTS.md`.

### Безопасность

Skill не исполняется как TypeScript module внутри процесса SOBA. Он может инструктировать модель использовать
`read`, `write`, `edit` и `bash`; все действия проходят существующие permission и TrustManager policies.

SOBA явно сообщает:

- skill не является security boundary;
- scripts выполняются с правами пользователя;
- реальная изоляция требует container, VM или OS sandbox.

Программные расширения с динамическими tools не входят в Phase 2 и в будущем должны быть отдельной сущностью
`Extension` с отдельным trust flow.

### Self-Improving Skill Lifecycle

```text
Observe -> Propose -> Draft -> Validate -> Evaluate -> Approve -> Promote -> Improve
```

- `/skill new` создаёт draft, а не сразу активный skill.
- Draft проходит format validation, проверку ссылок и eval cases.
- Пользователь видит diff и выбирает project или user scope.
- `/skill edit` создаёт новую draft revision и повторяет evals.
- Promotion сохраняет immutable content snapshot, content hash и детальные eval results.
- Rollback создаёт новый draft из старого immutable snapshot, а не изменяет историю.
- `/skill rm` требует подтверждения и не удаляет bundled skill; bundled skill можно только персистентно отключить.
- Privacy-safe workflow observation выключен по умолчанию и включается пользователем явно.
- SOBA может предложить skill после повторения workflow, но не создаёт его автоматически.

### Skill Evals

Generated skills должны иметь минимум один eval case. Eval оценивает:

- достигнута ли заявленная цель;
- соблюдены ли ограничения и permissions;
- количество tool calls и затраченных токенов;
- потребовалось ли вмешательство пользователя;
- не ухудшилось ли поведение после изменения skill.

Evals Phase 2 являются локальными сценариями и не требуют отдельного sandbox. Опасные действия должны быть заменены
fixtures или dry-run. Regression определяется по одинаковым cases и evaluator config: failures, missing expectations
и forbidden intents блокируют promotion без override; override допустим только для существенного ухудшения
tool/token metrics. После изменения evaluator config требуется явный re-baseline.

## Уникальность Phase 2

### Portable Context Capsules

Checkpoint хранит одновременно provider-native continuation и переносимое состояние. Это позволяет безопасно менять
provider, продолжать degraded/offline-сессию и объяснять пользователю, что именно было сохранено.

### Context ROI

SOBA оптимизирует не частоту compaction, а полезную экономию контекста относительно стоимости и риска потери
информации. Endurance benchmark подтверждает, что повторные compactions позволяют продолжать длинную сессию и дают
измеримую экономию.

### Experience-to-Skill Loop

Успешные повторяющиеся workflows могут быть предложены как измеряемые skills с evals. Самомодификация происходит
через проверяемые артефакты, а не через скрытую runtime-инъекцию кода.

### Cross-Agent Compatibility

Поддержка Agent Skills и `.agents/skills/` делает skills переносимыми между совместимыми агентами и снижает
vendor lock-in.

## Зависимости и границы

| Область | Зависимости Phase 1 | Новые внешние зависимости |
|---|---|---|
| Context Intelligence | AgentLoop, SessionManager, manual compaction, usage, provider adapter | Нет обязательных |
| Adaptive Skills | System prompt, read/bash tools, TrustManager, config | YAML parser, если не реализован локально |

Visual Layer, dynamic extensions, marketplace и настоящий sandbox не входят в Phase 2.

## Критерии архитектурной готовности

- Все runtime contracts определены в `technical-spec.md`.
- Любой compaction создаёт переносимую capsule.
- Blocking compaction гарантирует post-compaction fit или блокирует переполненный inference с diagnostic.
- Provider без compact API поддерживается без потери возможности продолжить сессию.
- Skills совместимы с Agent Skills и не обходят TrustManager.
- Отклонения SOBA от Agent Skills явно документированы.
- Project skills trust-gated отдельным ProjectTrustStore.
- Generated skills проходят validation, eval и approval до активации.
- Release gate включает воспроизводимый endurance benchmark.
