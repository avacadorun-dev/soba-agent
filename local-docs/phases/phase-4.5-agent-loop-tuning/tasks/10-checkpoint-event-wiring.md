# 10 — Checkpoint event wiring

**ID:** 0.4-AL-08  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-AL-02  
**Block:** Long-task state and memory

## Goal

Сделать `checkpoint` output control signal для Agent Loop, Evidence Ledger и context/capsule policy.

## Local context

Checkpoint tool уже описывает milestone/plan_pivot события. Agent Loop должен извлекать эти события после tool batch и
передавать их ContextManager.

## Suggested files

- `src/core/tools/checkpoint.ts`
- `src/core/loop/agent-loop.ts`
- `src/core/compaction/`
- `tests/core/tools/checkpoint.test.ts`
- `tests/core/loop/`

## Requirements

- Successful checkpoint tool output creates checkpoint evidence.
- `milestone` can schedule capsule candidate.
- `plan_pivot` records reason and next direction.
- Ledger summary enters capsule artifacts.
- Active skills and memory context are stored as refs, not raw prompt dumps.

## Tests

- UC-AL-09 preserves checkpoint state through capsule;
- checkpoint evidence appears in ledger;
- plan_pivot changes current work plan state;
- compaction after checkpoint keeps goal/completed/pending/verification status.

## Verification

```bash
bun test tests/core/tools/checkpoint.test.ts
bun test tests/core/loop
bun test
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional here, mandatory after task 11.
