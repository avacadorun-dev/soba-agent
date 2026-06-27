# Checkpoint: task 25 — Streamable HTTP JSON baseline

## Scope

- Added `McpStreamableHttpTransport` for Streamable HTTP JSON-RPC messages over separate HTTP POST requests.
- Request messages accept `application/json` JSON-RPC responses.
- Notification and response messages accept HTTP `202` without a protocol response body.
- HTTP failures are surfaced as typed transport errors, with `401` mapped to `auth_required`.
- JSON-RPC error bodies on HTTP error statuses are emitted back into the protocol layer.
- Timeout and caller `AbortSignal` abort the in-flight POST without retrying.
- Transport diagnostics redact URL credentials and do not expose configured headers.
- `McpClientManager` now creates the Streamable HTTP transport for `transport: "streamableHttp"` configs.

## Verification

- `bun test tests/core/mcp/streamable-http-transport.test.ts`
- `bun test tests/core/mcp`
- `bun test`
- `bun run lint`
- `bunx tsc --noEmit`
- `bun run build`
- `bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts` (`💀 dead: 0`)

## Next

- Task 26 adds the `text/event-stream` response path and stream parser on top of this HTTP request contract.
