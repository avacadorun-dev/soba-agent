# 03 — Entity Graph

**ID:** 0.4-MEM-03  
**Priority:** P1  
**Estimate:** M  
**Depends on:** —  
**Block:** Foundation

## Goal

Добавить persisted graph для file/function/class/module/error/dependency.

## Local context

Entity Graph в v0.4.0 подключается опционально. Если объём релиза растёт, задача может быть урезана, но не должна блокировать MEM-04 aggregator.

## Suggested files

- `src/core/memory/entity-graph.ts`
- `tests/memory/entity-graph.test.ts`

## Requirements

- Storage: `.soba/memory/graph.json`.
- Node types: `file`, `function`, `class`, `module`, `error`, `dependency`.
- Edge types: `depends_on`, `contains`, `fixes`, `related_to`, `imports`.
- API: `addNode`, `addEdge`, `getNode`, `getNeighbors`, `save`, `load`.
- Deduplicate nodes/edges by stable IDs.
- Graceful empty graph load.

## Tests

- add node;
- add edge;
- get neighbors by direction/type;
- save/load roundtrip;
- duplicate node/edge behavior;
- empty graph behavior.

## Verification

```bash
bun test tests/memory/entity-graph.test.ts
bun run lint
bunx tsc --noEmit
```

## Mandatory checkpoint after this task

Создать checkpoint: **Project Memory stores baseline**.

Include:

- final memory directory layout;
- schema notes for knowledge/capsule/graph;
- what is intentionally not integrated yet.
