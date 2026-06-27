# Checkpoint: task 26 — Streamable HTTP SSE baseline

## Scope

- Added `SseParser` for Server-Sent Events fields: `data`, `event`, `id`, and `retry`.
- Multi-line `data` is joined with newlines.
- Comment and heartbeat-only events are ignored.
- Streamable HTTP POST now accepts `text/event-stream` responses in addition to `application/json`.
- POST SSE emits intermediate JSON-RPC messages before the final response.
- POST request SSE completes only after a matching JSON-RPC response id is received.
- EOF before the matching response is reported as a typed `stream_error`, not cancellation.
- Optional GET `listen()` opens `Accept: text/event-stream` and emits server messages.
- Event `id` and `retry` are stored in transport diagnostics for resume/reconnect metadata.
- Malformed SSE JSON is surfaced as a typed transport failure without crashing the manager.

## Verification

- `bun test tests/core/mcp/sse-parser.test.ts tests/core/mcp/streamable-http-transport.test.ts`
- `bun test tests/core/mcp`
- `bun test`
- `bun run lint`
- `bunx tsc --noEmit`
- `bun run build`
- `bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts` (`💀 dead: 0`)

## Next

- Task 27 adds Streamable HTTP session lifecycle handling around `MCP-Session-Id`.
