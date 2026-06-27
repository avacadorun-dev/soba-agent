# 33 — Remote MCP ToolRegistry regression

**ID:** 0.4-MCP-24  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-23, 0.4-MCP-08  
**Block:** Remote MCP integration

## Goal

Доказать, что remote MCP tools проходят через тот же ToolRegistry, trust check, execution path, normalization и JSONL
session recording, что и stdio MCP tools.

## Local context

Нельзя добавлять отдельный agent-loop path для remote tools. Transport difference must stop below MCP client/manager.

## Suggested files

- `src/core/tools/tool-registry.ts`
- `src/core/mcp/client-manager.ts`
- `src/core/agent-loop/**`
- `tests/core/mcp/tool-registry-remote.test.ts`
- `tests/core/agent-loop/mcp-remote-tools.test.ts`

## Requirements

- Remote tool names use OpenAI-safe generated names.
- Display labels can preserve server/tool readability.
- Same trust prompt behavior as stdio tools.
- Same timeout/cancellation path.
- Same output normalization/truncation path.
- Same session persistence shape, without leaking auth/session ids.
- Degraded remote server does not remove unrelated stdio tools.

## Tests

- remote tool appears in registry with safe function name;
- remote tool call executes through registry;
- trust prompt is required for normal/dangerous remote tool;
- cancellation propagates to HTTP transport;
- remote output is normalized like stdio output;
- auth/session tokens are absent from JSONL session;
- crashed remote server does not break local tools.

## Verification

```bash
bun test tests/core/mcp/tool-registry-remote.test.ts tests/core/agent-loop/mcp-remote-tools.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Required: **Remote MCP ToolRegistry integration baseline**.
