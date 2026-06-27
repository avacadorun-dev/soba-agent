# Task 17 — Unified tool layer + trust baseline

Date: 2026-06-19

## Scope

Implemented the MCP trust/security boundary for model-visible MCP tools after ToolRegistry integration.

## Trust source of truth

- MCP trust level comes only from project-local `.soba/mcp.json` via `McpServerConfig.trustMode`.
- MCP tool annotations, descriptions and titles are model metadata only. They do not influence trust classification.
- `syncMcpToolsIntoRegistry()` can now register MCP trust rules into the existing `TrustManager`.
- MCP rules are keyed by model-visible proxy names: `mcp_<server>_<tool>`.
- On every MCP registry sync, stale `mcp_` trust rules are removed before current ready-server rules are applied.

## Runtime security boundary

- Dangerous MCP tools use the existing AgentLoop dangerous-confirmation flow.
- If the user denies a dangerous MCP tool call, AgentLoop records a controlled denial and does not call the MCP tool.
- Safe and normal MCP tools follow the same execution path as built-in tools after classification.
- Per-server `timeoutMs` is forwarded to `tools/call`.
- Per-server `maxOutputBytes` is enforced during MCP result normalization.
- MCP execution errors redact configured env values before they are returned to the model/session.

## ToolRegistry integration status

- Built-in tools remain registered independently from MCP tools.
- Ready MCP servers dynamically expose tools as `mcp_<server>_<tool>`.
- Stopped, crashed, disabled or restart-exhausted servers are removed from model-visible MCP tools during sync.
- A failing MCP server does not block built-in tools or other MCP servers from registration/execution.
- MCP execution result storage still uses the common AgentLoop function-call-output path.

## Remaining UX/docs tasks

- Task 18: CLI/TUI MCP management commands and status surface.
- Task 19: MCP docs and runnable examples.
- Task 20: optional pre-commit hook for local quality gate.
- Task 21: release DoD and WOW/end-to-end tests with multiple stdio MCP servers.

## Known security limitations

- v0.4.0 supports stdio MCP transport only.
- Global/user MCP config is intentionally out of scope; trust is project-local and reviewable.
- Remote HTTP transport, OAuth and marketplace server trust are not implemented.
- MCP annotations remain visible to the model as descriptive metadata where present, but are never used for security decisions.
- Env redaction covers configured MCP env values and common token-like strings; it is not a general-purpose DLP system.

## Verification

- `bun test tests/core/mcp/security.test.ts tests/core/mcp/tool-proxy.test.ts tests/core/tools/tool-registry-mcp-integration.test.ts`
- `bun run lint`
- `bunx tsc --noEmit`
