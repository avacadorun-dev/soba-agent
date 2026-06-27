# 01 — Agent Loop eval baseline

**ID:** 0.4-AL-00  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-AL-REL-00  
**Block:** Contract baseline

## Goal

Создать baseline eval suite для коротких prompts, weak-model rails, evidence и finish assertions.

## Local context

Это первая implementation-задача фазы. Не чинить Agent Loop поведение внутри этой задачи, кроме минимальных test harness
hook points. Сначала нужно увидеть baseline failures.

## Suggested files

- `tests/evals/agent-loop/`
- `tests/evals/fixtures/`
- `tests/evals/agent-loop/agent-loop-eval-runner.test.ts`
- `docs/phases/phase-4.5-agent-loop-tuning/eval-results.md`

## Requirements

- Eval cases покрывают UC-AL-01, UC-AL-03, UC-AL-05, UC-AL-10 и UC-AL-13.
- Case model должен фиксировать `modelProfile`, expected task kind, required evidence, required narration и forbidden commands.
- Runner должен уметь работать на mocked traces, чтобы weak-model failures были deterministic.
- Scorer должен проваливать unverified code mutation finish.
- Scorer должен проваливать missing Working Narration для non-trivial tasks.

## Tests

- eval runner passes a good mocked trace;
- eval runner fails unverified mutation;
- eval runner fails forbidden command such as ESLint/Prettier in SOBA fixture;
- eval runner fails missing required narration event;
- eval result report is written or snapshot-tested.

## Verification

```bash
bun test tests/evals/agent-loop
bun test
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional. Create checkpoint only if baseline failures change the task order.
