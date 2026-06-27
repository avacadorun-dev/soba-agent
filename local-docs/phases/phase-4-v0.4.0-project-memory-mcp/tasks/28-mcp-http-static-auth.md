# 28 — HTTP static auth

**ID:** 0.4-MCP-19  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-14, 0.4-MCP-16  
**Block:** Remote MCP auth

## Goal

Добавить безопасную поддержку static auth для remote MCP: bearer token и API-key headers from environment.

## Local context

Это не OAuth. Static auth нужен для простых hosted MCP deployments и для ручной проверки remote transport до browser
OAuth flow.

## Suggested files

- `src/core/mcp/auth.ts`
- `src/core/mcp/config.ts`
- `src/core/mcp/streamable-http-transport.ts`
- `tests/core/mcp/auth.test.ts`
- `tests/core/mcp/config.test.ts`

## Requirements

- `auth.type: "none"` leaves requests unauthenticated.
- `auth.type: "bearerEnv"` reads token from `${ENV:NAME}` and sends `Authorization: Bearer ...`.
- `auth.type: "apiKeyEnv"` supports configured header name and env placeholder value.
- Header names are validated to prevent CRLF/header injection.
- Secret values are redacted in validation errors, transport errors, debug logs, and session records.
- Missing env var produces `auth_config_error`, not a generic crash.
- Static auth does not persist secrets to disk.

## Tests

- bearer env sends Authorization header;
- API-key env sends configured header;
- missing env is redacted and actionable;
- invalid header name is rejected;
- logs/errors do not include token;
- `auth.type: "none"` sends no auth headers;
- HTTP 401 with static auth reports unauthorized with next action.

## Verification

```bash
bun test tests/core/mcp/auth.test.ts tests/core/mcp/config.test.ts tests/core/mcp/streamable-http-transport.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Required if auth config shape changes after task 23.
