# 26 — Streamable HTTP transport: SSE support

**ID:** 0.4-MCP-17  
**Priority:** P0  
**Estimate:** L  
**Depends on:** 0.4-MCP-16  
**Block:** Remote MCP transport

## Goal

Добавить поддержку `text/event-stream` responses for POST requests and optional GET listen stream for server-to-client
messages.

## Local context

Streamable HTTP can return the final JSON-RPC response through SSE. Client must not treat disconnect as cancellation; MCP
cancellation remains explicit.

## Suggested files

- `src/core/mcp/sse-parser.ts`
- `src/core/mcp/streamable-http-transport.ts`
- `tests/core/mcp/sse-parser.test.ts`
- `tests/core/mcp/streamable-http-transport.test.ts`

## Requirements

- Parse SSE fields: `data`, `event`, `id`, `retry`.
- Support multi-line `data`.
- Ignore comments/heartbeats.
- Deliver JSON-RPC requests/notifications before final response when server sends them.
- Resolve original POST request when matching JSON-RPC response arrives.
- Respect `retry` for reconnect delay where reconnect is implemented.
- Preserve `Last-Event-ID` for resumable streams where server provides event ids.
- Optional GET listen stream supports `Accept: text/event-stream`.
- Malformed SSE and invalid JSON produce typed transport errors.

## Tests

- POST SSE returns final response;
- POST SSE emits intermediate notification before final response;
- multi-line data parses correctly;
- heartbeat/comment events are ignored;
- event id is stored for diagnostics/resume;
- retry value is parsed;
- malformed event does not crash process;
- GET listen stream receives server notification;
- disconnect before final response maps to network/stream error, not user cancellation.

## Verification

```bash
bun test tests/core/mcp/sse-parser.test.ts tests/core/mcp/streamable-http-transport.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Create checkpoint: **Streamable HTTP transport baseline**.
