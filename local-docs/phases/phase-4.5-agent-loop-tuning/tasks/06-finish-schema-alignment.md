# 06 — Finish schema alignment

**ID:** 0.4-AL-04  
**Priority:** P0  
**Estimate:** S  
**Depends on:** 0.4-AL-03  
**Block:** Evidence and completion

## Goal

Синхронизировать `finish` tool schema, completion rejection messages и Evidence Ledger contract.

## Local context

Текущие rejection messages не должны ссылаться на поля, которых нет в schema. Модель должна понимать, какое действие
разрешено дальше.

## Suggested files

- `src/core/loop/agent-loop.ts`
- `src/core/loop/completion-gate.ts`
- `src/core/loop/types.ts`
- `tests/completion-gate.test.ts`
- `tests/agent-loop.test.ts`

## Requirements

- `finish` accepts `summary`, `status`, criteria and optional evidence ids.
- `status` supports `completed`, `blocked`, `completed_with_unverified_changes`.
- Rejection messages reference only public schema fields.
- Completion Gate maps criteria to internal evidence where possible.
- Unverified completion path is explicit and visible in final answer.

## Tests

- valid finish parses;
- invalid/missing summary rejects;
- rejection message does not mention hidden schema fields;
- `completed_with_unverified_changes` is accepted only when policy allows it;
- final answer cannot claim ordinary success when ledger contradicts it.

## Verification

```bash
bun test tests/completion-gate.test.ts
bun test tests/agent-loop.test.ts
bun test
bun run lint
bunx tsc --noEmit
```

## Mandatory checkpoint after this task

Create checkpoint: **Evidence + completion gate baseline**.

Include:

- ledger fields;
- verification policy matrix;
- finish schema;
- failing/passing regression cases.
