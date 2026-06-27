# Phase 4.5 — v0.4.0 Agent Loop Tuning + Built-in Skills

**Цель:** короткий пользовательский запрос должен запускать профессиональный инженерный workflow: агент сам
классифицирует задачу, строит план, читает проектные инструкции, действует маленькими шагами, проверяет результат,
исправляет ошибки до зелёного состояния, кратко показывает observable ход работы и завершает только при наличии
evidence.

**Ключевая идея:** пользователь задаёт outcome, а не процесс. Runtime SOBA отвечает за процесс.

## Scope

Входит:

- единый contract между `SYSTEM.md`, runtime prompt и Agent Loop;
- workflow engine для типовых задач разработки;
- user-visible working narration без раскрытия hidden chain-of-thought;
- Evidence Ledger и строгая verification policy;
- Auto-Verifier и Fix-Until-Green runtime loop;
- checkpoint/compaction/memory интеграция для длинных задач;
- protocol встроенных skills с verification, recovery и memory policies;
- eval suite для слабых моделей и regression replay.

Не входит:

- новая TUI как отдельная продуктовая фича;
- marketplace skills;
- multi-agent delegation;
- замена provider/client protocol;
- добавление ESLint/Prettier или альтернативного runtime к Bun.

## Artifacts

- [`current-state-audit.md`](current-state-audit.md) — что уже есть в коде и где runtime-контракты неполные.
- [`research-notes.md`](research-notes.md) — применимые идеи из ReAct, Reflexion, CRITIC, Self-Refine, SWE-agent,
  Agentless, OpenAI и Anthropic engineering notes.
- [`design.md`](design.md) — целевая архитектура Agent Loop Tuning.
- [`use-cases.md`](use-cases.md) — сценарии, через которые проектируется и тестируется фаза.
- [`technical-spec.md`](technical-spec.md) — нормативные runtime-контракты.
- [`plan.md`](plan.md) — последовательный implementation plan.
- [`implementation-plan.md`](implementation-plan.md) — phase-4 style task sequence 00-18.
- [`tasks/`](tasks/) — отдельные task cards для поочерёдной реализации.
- [`checkpoint-policy.md`](checkpoint-policy.md) — cadence и формат baseline checkpoints.
- [`manual-test-run.md`](manual-test-run.md) — ручные WOW/regression сценарии.

## Success Metrics

| Metric | Target |
|--------|--------|
| Short-prompt task success | > 70% на слабой модели в локальном eval suite |
| Unverified mutation finish rate | 0 |
| Repeated tool-error loops | < 5% задач |
| Fix-Until-Green recovery | > 60% исправимых failures |
| Skill activation precision | > 80% релевантных задач активируют нужный skill |
| Working narration coverage | > 90% нетривиальных eval tasks имеют context/observation/plan/status events |
| Context handoff survival | 100% длинных задач сохраняют goal, changed files, verification status |

## Release Positioning

Phase 4.5 входит в текущий release boundary v0.4.0 как hardening-блок поверх Project Memory и MCP foundation. Без этого
v0.4.0 даёт память и расширяемые tools, но не закрепляет главный пользовательский контракт: короткий prompt должен
запускать проверяемый инженерный workflow.

Публичная версия релиза остаётся **v0.4.0**. Номер 4.5 используется только как phase/epic label для отделения Agent Loop
Tuning от уже существующей папки v0.4.0 Project Memory + MCP.

## Engineering Principle

SOBA не должна надеяться, что модель сама будет вести себя как хороший инженер. Хороший инженерный процесс должен быть
внешним каркасом:

1. prompt сообщает правила и стиль;
2. skills дают процедурные playbooks;
3. loop enforce-ит порядок действий;
4. tools дают проверяемую обратную связь;
5. narration показывает пользователю наблюдаемый ход работы без приватных рассуждений;
6. completion gate не выпускает непроверенный результат;
7. memory сохраняет устойчивые выводы.
