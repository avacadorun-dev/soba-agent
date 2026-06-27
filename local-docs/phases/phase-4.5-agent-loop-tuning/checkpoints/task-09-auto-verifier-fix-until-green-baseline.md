# Task 09 checkpoint — Auto-Verifier + Fix-Until-Green baseline

Date: 2026-06-20

## Command detector coverage

- Project instructions, `package.json`, known config files and SOBA defaults are supported by `detectProjectCommands`.
- SOBA fixture selects Bun/Biome-first commands: `bun test`, `bun run lint`, `bunx tsc --noEmit`, `bun run build`.
- Full/release gate can include `.soba/skills/ts-morph-analyzer/scripts/dead-code.ts`.
- ESLint, Prettier and npm suggestions are rejected or skipped for SOBA-style projects.

## Supported diagnostic parsers

- Bun test failures: `bun test` output and `(fail)` records.
- Biome failures: `biome` output and SOBA `bun run lint` output.
- TypeScript failures: `TSxxxx` diagnostics from `bunx tsc --noEmit`.
- Build failures: `bun run build` output with failed/error lines.

## Stop conditions

- Default recovery budget is 3 iterations.
- Repeated identical diagnostic without progress stops as `blocked`.
- Exhausting the recovery budget stops as `max_iterations`.
- Unsafe recovery commands such as `rm`, `sudo`, network commands and destructive git operations stop as `unsafe`.
- Passing targeted verification records final status `passed`.

## Eval results

- UC-AL-05: PASS via `tests/core/fix-until-green/controller.test.ts`.
- UC-AL-06: PASS via `tests/core/fix-until-green/controller.test.ts`.
- Agent loop eval baseline: PASS via `bun test tests/evals/agent-loop`.
