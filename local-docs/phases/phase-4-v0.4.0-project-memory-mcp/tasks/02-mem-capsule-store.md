# 02 — Capsule Store

**ID:** 0.4-MEM-02  
**Priority:** P0  
**Estimate:** M  
**Depends on:** —  
**Block:** Foundation

## Goal

Реализовать JSON-капсулы памяти, индекс, фильтры, relevance scoring и pruning.

## Local context

Capsule Store хранит факты/выводы/ошибки/решения компактными JSON records. Он не должен зависеть от prompt injector, tools или AgentLoop.

## Suggested files

- `src/core/memory/capsule-store.ts`
- `tests/memory/capsule-store.test.ts`

## Requirements

- Хранение: `.soba/memory/capsules/*.json` + `.soba/memory/capsules/index.json`.
- `index.json`: `version`, `lastUpdated`, `capsuleCount`, `capsules[]`.
- API: `add`, `get`, `list(filters)`, `prune`, `getRelevant(query)`.
- Filters: type, tags, priority, date range.
- Relevance: tag match + recency + priority.
- Pruning: max 50 capsules; `critical` не удаляются; low-priority старше 30 дней удаляются первыми.
- Stable IDs and timestamps.

## Tests

- add/get capsule;
- list with filters;
- index updates after add;
- relevance orders by tag/priority/recency;
- prune keeps critical;
- prune respects max 50;
- corrupted capsule/index gives recoverable error or clear failure.

## Verification

```bash
bun test tests/memory/capsule-store.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Сделать short note, если формат capsule/index отличается от этого task card.
