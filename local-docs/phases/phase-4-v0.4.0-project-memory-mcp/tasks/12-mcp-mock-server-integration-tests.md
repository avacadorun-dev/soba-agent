# 12 — Shared mock MCP server + integration tests

**ID:** 0.4-MCP-11  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-03, 0.4-MCP-04  
**Recommended after:** 0.4-MCP-05  
**Block:** Aggregation

## Goal

Добавить реальный subprocess fixture для MCP integration tests: pagination, timeout, cancellation, crash, restart и list-changed.

## Local context

Mock server нужен для всех дальнейших MCP задач. Он должен быть минимальным, deterministic и Bun-only.

## Suggested files

- `tests/fixtures/mcp/mock-mcp-server.ts`
- `tests/core/mcp/mcp-integration.test.ts`
- shared test helpers if needed.

## Requirements

- Запускается как subprocess.
- Supports modern `server/discover`.
- Supports legacy `initialize` fallback scenario.
- Supports tools/list with configurable pagination.
- Supports tools/call success/error/timeout.
- Can emit notifications/list-changed.
- Can simulate crash.
- Can simulate slow response for cancellation.
- Test cleanup guarantees no orphan subprocess.

## Tests

- client discovers modern fixture;
- client falls back to legacy initialize fixture;
- paginated tools/list returns full list;
- long call times out;
- cancellation aborts long call;
- crash is observed;
- restart scenario is available for manager task;
- list-changed invalidates or updates tool cache.

## Verification

```bash
bun test tests/core/mcp/mcp-integration.test.ts
bun run lint
bunx tsc --noEmit
```

## Mandatory checkpoint after this task

Создать checkpoint: **aggregation baseline**.

Include:

- ProjectMemory API status;
- Memory Injector status;
- MCP client + mock fixture status;
- known flaky subprocess cases, if any.
