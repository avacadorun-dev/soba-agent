# 20 — Pre-commit hook

**ID:** 0.4-OPS-02  
**Priority:** P2  
**Estimate:** S  
**Depends on:** 0.4-OPS-01  
**Block:** UX/finalization

## Goal

Добавить локальный Bun-only pre-commit hook с минимальным quality gate и инструкцией установки.

## Local context

P2 задача. Может быть отложена, если release risk высокий. Не добавлять husky/lint-staged/npm-only tooling без отдельного решения.

## Suggested files

- `.hooks/pre-commit`
- docs section in `CONTRIBUTING.md` or relevant developer docs.

## Requirements

- Bun-only commands.
- No ESLint/Prettier.
- Minimal gate should mirror CI where practical:
  - Biome/lint;
  - TypeScript;
  - tests relevant or full `bun test`;
  - optional dead-code scan if not too slow.
- Clear install instruction, e.g. `git config core.hooksPath .hooks`.
- Hook is executable where possible.

## Tests / validation

- Shell script syntax validates.
- Commands exist in package scripts or are explicit Bun commands.

## Verification

```bash
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional. If deferred, record why and what remains.
