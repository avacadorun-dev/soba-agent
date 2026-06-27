# Task 09 — ProjectMemory aggregator

Date: 2026-06-19

Implemented `ProjectMemory` as the public Project Memory entry point over existing stores.

## API

- `initialize()` creates/loads the memory layout:
  - knowledge templates;
  - capsule directory and index;
  - optional graph state.
- `load()` returns knowledge files and graph snapshot.
- `save()` prunes capsules and persists the graph when enabled.
- `getKnowledgeFiles()` delegates to `KnowledgeStore.loadAll()`.
- `getRelevantCapsules(query)` delegates to `CapsuleStore.getRelevant()`.
- `addCapsule(input)` delegates to `CapsuleStore.add()`.
- `getGraph()` returns an `EntityGraph` snapshot or `null` when graph is disabled.

## Decisions

- Aggregator does not reimplement low-level CRUD, relevance scoring, pruning or graph validation.
- Entity graph is enabled by default but can be disabled with `enableGraph: false`.
- Missing graph file returns an empty graph; corrupted graph file is a controlled `ProjectMemoryError`.
- Added `ProjectMemoryError` with layer/code metadata so Memory Injector and Memory Tools can surface actionable failures.
- Added `getStores()` for bounded internal composition/tests; future tools should prefer the public aggregator API unless they need graph mutation.

## Verification

- `bun test tests/memory/project-memory.test.ts`
- `bun run lint`
- `bunx tsc --noEmit`

## Next task context

- Task 10 should consume `getKnowledgeFiles()` and `getRelevantCapsules()` for budget-aware prompt injection.
- Task 13 should build memory tools on top of `ProjectMemory`, not direct file CRUD.
