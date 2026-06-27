# Phase 3.5 — Portable Capsules: Implementation Plan

## Task 1 — Internal context fidelity

- Передать active skill refs в capsule generation input.
- Сериализовать Artifact Ledger и active skills в portable continuation.
- Сделать потерю переданных skill refs blocking validation error.
- Tests: UC-PC1, UC-PC8.

## Task 2 — Portable domain and codec

- Добавить types, validator, sanitizer и Markdown codec.
- Добавить deterministic mapping из `ContextCapsuleEntry`.
- Tests: schema round-trip, size limits, malformed input, UC-PC5–PC7.

## Task 3 — Portable service and filesystem lifecycle

- Создать service для create/export/load.
- Exclusive write, default `.soba/capsules`, safe path handling.
- Tests: UC-PC2–PC4, collisions and corrupted files.
- После задачи обновить `manual-test-run.md`.

## Task 4 — CLI integration and i18n

- Расширить `/capsule` subcommands, не ломая list/inspect.
- Добавить en/ru/zh messages и help.
- Integration tests по UC-PC2–PC4.

## Task 5 — Quality fixtures and documentation

- Добавить deterministic effectiveness evaluator и structured/conversation fixtures.
- Обновить user docs и manual test run.
- Выполнить полный quality gate и dead-code check.

После каждой задачи: `bun test`, `bun run lint`, `bunx tsc --noEmit`, dead-code analyzer; затем отдельный commit без
включения пользовательских незакоммиченных файлов.
