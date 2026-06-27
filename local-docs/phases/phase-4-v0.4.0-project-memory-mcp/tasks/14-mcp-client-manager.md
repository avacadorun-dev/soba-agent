# 14 — MCP Client Manager

**ID:** 0.4-MCP-06  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-05  
**Block:** Tool layer

## Goal

Управлять несколькими MCP servers: lazy start, start/stop/restart, crash recovery и aggregate status.

## Local context

Manager не регистрирует tools в ToolRegistry напрямую; он предоставляет состояние и clients для Tool Proxy/CLI.

## Suggested files

- `src/core/mcp/client-manager.ts`
- `tests/core/mcp/client-manager.test.ts`

## Requirements

- Multiple configured servers.
- Lazy start on demand.
- Explicit start/stop/restart by server id.
- Aggregate status for CLI/TUI.
- Bounded crash recovery/restart policy.
- No orphan subprocess on stop/restart/process exit.
- Handles partial failure: one crashed server does not kill SOBA.

## Tests

- start two servers;
- lazy start on first access;
- stop one server leaves others running;
- restart crashed server;
- aggregate status includes ready/degraded/crashed;
- repeated crash hits bounded policy;
- cleanup stops all subprocesses.

## Verification

```bash
bun test tests/core/mcp/client-manager.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Сделать checkpoint, если crash recovery policy отличается от roadmap.
