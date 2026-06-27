# 29 — OAuth discovery и PKCE primitives

**ID:** 0.4-MCP-20  
**Priority:** P0  
**Estimate:** L  
**Depends on:** 0.4-MCP-19  
**Block:** Remote MCP auth

## Goal

Реализовать OAuth discovery foundation для MCP HTTP authorization: protected resource metadata, authorization server
metadata, OIDC fallback, scope selection, PKCE generation.

## Local context

Эта задача не открывает браузер и не получает токены. Она строит проверяемый auth plan для server id.

## Suggested files

- `src/core/mcp/oauth-discovery.ts`
- `src/core/mcp/oauth-pkce.ts`
- `tests/core/mcp/oauth-discovery.test.ts`
- `tests/core/mcp/oauth-pkce.test.ts`

## Requirements

- Parse `WWW-Authenticate` Bearer challenge, including `resource_metadata` and `scope`.
- If header metadata URL is absent, probe protected resource well-known URLs in MCP-specified order.
- Fetch and validate OAuth Protected Resource Metadata.
- Discover authorization server metadata through OAuth Authorization Server Metadata and OpenID Connect discovery fallback.
- Support issuer URLs with and without path components.
- Select scopes from challenge where present; otherwise use configured/default scopes.
- Generate PKCE verifier/challenge using S256.
- Validate HTTPS requirements for metadata endpoints, except localhost development.
- Return typed discovery errors with next actions.

## Tests

- parses `WWW-Authenticate` with resource metadata;
- probes path-specific protected resource metadata;
- falls back to root protected resource metadata;
- discovers authorization server metadata via OAuth well-known;
- falls back to OIDC well-known;
- issuer with path uses correct discovery order;
- challenged scope wins over configured default;
- PKCE challenge is deterministic for fixed verifier;
- insecure non-local metadata URL is rejected;
- discovery errors do not include tokens or auth headers.

## Verification

```bash
bun test tests/core/mcp/oauth-discovery.test.ts tests/core/mcp/oauth-pkce.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Create checkpoint: **MCP OAuth discovery baseline**.
