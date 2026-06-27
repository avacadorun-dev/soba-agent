# Checkpoint: task 31 — MCP OAuth credential lifecycle baseline

## Scope

- Added a local MCP OAuth token store with per-project, per-server and per-issuer records.
- Default credential storage lives under the user SOBA directory, outside project files that may be committed.
- Token store writes use restrictive file permissions where the platform supports POSIX modes.
- Stored records include access tokens, token type, optional refresh tokens, scopes and access-token expiry.
- Added an OAuth client layer for authorization header resolution, refresh, logout and revoke.
- Expired access tokens refresh before use when a refresh token is available.
- Refresh failures clear unusable local credentials and return `auth_required`.
- Logout removes the local token record.
- Revocation endpoints are called when advertised and skipped gracefully when absent.
- OAuth token diagnostics redact token-like fields and values before they can enter logs or session records.

## Verification

- `bun test tests/core/mcp/oauth-token-store.test.ts tests/core/mcp/oauth-client.test.ts`
- `bun test tests/core/mcp`
- `bun test`
- `bun run lint`
- `bunx tsc --noEmit`
- `bun run build`
- `bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts` (`💀 dead: 0`)

## Next

- Task 32 can apply the remote-specific security policy around OAuth credential and auth-state boundaries.
