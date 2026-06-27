# 30 — OAuth browser callback UX

**ID:** 0.4-MCP-21  
**Priority:** P0  
**Estimate:** L  
**Depends on:** 0.4-MCP-20  
**Block:** Remote MCP auth

## Goal

Добавить интерактивный OAuth login flow: локальный callback server, browser open, state validation, authorization code
exchange.

## Local context

SOBA CLI/TUI must work in terminals where browser open may fail. The fallback is to print a concise login URL and wait for
the local callback.

## Suggested files

- `src/core/mcp/oauth-flow.ts`
- `src/core/mcp/oauth-callback-server.ts`
- `src/tui/**`
- `tests/core/mcp/oauth-flow.test.ts`
- `tests/core/mcp/oauth-callback-server.test.ts`

## Requirements

- Start a temporary localhost callback server on an available port.
- Generate and validate `state`.
- Use PKCE verifier/challenge from task 29.
- Open browser when possible; otherwise print/copyable authorization URL.
- Exchange authorization code for tokens.
- Handle user denial and OAuth error callback.
- Enforce timeout and clean up callback server.
- No token or authorization code appears in logs/session output.
- UX message must be short and actionable in TUI.

## Tests

- builds authorization URL with state, code challenge, redirect URI, and scopes;
- callback with valid state exchanges code;
- callback with invalid state is rejected;
- OAuth error callback produces auth-denied result;
- timeout stops callback server;
- browser-open failure falls back to printed URL;
- token/code values are redacted;
- callback server closes after success and after failure.

## Verification

```bash
bun test tests/core/mcp/oauth-flow.test.ts tests/core/mcp/oauth-callback-server.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional. Required if TUI flow changes materially.
