# 31 — OAuth token storage, refresh и revoke

**ID:** 0.4-MCP-22  
**Priority:** P0  
**Estimate:** L  
**Depends on:** 0.4-MCP-21  
**Block:** Remote MCP auth

## Goal

Persist OAuth credentials safely enough for v0.4.0, refresh expired access tokens, support logout/revoke, and never leak
token values.

## Local context

If no OS keychain abstraction exists in the project, start with a local SOBA credential store with strict file
permissions and clear migration seam for future keychain integration.

## Suggested files

- `src/core/mcp/oauth-token-store.ts`
- `src/core/mcp/oauth-client.ts`
- `tests/core/mcp/oauth-token-store.test.ts`
- `tests/core/mcp/oauth-client.test.ts`

## Requirements

- Store tokens per project + server id + authorization server issuer.
- Store access token expiry and refresh token when provided.
- Redact all token-like values from logs, errors, and session records.
- Refresh expired access token before MCP request.
- On refresh failure, clear unusable access token and surface `auth_required`.
- Support logout that deletes local token record.
- Support revoke endpoint when advertised; degrade gracefully if absent.
- Token store path must not be inside files that are likely to be committed accidentally unless already gitignored.

## Tests

- saves and loads token record by server id;
- file permissions are restricted where platform supports it;
- expired access token refreshes before request;
- refresh failure returns auth-required state;
- logout removes local token;
- revoke endpoint is called when available;
- revoke absence does not fail logout;
- token values never appear in diagnostics or serialized session items.

## Verification

```bash
bun test tests/core/mcp/oauth-token-store.test.ts tests/core/mcp/oauth-client.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Create checkpoint: **MCP OAuth credential lifecycle baseline**.
