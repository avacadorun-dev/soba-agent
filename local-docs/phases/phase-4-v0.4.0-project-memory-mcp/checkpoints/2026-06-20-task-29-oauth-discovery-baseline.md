# Checkpoint: task 29 — MCP OAuth discovery baseline

## Scope

- Added PKCE primitives for OAuth authorization code flows.
- PKCE verifier generation uses base64url-encoded random bytes.
- PKCE challenge generation uses deterministic S256 hashing.
- Added MCP OAuth discovery plan builder for HTTP-based authorization.
- Bearer `WWW-Authenticate` challenges parse `resource_metadata` and `scope`.
- Protected resource metadata is loaded from challenge metadata URLs or probed through path-specific then root
  well-known URLs.
- Authorization server metadata discovery tries OAuth Authorization Server Metadata first and OpenID Connect discovery
  second.
- Issuers with path components use path-aware well-known discovery URLs.
- Challenge scopes override configured default scopes.
- Metadata, issuer, authorization and token endpoints require HTTPS except localhost development URLs.
- Discovery failures return typed `McpOAuthDiscoveryError` codes with next-action hints and avoid including raw auth
  headers or token-like challenge values.

## Verification

- `bun test tests/core/mcp/oauth-discovery.test.ts tests/core/mcp/oauth-pkce.test.ts`
- `bun test tests/core/mcp`
- `bun test`
- `bun run lint`
- `bunx tsc --noEmit`
- `bun run build`
- `bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts` (`💀 dead: 0`)

## Next

- Task 30 can build the browser callback UX on top of the discovery plan and PKCE primitives.
