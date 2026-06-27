# 11 — Reflection memory policy

**ID:** 0.4-AL-09  
**Priority:** P1  
**Estimate:** M  
**Depends on:** 0.4-AL-07, 0.4-AL-08  
**Block:** Long-task state and memory

## Goal

Сохранять lessons из successful recovery и long-task pivots в Project Memory только после фильтров secret/dedupe/relevance.

## Local context

Memory может помогать плану как hypothesis, но не заменяет current inspect/verify.

## Suggested files

- `src/core/memory/`
- `src/core/loop/agent-loop.ts`
- `tests/core/memory/`
- `tests/evals/agent-loop/`

## Requirements

- Relevant memory is read at task start when policy requires it.
- Recovery lesson can be written only after observable success.
- Reflection note includes concise problem, cause, fix and verification.
- Secret filter prevents storing credentials/tokens/env values.
- Dedupe prevents repeated noisy lessons.

## Tests

- UC-AL-08 uses memory as hypothesis and still inspects current code;
- successful recovery writes a concise lesson;
- failed/blocked recovery does not write success lesson;
- secret-like value is rejected;
- duplicate lesson is ignored or merged.

## Verification

```bash
bun test tests/core/memory
bun test tests/evals/agent-loop
bun test
bun run lint
bunx tsc --noEmit
```

## Mandatory checkpoint after this task

Create checkpoint: **checkpoint/memory integration baseline**.

Include:

- checkpoint event behavior;
- capsule artifacts;
- reflection memory filters;
- known memory non-goals.
