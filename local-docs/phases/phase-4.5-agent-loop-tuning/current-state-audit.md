# Current State Audit

Этот документ фиксирует наблюдения по текущей реализации Agent Loop, `SYSTEM.md`, prompt builder, completion gate,
compaction, memory и bundled skills. Он не является обвинением текущей архитектуры: большая часть нужного фундамента уже
есть, но слабые модели требуют более жёсткого runtime enforcement.

## Что уже хорошо

- `SYSTEM.md` задаёт канонический контракт агента и явно описывает автономность, verification и finish lifecycle.
- Agent Loop уже поддерживает multi-step execution, tool results, follow-up requests, loop guard и `finish` control tool.
- Completion Gate проверяет незавершённые tool errors, наличие successful tool calls, criteria и verification flag.
- ContextManager, capsules, portable state и background scheduler дают базу для долгих задач и compaction.
- Project Memory и memory tools уже подключены в CLI runtime.
- Skill discovery/catalog/activation уже существуют, и runtime может инжектить активный skill как ephemeral context.
- Checkpoint tool зарегистрирован и имеет schema для milestone/plan_pivot событий.

## Разрывы между идеей и runtime

### 1. Canonical prompt не является single source of truth

`SYSTEM.md` описывает каноническое поведение, но runtime prompt собирается отдельно в
`src/core/prompt/system-prompt.ts`. Внутри prompt builder есть комментарий, что реальный skeleton намеренно избегает
части protocol/compaction деталей. Это создаёт дрейф: правка `SYSTEM.md` может не изменить поведение агента.

Риск для слабых моделей: важные правила остаются в документации, а не в prompt, который реально видит модель.

### 2. Loop contract недостаточно явный

Runtime prompt содержит общие guidelines, но не задаёт короткий обязательный цикл:

```text
understand -> inspect -> plan -> act -> verify -> reflect -> finish
```

Сильная модель может восстановить этот процесс сама. Слабая модель часто завершает раньше, пропускает проверку или не
возвращается к плану после ошибки.

### 3. Finish schema и rejection message расходятся

`finish` schema принимает только список текстовых criteria. При этом rejection message просит связывать критерии с
`evidence_call_ids`, которых нет в публичной schema. Это хороший сигнал желаемой архитектуры, но сейчас evidence contract
не формализован.

### 4. Verification evidence слишком мягкий

После `write/edit` успешный `read` или любой successful `bash` может закрыть `needsVerification`. Для docs-only задач
read inspection допустим, но для code mutation это слабый критерий. Агент должен доказать результат командами проекта:
test, lint, typecheck, build или явно объяснить, почему verification невозможна.

### 5. Text-only fallback может обходить строгий finish

Если модель отвечает текстом после мутации, loop просит продолжить, но политика не должна давать слабой модели закрыть
работу без verification. После code mutation финальный ответ должен быть разрешён только через verified completion или
явный unverified status.

### 6. Checkpoint tool не является настоящим control signal

Tool описывает milestone/plan_pivot события, но Agent Loop не извлекает checkpoint event после batch execution и не
передаёт его ContextManager. Из-за этого compaction/memory не получают структурированные маркеры прогресса.

### 7. Fix-Until-Green запланирован, но не является runtime capability

Документы Phase 3 уже проектируют Fix-Until-Green, но в текущем `src/core` нет отдельного FUG runtime module. Поэтому
loop всё ещё зависит от того, что модель сама выберет и повторит правильные команды.

### 8. Memory policy недостаточно связана с loop

Memory tools есть, injection есть, но нет жёсткой политики:

- когда агент обязан читать память;
- когда можно писать память;
- как сохранять lessons из successful recovery;
- как предотвращать мусорные reflection notes;
- как dedupe-ить повторяющиеся ошибки.

### 9. Built-in skills пока не задают инженерный стандарт

Текущие bundled skills полезны для локальных операций (`commit-message`, `git-summary`, `lint-fix`, `pr-description`,
`version-bump`), но не покрывают базовые workflow разработки: orientation, feature implementation, bug fix, tests,
review, context handoff, fix-until-green.

Отдельный риск: `lint-fix` содержит ESLint/Prettier-примеры. Для SOBA project это конфликтует с AGENTS.md, где
разрешены только Bun и Biome. Skill должен быть project-instructions-first.

### 10. Skill evaluator не измеряет реальное поведение

Evaluator симулирует skill execution и ищет признаки tool mentions. Для тюнинга слабых моделей нужен eval harness:
fixture repos, real/mocked tools, transcript assertions, scoring по outcome и evidence.

### 11. Parallel tool calls опасны для dependent mutations

Provider может вернуть несколько tool calls сразу. Локальное исполнение последовательное, но модель может запланировать
зависимые `edit -> test` в одном response до того, как увидит результат edit. Для слабых моделей mutating batches нужно
ограничить.

## Вывод

SOBA уже имеет фундамент профессионального агента. Следующий уровень качества требует не увеличивать prompt бесконечно,
а перенести инженерные гарантии в runtime:

- явный workflow contract;
- evidence ledger;
- строгая verification policy;
- auto-verifier;
- fix-until-green;
- checkpoint/memory/reflection integration;
- skills как исполняемые playbooks;
- evals как главный инструмент тюнинга.
