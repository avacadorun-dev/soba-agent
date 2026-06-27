# 27 — HTTP session management

**ID:** 0.4-MCP-18  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-16, 0.4-MCP-17  
**Block:** Remote MCP transport

## Goal

Поддержать MCP HTTP session lifecycle через `MCP-Session-Id`: capture on initialize, attach to subsequent requests,
recover from expiry, cleanup with DELETE.

## Local context

Session id is security-sensitive. It must be stored in memory for the active server lifecycle and redacted from logs.

## Suggested files

- `src/core/mcp/http-session.ts`
- `src/core/mcp/streamable-http-transport.ts`
- `tests/core/mcp/http-session.test.ts`
- `tests/core/mcp/streamable-http-transport.test.ts`

## Requirements

- Capture `MCP-Session-Id` from initialize response headers.
- Include `MCP-Session-Id` on subsequent HTTP requests.
- Validate session id as visible ASCII only.
- Redact session id in diagnostics.
- On HTTP 404 with existing session id, reset session and request re-initialization.
- On shutdown, send HTTP DELETE with session id when present.
- Treat HTTP 405 on DELETE as graceful cleanup degradation.
- Do not persist session id across SOBA process restarts.

## Tests

- initialize captures session id;
- tools/list sends session id;
- invalid session id header is rejected;
- 404 session expiry triggers controlled re-init state;
- DELETE sent on close;
- DELETE 405 does not fail shutdown;
- session id is redacted from logs/errors;
- concurrent requests use the same active session id.

## Verification

```bash
bun test tests/core/mcp/http-session.test.ts tests/core/mcp/streamable-http-transport.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional. Include in Streamable HTTP checkpoint if not separate.
