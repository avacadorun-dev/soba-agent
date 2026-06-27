# 13 — Memory Tools

**ID:** 0.4-MEM-06  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MEM-04  
**Block:** Tool layer

## Goal

Добавить tools `read_project_memory` и `write_project_memory` с валидацией секретов и путей.

## Local context

Эта задача может добавить tool definitions, но не должна менять общий execution path AgentLoop. Полная интеграция ToolRegistry делается в task 16.

## Suggested files

- `src/core/memory/memory-tools.ts`
- `tests/memory/memory-tools.test.ts`

## Requirements

- `read_project_memory`: filters by tags/type/date/priority, returns bounded normalized result.
- `write_project_memory`: writes capsule or updates allowed knowledge file according to schema.
- Secret validation: API keys/tokens/private keys rejected or redacted according to policy.
- Path validation: cannot write outside `.soba/memory`.
- Tool input schemas are model-friendly.
- Errors are actionable and i18n-ready.

## Tests

- read all relevant memory;
- read with filters;
- write capsule;
- write/update allowed knowledge file;
- reject secret-like content;
- reject path traversal;
- output truncation/bounds.

## Verification

```bash
bun test tests/memory/memory-tools.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional unless tool schemas are changed after implementation feedback.
