# Checkpoint — Task 22 Remote MCP scope baseline

Date: 2026-06-20

## Summary

v0.4.0 scope was expanded after the stdio MCP foundation baseline. Remote MCP over Streamable HTTP with OAuth UX is now
part of the v0.4.0 release plan.

## Scope change

Now in v0.4.0:

- Streamable HTTP transport for remote MCP servers;
- JSON and SSE response paths;
- HTTP `MCP-Session-Id` lifecycle;
- static bearer/API-key auth through env placeholders;
- OAuth discovery, PKCE, browser callback, token storage, refresh and logout/revoke;
- CLI/TUI auth UX through `/mcp auth ...`;
- remote ToolRegistry/AgentLoop regression and release DoD.

Still out of scope:

- SOBA-as-MCP-server/export mode;
- marketplace/catalog/signed server discovery;
- deprecated HTTP+SSE as a first-class transport;
- security or trust decisions based on server metadata, annotations, descriptions, or instructions.

## Artifacts

- [`remote-http-oauth-plan.md`](../remote-http-oauth-plan.md)
- [`tasks/22-mcp-remote-scope-protocol-baseline.md`](../tasks/22-mcp-remote-scope-protocol-baseline.md)
- [`tasks/23-mcp-config-transport-union.md`](../tasks/23-mcp-config-transport-union.md)
- [`tasks/24-mcp-transport-interface-hardening.md`](../tasks/24-mcp-transport-interface-hardening.md)
- [`tasks/25-mcp-streamable-http-json-transport.md`](../tasks/25-mcp-streamable-http-json-transport.md)
- [`tasks/26-mcp-streamable-http-sse-support.md`](../tasks/26-mcp-streamable-http-sse-support.md)
- [`tasks/27-mcp-http-session-management.md`](../tasks/27-mcp-http-session-management.md)
- [`tasks/28-mcp-http-static-auth.md`](../tasks/28-mcp-http-static-auth.md)
- [`tasks/29-mcp-oauth-discovery-pkce.md`](../tasks/29-mcp-oauth-discovery-pkce.md)
- [`tasks/30-mcp-oauth-browser-callback-ux.md`](../tasks/30-mcp-oauth-browser-callback-ux.md)
- [`tasks/31-mcp-oauth-token-storage-refresh.md`](../tasks/31-mcp-oauth-token-storage-refresh.md)
- [`tasks/32-mcp-remote-security-trust-policy.md`](../tasks/32-mcp-remote-security-trust-policy.md)
- [`tasks/33-mcp-remote-tool-registry-regression.md`](../tasks/33-mcp-remote-tool-registry-regression.md)
- [`tasks/34-mcp-cli-tui-remote-auth-ux.md`](../tasks/34-mcp-cli-tui-remote-auth-ux.md)
- [`tasks/35-mcp-remote-docs-examples.md`](../tasks/35-mcp-remote-docs-examples.md)
- [`tasks/36-remote-mcp-release-dod.md`](../tasks/36-remote-mcp-release-dod.md)

## Validation notes

- Latest local released MCP schema remains `2025-11-25`.
- Draft/next remains an architecture target, not a release gate.
- Phase README, implementation plan, protocol baseline, config schema, release notes draft and unified roadmap now point to
  the remote MCP block.
- Current user-facing MCP docs still describe implemented stdio support and link remote HTTP/OAuth as planned work, not as
  available functionality.

## Risks before implementation

- OAuth UX and token storage widen security scope; redaction tests are mandatory.
- Streamable HTTP SSE behavior must not create cancellation/retry loops.
- Remote tools must not get a separate AgentLoop path.
- Deprecated HTTP+SSE should stay out unless a named target server requires a compatibility exception.
