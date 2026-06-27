# Checkpoint: task 33 — Remote MCP ToolRegistry integration baseline

## Scope

- Remote Streamable HTTP MCP tools are synchronized through the existing `McpClientManager` and `ToolRegistry` path.
- Remote tool proxy names are OpenAI-safe while labels preserve readable server/tool identity.
- Remote tool calls execute through the same registry `execute` path as stdio MCP tools.
- Remote tool results use the existing MCP normalization, structured-content rendering and output truncation path.
- Remote trust modes feed the same `TrustManager` rules as stdio MCP tools.
- Dangerous remote tools use the existing AgentLoop confirmation event and denial session output.
- AgentLoop tool cancellation now reaches the MCP HTTP transport fetch signal through JSON-RPC request options.
- Persisted JSONL session entries record normal `function_call` / `function_call_output` items without remote auth tokens or HTTP session ids.
- A crashed remote server does not remove unrelated ready stdio MCP tools during registry sync.

## Verification

- `bun test tests/core/mcp/tool-registry-remote.test.ts tests/core/agent-loop/mcp-remote-tools.test.ts`

## Next

- Task 34 can add user-facing `/mcp auth` commands and TUI states on top of the verified remote ToolRegistry path.
