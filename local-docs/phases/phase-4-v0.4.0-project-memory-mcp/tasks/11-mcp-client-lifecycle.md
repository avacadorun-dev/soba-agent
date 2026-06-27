# 11 — MCP client lifecycle

**ID:** 0.4-MCP-05  
**Priority:** P0  
**Estimate:** L  
**Depends on:** 0.4-MCP-02, 0.4-MCP-04  
**Block:** Aggregation

## Goal

Реализовать стабильный MCP client lifecycle: modern `server/discover` probe, legacy `initialize` fallback, tools/list with pagination, tools/call, notifications и state machine.

## Local context

Client работает поверх JSON-RPC + stdio transport. Он ещё не управляет несколькими серверами и не регистрирует tools в ToolRegistry.

## Suggested files

- `src/core/mcp/client.ts`
- `src/core/mcp/client-state.ts`
- `tests/core/mcp/client.test.ts`

## Requirements

- State machine: idle/starting/ready/degraded/stopping/stopped/crashed.
- Modern lifecycle follows `mcp-protocol-baseline.md`: try `server/discover` first and use per-request MCP `_meta` for modern servers.
- Legacy `initialize` handshake remains required as fallback for released `2025-11-25`/legacy servers.
- Capability negotiation with graceful degradation.
- `tools/list` supports pagination.
- `tools/call` supports timeout/cancellation.
- Notifications handled, especially list-changed if in baseline.
- Controlled errors for incompatible server/protocol.

## Tests

- modern discover success;
- legacy initialize fallback success;
- incompatible protocol/capabilities;
- tools/list single page;
- tools/list pagination;
- tools/call success;
- tools/call timeout;
- tools/call cancellation;
- notification updates state/cache;
- crash moves to crashed/degraded state.

## Verification

```bash
bun test tests/core/mcp/client.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional unless state machine or capabilities differ from baseline docs.
