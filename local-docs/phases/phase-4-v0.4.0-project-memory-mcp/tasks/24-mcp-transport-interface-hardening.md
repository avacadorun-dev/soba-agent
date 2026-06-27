# 24 — MCP transport interface hardening

**ID:** 0.4-MCP-15  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-03, 0.4-MCP-04, 0.4-MCP-14  
**Block:** Remote MCP foundation

## Goal

Сделать MCP transport abstraction независимой от stdio, чтобы lifecycle/client manager могли работать со stdio и
Streamable HTTP без forked code path.

## Local context

Transport не должен знать business semantics `tools/list` или `tools/call`. Он должен доставлять JSON-RPC messages,
поддерживать cancellation, timeouts, lifecycle diagnostics и controlled shutdown.

## Suggested files

- `src/core/mcp/transport.ts`
- `src/core/mcp/stdio-transport.ts`
- `src/core/mcp/client.ts`
- `tests/core/mcp/transport.test.ts`
- `tests/core/mcp/stdio-transport.test.ts`

## Requirements

- Общий interface для `start`, `send`, optional `listen`, `close`, diagnostics.
- Transport exposes typed events: message, log, state change, error.
- AbortSignal and timeout behavior одинаковы для stdio и HTTP.
- Request correlation остаётся в JSON-RPC layer, не в transport.
- Existing stdio behavior and cleanup guarantees must not regress.
- Transport errors are typed enough for `/mcp status` and agent-loop user messages.

## Tests

- stdio tests still pass through the new interface;
- fake in-memory transport can drive MCP client lifecycle;
- abort before send produces controlled error;
- close is idempotent;
- transport-level malformed message does not crash client manager;
- diagnostics include transport kind without leaking env values.

## Verification

```bash
bun test tests/core/mcp/transport.test.ts tests/core/mcp/stdio-transport.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Create checkpoint: **MCP transport abstraction baseline**.
