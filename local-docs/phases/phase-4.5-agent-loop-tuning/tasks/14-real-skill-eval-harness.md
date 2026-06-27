# 14 — Real skill eval harness

**ID:** 0.4-AL-12  
**Priority:** P1  
**Estimate:** M  
**Depends on:** 0.4-AL-11A  
**Block:** Built-in Skills 2.0

## Goal

Заменить simulation-only skill evals на fixture-based execution and scoring.

## Local context

Prompt/skill changes не должны попадать в bundled set без eval evidence.

## Suggested files

- `src/core/skills/evaluator.ts`
- `tests/core/skills/evaluator.test.ts`
- `tests/evals/skills/`
- `docs/phases/phase-4.5-agent-loop-tuning/eval-results.md`

## Requirements

- Eval harness runs skill activation against fixture tasks.
- Scores trigger precision, process adherence and verification evidence.
- Bad `lint-fix` example suggesting ESLint fails SOBA eval.
- Reports are deterministic enough for regression review.
- Evals can run in CI or local quality gate without external model dependency by using mocked traces.

## Tests

- good skill trace passes;
- missing skill activation fails required skill case;
- bad lint-fix example fails;
- report contains score breakdown and regressions.

## Verification

```bash
bun test tests/core/skills/evaluator.test.ts
bun test tests/evals/skills
bun test
bun run lint
bunx tsc --noEmit
```

## Mandatory checkpoint after this task

Create checkpoint: **Built-in Skills 2.0 baseline**.

Include:

- validated skill list;
- eval coverage;
- known skill gaps;
- regression report path.
