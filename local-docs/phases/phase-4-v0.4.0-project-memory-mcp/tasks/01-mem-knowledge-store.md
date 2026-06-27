# 01 — Knowledge Store

**ID:** 0.4-MEM-01  
**Priority:** P0  
**Estimate:** M  
**Depends on:** —  
**Block:** Foundation

## Goal

Реализовать CRUD для markdown knowledge files: `architecture.md`, `conventions.md`, `known-errors.md`, `dependencies.md`.

## Local context

Knowledge Store — самый простой слой Project Memory. Он не должен знать про MCP, AgentLoop, ToolRegistry или prompt injection.

## Suggested files

- `src/core/memory/types.ts`
- `src/core/memory/knowledge-store.ts`
- `tests/memory/knowledge-store.test.ts`

## Requirements

- Создаёт `.soba/memory/knowledge/` при первом init.
- Создаёт 4 default template-файла при первом init.
- Поддерживает `loadAll`, `read`, `write`, `append`, `reset`, `exists`.
- Даёт `estimateTotalTokens` и `formatForPrompt`.
- Не пишет вне project memory directory.
- Не смешивает knowledge markdown с capsule JSON.

## Tests

- first init creates templates;
- read existing file;
- write overwrites expected knowledge file;
- append adds content;
- reset restores template;
- missing/unknown knowledge key is rejected;
- token estimate is deterministic enough for budget tests.

## Verification

```bash
bun test tests/memory/knowledge-store.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Необязателен, если задача маленькая. Сделать checkpoint, если меняется layout `.soba/memory`.
