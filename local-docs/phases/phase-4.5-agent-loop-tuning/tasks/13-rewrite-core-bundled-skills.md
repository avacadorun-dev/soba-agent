# 13 — Rewrite core bundled skills

**ID:** 0.4-AL-11A  
**Priority:** P1  
**Estimate:** L  
**Depends on:** 0.4-AL-10  
**Block:** Built-in Skills 2.0

## Goal

Переписать core bundled skills под protocol 2.0: каждый skill должен быть процедурным, проверяемым и безопасным для SOBA.

## Local context

Не добавлять ESLint/Prettier examples для SOBA. Skills должны уважать Bun/Biome policy и project instructions.

## Suggested files

- `skills/codebase-orientation/SKILL.md`
- `skills/bug-fix/SKILL.md`
- `skills/feature-implementation/SKILL.md`
- `skills/test-authoring/SKILL.md`
- `skills/fix-until-green/SKILL.md`
- `skills/code-review/SKILL.md`
- `skills/context-handoff/SKILL.md`
- `skills/memory-capture/SKILL.md`
- existing bundled skills

## Requirements

- Add missing core engineering skills.
- Rewrite `lint-fix` as Bun/Biome-safe and project-instructions-first.
- Every skill has verification contract and failure recovery.
- Review skill preserves findings-first behavior and does not mutate files unless requested.
- Memory skill writes only stable, filtered lessons.

## Tests

- UC-AL-03 passes skill eval without ESLint/Prettier drift;
- UC-AL-07 activates code-review and does not edit files;
- malformed or incomplete skill fixture fails validation;
- skill trigger precision does not regress baseline.

## Verification

```bash
bun test tests/core/skills
bun test tests/evals/skills
bun test
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional here, mandatory after task 14.
