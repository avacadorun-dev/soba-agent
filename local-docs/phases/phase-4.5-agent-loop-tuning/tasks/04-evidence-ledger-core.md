# 04 — Evidence Ledger core

**ID:** 0.4-AL-02  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-AL-00  
**Block:** Evidence and completion

## Goal

Добавить runtime Evidence Ledger для file reads, searches, mutations, diagnostics, verification commands, checkpoints,
reflections и finish attempts.

## Local context

Completion Gate должен читать ledger, а не доверять финальному тексту модели. Эта задача создаёт data model и recording
points, но ещё не обязана полностью запрещать finish без verification: это task 05.

## Suggested files

- `src/core/loop/evidence-ledger.ts`
- `src/core/loop/types.ts`
- `src/core/loop/agent-loop.ts`
- `tests/core/loop/evidence-ledger.test.ts`

## Requirements

- Every successful `write`/`edit` creates an unverified mutation entry.
- `read`/search tools create inspect evidence.
- Bash/tool failures create diagnostics or active errors.
- Verification-like bash commands create verification evidence with kind/status.
- Ledger summary is available to Completion Gate.
- Ledger entries are compact enough for session/debug use.

## Tests

- write/edit records mutation;
- read/search records inspect evidence;
- failed tool creates active diagnostic;
- successful verification command resolves relevant diagnostic where applicable;
- ledger summary lists unverified mutations.

## Verification

```bash
bun test tests/core/loop/evidence-ledger.test.ts
bun test
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional here, mandatory after task 06.
