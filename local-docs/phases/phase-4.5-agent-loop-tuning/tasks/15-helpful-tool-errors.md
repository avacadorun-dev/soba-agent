# 15 — Helpful tool errors

**ID:** 0.4-AL-13  
**Priority:** P1  
**Estimate:** M  
**Depends on:** 0.4-AL-02  
**Block:** Agent-computer interface

## Goal

Сделать tool errors machine-readable and actionable: error code, category, retryability, nextAction hint.

## Local context

Слабая модель должна получать не просто текст ошибки, а typed clue для следующего шага. Loop guard должен распознавать
повторяющиеся одинаковые failures.

## Suggested files

- `src/core/tools/`
- `src/core/loop/loop-guard.ts`
- `tests/core/tools/`
- `tests/core/loop/loop-guard.test.ts`

## Requirements

- Tool errors include stable code and short nextAction.
- Edit/read/bash errors are mapped to categories.
- Repeated same failure fingerprint triggers recovery or blocker.
- Error output is concise and does not leak secrets.
- Existing TUI/tool rendering remains readable.

## Tests

- repeated exact edit failure triggers improved recovery prompt;
- command not found suggests command detection or install check, not blind retry;
- permission/trust error suggests user confirmation path;
- secret-looking stderr is redacted;
- existing tool tests still pass.

## Verification

```bash
bun test tests/core/tools
bun test tests/core/loop/loop-guard.test.ts
bun test
bun run lint
bunx tsc --noEmit
```

## Checkpoint

No checkpoint required.
