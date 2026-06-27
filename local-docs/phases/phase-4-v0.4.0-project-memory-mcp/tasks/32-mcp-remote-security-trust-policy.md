# 32 — Remote MCP security и trust policy

**ID:** 0.4-MCP-23  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-18, 0.4-MCP-22  
**Block:** Remote MCP security

## Goal

Добавить remote-specific security policy: URL restrictions, origin/header handling, auth state boundaries, and trust UX for
remote tools.

## Local context

Remote MCP widens the attack surface compared to local stdio. Trust remains local-config-only and must never be upgraded
by remote metadata.

## Suggested files

- `src/core/mcp/security.ts`
- `src/core/trust/**`
- `src/core/mcp/tool-proxy.ts`
- `tests/core/mcp/security.test.ts`
- `tests/core/mcp/tool-proxy.test.ts`

## Requirements

- Reject insecure non-local HTTP by default.
- Validate configured endpoint URL and prevent credential-in-URL usage.
- Redact query params that look like tokens in diagnostics.
- Reject CRLF injection in headers.
- Remote server instructions/descriptions/annotations cannot alter trust mode.
- Remote `trustMode` semantics match stdio: safe/normal/dangerous.
- Remote auth failure cannot be silently retried forever.
- Network errors and auth errors are distinct in status and TUI.
- Tool outputs remain bounded and normalized before entering model/session.

## Tests

- non-local HTTP is rejected;
- localhost HTTP is accepted for development;
- URL with username/password is rejected;
- token-like query params are redacted;
- malicious header name/value is rejected;
- remote tool annotation cannot lower confirmation requirement;
- repeated 401 does not loop forever;
- large remote tool output is truncated with marker;
- remote server instructions do not enter system prompt.

## Verification

```bash
bun test tests/core/mcp/security.test.ts tests/core/mcp/tool-proxy.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Create checkpoint: **Remote MCP trust boundary baseline**.
