# Phase 3.5 — Portable Capsules: Validation

## Scope

Validation covers portable capsule fidelity, filesystem lifecycle, slash-command integration and deterministic
quality evaluation.

## Automated coverage

| Area | Tests |
| --- | --- |
| Internal checkpoint fidelity | `tests/core/compaction/capsule-generator.test.ts`, `tests/core/session/session-v2.test.ts` |
| Portable schema, sanitization, checksum validation | `tests/core/capsules/portable-capsule.test.ts` |
| Filesystem lifecycle | `tests/core/capsules/portable-capsule-service.test.ts` |
| `/capsule create/export/load` commands | `tests/commands.test.ts` |
| Quality fixtures | `tests/core/capsules/portable-capsule-quality.test.ts` |

## Quality thresholds

`PortableCapsuleQualityEvaluator` uses deterministic lexical checks for:

- goal preservation;
- decisions/patterns;
- blockers;
- artifact ledger;
- integration actions.

Minimum accepted scores:

- structured fixture: `>= 0.9`;
- conversation fixture: `>= 0.8`.

The evaluator intentionally does not call an LLM. It is a regression guard for facts that should survive export.

## Current known baseline

The full `bun test` suite has unrelated baseline failures outside portable capsules:

- TUI ANSI color expectations when colors are disabled;
- activate-skill integration tests;
- background scheduler integration tests.

Portable capsule targeted tests pass independently and also pass inside the full run before the unrelated failures.
