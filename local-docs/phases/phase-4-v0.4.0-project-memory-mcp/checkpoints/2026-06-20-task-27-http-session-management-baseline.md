# Checkpoint: task 27 — HTTP session management baseline

## Scope

- Added in-memory `McpHttpSession` support for `MCP-Session-Id`.
- Session ids are captured from HTTP response headers and validated as visible ASCII.
- Active session id is attached to subsequent POST, GET listen, and DELETE cleanup requests.
- Diagnostics expose only a redacted session marker and never the raw session id.
- HTTP `404` with an active session resets the session and returns typed `session_expired` for controlled re-initialization.
- Shutdown sends HTTP `DELETE` when a session is active.
- HTTP `405` on DELETE is treated as graceful cleanup degradation.
- Session id is not persisted outside the active transport instance.

## Verification

- `bun test tests/core/mcp/http-session.test.ts tests/core/mcp/streamable-http-transport.test.ts`
- `bun test tests/core/mcp`
- `bun test`
- `bun run lint`
- `bunx tsc --noEmit`
- `bun run build`
- `bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts` (`💀 dead: 0`)

## Next

- Task 28 adds static auth header handling for remote MCP configs.
