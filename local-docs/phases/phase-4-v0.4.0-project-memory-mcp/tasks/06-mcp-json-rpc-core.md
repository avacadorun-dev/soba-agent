# 06 — JSON-RPC 2.0 core

**ID:** 0.4-MCP-03  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-01  
**Block:** Foundation

## Goal

Реализовать транспорт-независимое ядро JSON-RPC 2.0 для MCP.

## Local context

Core не должен знать про Bun subprocess или ToolRegistry. Он отвечает за protocol mechanics: ids, pending requests, errors, malformed messages, timeout/cancellation.

## Suggested files

- `src/core/mcp/json-rpc.ts`
- `tests/core/mcp/json-rpc.test.ts`

## Requirements

- Correlation by `id`.
- Support requests, responses, notifications.
- Handle malformed JSON/messages.
- JSON-RPC error objects normalized.
- Per-request timeout.
- Cancellation via `AbortSignal`.
- Buffering/framing interface prepared for stdio transport.
- No memory leak in pending requests after resolve/reject/timeout/cancel.

## Tests

- request/response success;
- response with unknown id;
- server error response;
- malformed message;
- timeout cleans pending request;
- abort signal rejects request;
- notification dispatch;
- concurrent requests resolve to correct callers.

## Verification

```bash
bun test tests/core/mcp/json-rpc.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Сделать short note, если framing contract для stdio отличается от planned design.
