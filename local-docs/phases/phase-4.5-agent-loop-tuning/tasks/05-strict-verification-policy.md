# 05 — Strict verification policy

**ID:** 0.4-AL-03  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-AL-02  
**Block:** Evidence and completion

## Goal

Добавить task-kind verification policy и запретить successful finish для code mutations без command evidence.

## Local context

Docs-only tasks могут завершаться через read/diff inspection. Code-changing tasks требуют command evidence, если
пользователь явно не разрешил unverified completion.

## Suggested files

- `src/core/loop/verification-policy.ts`
- `src/core/loop/completion-gate.ts`
- `src/core/loop/agent-loop.ts`
- `tests/core/loop/verification-policy.test.ts`
- `tests/core/loop/completion-gate.test.ts`

## Requirements

- Verification requirement depends on `TaskKind`.
- `read` does not verify code mutation.
- Docs-only changes can be verified by diff/manual inspection evidence.
- `completed` is rejected while unverified code mutations exist.
- Rejection tells the model the next allowed action.

## Tests

- UC-AL-01 fails without command verification;
- UC-AL-04 passes with docs inspection;
- review task can finish without mutation verification;
- feature/refactor/bug fix require command evidence;
- blocked status remains allowed with concrete blocker.

## Verification

```bash
bun test tests/core/loop/verification-policy.test.ts
bun test tests/core/loop/completion-gate.test.ts
bun test
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional here, mandatory after task 06.
