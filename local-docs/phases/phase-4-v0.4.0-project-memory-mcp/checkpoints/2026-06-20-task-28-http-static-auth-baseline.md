# Checkpoint: task 28 — HTTP static auth baseline

## Scope

- Added `auth.ts` for Streamable HTTP static auth headers.
- `auth.type: "none"` leaves requests unauthenticated.
- `auth.type: "bearerEnv"` reads the token from an environment variable and sends `Authorization: Bearer ...`.
- `auth.type: "apiKeyEnv"` reads the key from an environment variable and sends it through the configured header.
- API-key header names and manual remote headers are validated as HTTP token header names.
- Missing auth env variables fail as typed `auth_config_error`.
- Static auth values are resolved at transport runtime and are not persisted in MCP config objects.
- Static auth errors, diagnostics, and 401 guidance avoid leaking token values.

## Verification

- `bun test tests/core/mcp/auth.test.ts tests/core/mcp/config.test.ts tests/core/mcp/streamable-http-transport.test.ts`
- `bun test tests/core/mcp`
- `bun test`
- `bun run lint`
- `bunx tsc --noEmit`
- `bun run build`
- `bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts` (`💀 dead: 0`)

## Next

- Task 29 starts OAuth discovery and PKCE groundwork.
