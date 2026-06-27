# Checkpoint — Project Memory stores baseline

Date: 2026-06-19

## Final memory directory layout after Tasks 01–03

```text
.soba/
└── memory/
    ├── knowledge/
    │   ├── architecture.md
    │   ├── conventions.md
    │   ├── known-errors.md
    │   └── dependencies.md
    ├── capsules/
    │   ├── index.json
    │   └── <capsule-id>.json
    └── graph.json
```

## Schema notes

### Knowledge

- Fixed-key markdown documents only.
- Supported keys: `architecture`, `conventions`, `known-errors`, `dependencies`.
- `loadAll()` reads only the known markdown files; extra markdown and capsule JSON files are ignored by this API.
- Prompt formatting exists as a store-level helper, but final prompt budget and ordering remain deferred to the aggregator.

### Capsules

- JSON records in `.soba/memory/capsules/*.json`.
- Index file: `.soba/memory/capsules/index.json`.
- Index shape: `version`, `lastUpdated`, `capsuleCount`, `capsules[]`.
- Relevance currently combines tag match, text match, priority, and recency.
- Pruning keeps `critical` capsules, removes old low-priority capsules first, and enforces the default max of 50 where
  non-critical capsules can be removed.
- Corrupted `index.json` is recoverable by rebuilding from valid capsule files. Corrupted capsule JSON fails clearly on
  direct `get()` and is skipped by list/rebuild paths.

### Entity graph

- Persisted as `.soba/memory/graph.json`.
- Supported node types: `file`, `function`, `class`, `module`, `error`, `dependency`.
- Supported edge types: `depends_on`, `contains`, `fixes`, `related_to`, `imports`.
- Nodes are deduplicated by `id` with upsert behavior.
- Edges are deduplicated by `from + to + type` with upsert behavior.
- Missing graph file loads as an empty graph.

## Intentionally not integrated yet

- No AgentLoop integration.
- No ToolRegistry integration.
- No prompt injection.
- No MCP dependency.
- No automatic codebase scanner for graph population.
- No memory tools exposed to the model.
- No cross-store ProjectMemory aggregator yet; that starts in Task 09.
