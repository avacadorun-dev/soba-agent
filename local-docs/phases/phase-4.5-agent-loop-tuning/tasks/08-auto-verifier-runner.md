# 08 — Auto-Verifier runner

**ID:** 0.4-AL-06  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-AL-05  
**Block:** Auto verification and recovery

## Goal

Запускать подходящие verification commands после code mutations, если модель забыла или пытается завершить задачу рано.

## Local context

Auto-Verifier должен идти через safe execution path и писать verification evidence в ledger. Не запускать full gate для
каждой docs-only задачи.

## Suggested files

- `src/core/verification/auto-verifier.ts`
- `src/core/loop/agent-loop.ts`
- `tests/core/verification/auto-verifier.test.ts`
- `tests/core/loop/`

## Requirements

- Select targeted commands by task kind and changed files.
- Full gate available for release/full verification requests.
- Respect trust policy, command timeout and cancellation.
- Write selected/skipped command info to evidence ledger.
- Do not re-run identical verification endlessly.

## Tests

- code mutation triggers targeted verification;
- docs-only mutation does not trigger full command gate by default;
- failing command produces failed verification evidence;
- skipped command includes reason;
- model cannot finish successfully before Auto-Verifier opportunity.

## Verification

```bash
bun test tests/core/verification/auto-verifier.test.ts
bun test tests/core/loop
bun test
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional here, mandatory after task 09.
