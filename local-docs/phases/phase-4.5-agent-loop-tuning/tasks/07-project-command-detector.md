# 07 — Project command detector

**ID:** 0.4-AL-05  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-AL-03  
**Block:** Auto verification and recovery

## Goal

Научить SOBA определять test/lint/typecheck/build commands из project instructions и project files.

## Local context

Для этого проекта detector обязан выбирать Bun/Biome-first команды и не предлагать ESLint/Prettier.

## Suggested files

- `src/core/verification/project-command-detector.ts`
- `src/core/verification/types.ts`
- `tests/core/verification/project-command-detector.test.ts`

## Requirements

- Command discovery order: project instructions, `package.json`, known config files, SOBA defaults.
- Detect `bun test`, `bun run lint`, `bunx tsc --noEmit`, `bun run build`.
- Detect dead-code command when full gate or release policy requests it.
- Reject or downgrade npm/eslint/prettier suggestions in SOBA fixture.
- Return typed command set with skipped-command reasons.

## Tests

- SOBA fixture returns Bun/Biome commands;
- package with only test script returns targeted test command;
- missing scripts returns safe empty command list with reason;
- ESLint/Prettier are not selected for SOBA;
- project instructions override package scripts.

## Verification

```bash
bun test tests/core/verification/project-command-detector.test.ts
bun test
bun run lint
bunx tsc --noEmit
```

## Checkpoint

No checkpoint required.
