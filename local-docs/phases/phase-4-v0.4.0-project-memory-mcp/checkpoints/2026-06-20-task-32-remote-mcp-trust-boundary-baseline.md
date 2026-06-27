# Checkpoint: task 32 — Remote MCP trust boundary baseline

## Scope

- Remote MCP endpoint diagnostics redact credentials and token-like query parameters.
- Remote config rejects URL credentials and preserves the existing HTTPS-by-default policy with localhost HTTP for development.
- Remote headers are validated against CRLF/NUL injection before runtime use.
- Transport-controlled headers such as `MCP-Session-Id`, `Last-Event-ID`, `Host` and `Content-Length` cannot be configured by remote MCP servers.
- Configured remote headers are sanitized in both config parsing and direct transport construction.
- Remote MCP tool trust remains local-config-only: remote annotations cannot lower confirmation requirements.
- `safe`, `normal` and `dangerous` trust modes keep the same semantics for stdio and remote servers.
- HTTP 401 is preserved as `auth_required` in MCP client status instead of being hidden as a generic transport/network failure.
- Startup auth failures do not retry through the legacy MCP startup path after a remote 401.
- MCP tool outputs continue to be normalized and bounded before they enter the model/session.
- Remote MCP server metadata/instructions remain outside the system prompt construction path.

## Verification

- `bun test tests/core/mcp/security.test.ts tests/core/mcp/tool-proxy.test.ts tests/core/mcp/config.test.ts tests/core/mcp/streamable-http-transport.test.ts tests/core/mcp/client.test.ts tests/system-prompt.test.ts`

## Next

- Task 33 can build on this baseline for user-facing remote MCP status, auth and recovery UX.
