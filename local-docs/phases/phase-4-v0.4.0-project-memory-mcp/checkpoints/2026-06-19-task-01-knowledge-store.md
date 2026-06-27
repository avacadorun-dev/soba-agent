# Checkpoint — Task 01 Knowledge Store

Date: 2026-06-19

## Memory layout

Task 01 introduces the first Project Memory directory:

```text
.soba/
└── memory/
    └── knowledge/
        ├── architecture.md
        ├── conventions.md
        ├── known-errors.md
        └── dependencies.md
```

Knowledge files are fixed-key markdown documents. The store never accepts arbitrary filenames for CRUD operations, so
capsule JSON and future graph files cannot be mixed into `loadAll()` or written through this API.

## API boundary

`KnowledgeStore` is intentionally independent from MCP, AgentLoop, ToolRegistry, and prompt injection. It owns only:

- first-time initialization;
- fixed markdown CRUD;
- deterministic token estimate;
- prompt formatting for a future aggregator.

Project-level aggregation remains deferred to Task 09.
