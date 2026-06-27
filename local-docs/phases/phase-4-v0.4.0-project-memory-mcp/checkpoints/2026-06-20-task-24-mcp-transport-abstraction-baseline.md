# Checkpoint — Task 24 MCP transport abstraction baseline

Date: 2026-06-20

## Summary

MCP transport abstraction is now independent from stdio-specific callbacks. `McpClient` consumes typed transport events and
keeps JSON-RPC request correlation in the JSON-RPC layer.

## Implemented baseline

- Added shared transport contract in `src/core/mcp/transport.ts`.
- Transport events are typed: `message`, `log`, `state`, and `error`.
- Transport diagnostics include transport kind/state and avoid env/config secret values.
- `McpStdioTransport` implements the shared interface while preserving existing stdio cleanup behavior.
- `close()` is an idempotent alias for transport shutdown.
- In-memory fake transport can drive MCP client lifecycle in tests.

## Validation notes

- Existing stdio subprocess tests pass through the shared interface.
- Abort before send produces a controlled `McpTransportError`.
- Malformed transport-level messages degrade the client without crashing the manager.
- Request correlation remains in `JsonRpcEndpoint`; transports only deliver JSON-RPC messages.

## Next task context

Task 25 can implement Streamable HTTP JSON transport against `McpTransport` without adding a separate AgentLoop or
ToolRegistry path.
