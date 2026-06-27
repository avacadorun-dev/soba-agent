# 09 — Fix-Until-Green MVP

**ID:** 0.4-AL-07  
**Priority:** P0  
**Estimate:** L  
**Depends on:** 0.4-AL-06  
**Block:** Auto verification and recovery

## Goal

Реализовать bounded recovery loop: failed verification -> diagnostics -> patch -> targeted verification, max 3 iterations.

## Local context

Fix-Until-Green не должен превращаться в бесконечный tool loop. Если diagnostic повторяется без прогресса, задача
останавливается typed blocker.

## Suggested files

- `src/core/fix-until-green/`
- `src/core/verification/`
- `src/core/loop/agent-loop.ts`
- `tests/core/fix-until-green/`

## Requirements

- Diagnostic parser interface for Bun test, Biome, TypeScript and build failures.
- Max iterations default is 3.
- Stop on repeated same diagnostic without progress.
- Unsafe/destructive recovery action requires user confirmation.
- Each iteration is written to Evidence Ledger.
- Final status is `passed`, `blocked`, `max_iterations` or `unsafe`.

## Tests

- UC-AL-05 passes: failed verification leads to fix and passing verification;
- UC-AL-06 stops with typed blocker on repeated same error;
- max iterations stops without claiming success;
- unsafe recovery action is not executed automatically;
- iteration evidence appears in ledger.

## Verification

```bash
bun test tests/core/fix-until-green
bun test tests/evals/agent-loop
bun test
bun run lint
bunx tsc --noEmit
```

## Mandatory checkpoint after this task

Create checkpoint: **Auto-Verifier + Fix-Until-Green baseline**.

Include:

- command detector coverage;
- supported diagnostic parsers;
- stop conditions;
- eval results for UC-AL-05 and UC-AL-06.
