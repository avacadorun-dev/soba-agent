# 08 — CI quality gate

**ID:** 0.4-OPS-01  
**Priority:** P1  
**Estimate:** M  
**Depends on:** —  
**Block:** Foundation

## Goal

Добавить Bun-only CI quality gate: Biome, TypeScript, tests, build, dead-code scan.

## Local context

CI не должен добавлять ESLint/Prettier/npm/yarn/pnpm workflows. Всё через Bun.

## Suggested files

- `.github/workflows/ci.yml`
- при необходимости docs для quality gate.

## Requirements

- Runs on push/PR.
- Uses Bun setup.
- Commands:
  - `bun install --frozen-lockfile`;
  - `bun run lint` or `bunx biome check .` according to package scripts;
  - `bunx tsc --noEmit`;
  - `bun test`;
  - `bun run build`;
  - `bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts`.
- No ESLint/Prettier config/deps introduced.

## Tests / validation

- YAML validates structurally.
- Commands match actual package scripts.

## Verification

```bash
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional ops checkpoint after task if CI commands differ from roadmap.
