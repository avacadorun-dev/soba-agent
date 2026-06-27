# 17 — Mutating batch guard

**ID:** 0.4-AL-15  
**Priority:** P1  
**Estimate:** M  
**Depends on:** 0.4-AL-03  
**Block:** Agent-computer interface

## Goal

Запретить dependent mutating tool batches that skip observation: edit/write and dependent verification must not run in the
same unobserved model response for weak-risk paths.

## Local context

Parallel reads/searches are fine. Mutations require observation and verification boundary.

## Suggested files

- `src/core/loop/agent-loop.ts`
- `src/core/loop/tool-batch-guard.ts`
- `tests/core/loop/`
- `tests/evals/agent-loop/`

## Requirements

- Detect batches that combine dependent mutation and verification.
- Allow independent safe read/search batches.
- Gate edit/write before verification observation.
- Weak profile can disable provider parallel mutating calls.
- Rejection tells model the next allowed step.

## Tests

- UC-AL-10 cannot edit and run dependent test in one unobserved response;
- multiple safe reads can run together;
- write followed by unrelated read is handled safely;
- rejection message is actionable and schema-aligned.

## Verification

```bash
bun test tests/core/loop
bun test tests/evals/agent-loop
bun test
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional. Include in final release checkpoint if no separate checkpoint is created.
