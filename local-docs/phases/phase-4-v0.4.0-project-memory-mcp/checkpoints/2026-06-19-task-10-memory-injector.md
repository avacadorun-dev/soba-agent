# Task 10 — Memory Injector

Date: 2026-06-19

Implemented budget-aware Project Memory prompt injection.

## Contract

- `buildProjectMemorySection(memory, budget)` renders:
  - `<project_knowledge>` with markdown knowledge files;
  - `<project_memory>` with selected memory capsules.
- `buildSystemPrompt()` now accepts `projectMemorySection?: string`.
- Prompt builder does not import stores or mutate ProjectMemory; AgentLoop integration is intentionally deferred.

## Budget policy

- Default memory budget is 2,000 estimated tokens.
- Knowledge receives 70% of the budget by default and is included first in stable store order.
- Capsules receive the remaining budget.
- Capsule selection prefers priority first (`critical`, `high`, `medium`, `low`), then relevance score, then deterministic recency/id ordering.
- If an item does not fit, it is skipped; low-priority capsules therefore drop before high/critical capsules under tight budgets.

## Security

- Memory text is sanitized through the shared portable capsule sanitizer before prompt injection.
- `${ENV:NAME}` placeholders are redacted as `[REDACTED:env_placeholder]`.
- The injector escapes XML text/attributes before emitting prompt sections.

## Verification

- `bun test tests/memory/memory-injector.test.ts`
- `bun run lint`
- `bunx tsc --noEmit`

## Next task context

- Task 13 should use the same sanitizer boundary for memory tools.
- AgentLoop wiring is still out of scope until the relevant integration task.
