# 25 — Streamable HTTP transport: JSON response path

**ID:** 0.4-MCP-16  
**Priority:** P0  
**Estimate:** L  
**Depends on:** 0.4-MCP-15  
**Block:** Remote MCP transport

## Goal

Реализовать Streamable HTTP transport для MCP request/notification/response over HTTP POST, начиная с
`application/json` responses.

## Local context

Это минимальный remote transport path. SSE добавляется отдельно в task 26, чтобы не смешивать HTTP request contract и
stream parser в одной задаче.

## Suggested files

- `src/core/mcp/streamable-http-transport.ts`
- `tests/core/mcp/streamable-http-transport.test.ts`
- `tests/fixtures/mcp/streamable-http-server.ts`

## Requirements

- Every JSON-RPC message sent to server uses a separate HTTP POST.
- POST includes `Accept: application/json, text/event-stream`.
- POST body is one JSON-RPC request, notification, or response.
- For request messages, parse `application/json` JSON-RPC response.
- For notification/response messages, accept HTTP 202 with empty body.
- Handle HTTP error status with typed errors and optional JSON-RPC error body.
- Support timeout and AbortSignal.
- Do not retry non-idempotent tool calls automatically.
- Redact authorization headers and configured secret headers from logs/errors.

## Tests

- POST request returns JSON-RPC response;
- POST notification returns 202 and no protocol response;
- missing/invalid content type fails clearly;
- HTTP 400 with JSON-RPC error body maps to typed protocol error;
- HTTP 401 maps to auth-required error;
- timeout aborts fetch and does not leave pending request;
- configured headers are sent but redacted from diagnostics;
- malformed JSON body fails without crashing manager.

## Verification

```bash
bun test tests/core/mcp/streamable-http-transport.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional if task 26 follows immediately. Required if HTTP JSON path ships independently.
