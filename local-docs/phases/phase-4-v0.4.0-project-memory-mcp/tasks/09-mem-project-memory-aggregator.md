# 09 — ProjectMemory aggregator

**ID:** 0.4-MEM-04  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MEM-01, 0.4-MEM-02  
**Optional dependency:** 0.4-MEM-03  
**Block:** Aggregation

## Goal

Собрать единый lifecycle и API над Knowledge Store и Capsule Store; Entity Graph подключается опционально.

## Local context

Aggregator — публичная точка входа Project Memory. Он не должен сам реализовывать низкоуровневый file CRUD, relevance или pruning; только оркестрировать stores.

## Suggested files

- `src/core/memory/project-memory.ts`
- `tests/memory/project-memory.test.ts`

## Requirements

- API: `load`, `save`, `initialize`, `getKnowledgeFiles`, `getRelevantCapsules`, `addCapsule`, `getGraph`.
- Первый запуск создаёт memory layout.
- Graph absence не ломает aggregator.
- Ошибки отдельных слоёв имеют понятные сообщения.
- API готов для Memory Injector и Memory Tools.

## Tests

- init creates all required stores;
- load existing memory;
- add capsule then reload;
- read knowledge via aggregator;
- graph optional path works when graph file missing;
- store failure surfaces controlled error.

## Verification

```bash
bun test tests/memory/project-memory.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional. Сделать, если публичный ProjectMemory API отличается от task card.
