# Phase 3.5 — Portable Capsules: Manual Test Run

## Status

Task 4 wires slash commands `/capsule create`, `/capsule export` and `/capsule load` to the portable capsule
service. These checks can now be executed manually in REPL/TUI mode.

## Automated precheck for Task 4

Run:

```bash
bun test tests/commands.test.ts tests/core/capsules/portable-capsule.test.ts tests/core/capsules/portable-capsule-service.test.ts tests/core/capsules/portable-capsule-quality.test.ts
bun run lint
bunx tsc --noEmit
bun run build
bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts
```

Expected:

- capsule tests pass;
- quality evaluator fixtures score at or above their thresholds;
- lint/typecheck/build pass;
- dead-code analyzer reports `💀 dead: 0`.

## Manual checklist

| Case | Command | Expected | Result |
| --- | --- | --- | --- |
| Create default capsule | `/capsule create "handoff auth work"` | `.soba/capsules/*.capsule.md` is created, no secrets/native continuation | |
| Export by prefix | `/capsule export ck_abc ./handoff.capsule.md` | one file is written, existing destination is not overwritten | |
| Ambiguous prefix | `/capsule export ck_ ./bad.capsule.md` | clear ambiguity error, no file write | |
| Load valid file | `/capsule load ./handoff.capsule.md` | validates checksum and returns untrusted briefing for next turn | |
| Load corrupted file | `/capsule load ./broken.capsule.md` | parse/validation error, no commands executed | |
