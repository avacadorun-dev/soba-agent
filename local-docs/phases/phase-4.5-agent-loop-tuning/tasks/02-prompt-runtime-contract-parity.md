# 02 — Prompt/runtime contract parity

**ID:** 0.4-AL-01  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-AL-00  
**Block:** Contract baseline

## Goal

Закрепить один Agent Loop contract в `SYSTEM.md` и runtime prompt builder.

## Local context

`SYSTEM.md` остаётся каноническим источником. Runtime prompt не должен расходиться с ним и не должен ссылаться на tools,
которых нет в текущем registry.

## Suggested files

- `SYSTEM.md`
- `src/core/prompt/system-prompt.ts`
- `tests/system-prompt.test.ts`
- `tests/core/prompt/`

## Requirements

- Mandatory loop rule присутствует в runtime prompt: understand/inspect/plan/act/verify/reflect/finish.
- Project instructions override generic skill examples.
- Code mutation cannot finish without verification evidence.
- Non-trivial work requires concise visible updates.
- Prompt snapshot/parity tests fail if mandatory sections disappear.
- Runtime prompt only references available tools.

## Tests

- removing mandatory loop rules fails snapshot/parity test;
- runtime prompt contains Working Narration rule;
- prompt builder does not include unavailable tool names;
- project instruction precedence wording is present.

## Verification

```bash
bun test tests/system-prompt.test.ts
bun test
bun run lint
bunx tsc --noEmit
```

## Checkpoint

No checkpoint required unless prompt contract wording changes phase invariants.
