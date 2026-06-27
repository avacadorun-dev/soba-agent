# 16 — ToolRegistry + AgentLoop integration

**ID:** 0.4-MCP-08  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-06, 0.4-MCP-07  
**Block:** Tool layer

## Goal

Добавить динамическую регистрацию/дерегистрацию и общий execution path для built-in и MCP tools.

## Local context

Это единственная задача v0.4.0, где разрешено менять связку ToolRegistry/AgentLoop для MCP. Держать diff bounded и покрыть regression tests.

## Suggested files

- existing ToolRegistry files;
- existing AgentLoop/tool execution files;
- `tests/core/tools/tool-registry-mcp-integration.test.ts` or equivalent.

## Requirements

- Built-in tools продолжают работать без изменения public behavior.
- MCP tools регистрируются/дерегистрируются динамически по server status/list-changed.
- Model-visible tools include both built-in and `mcp_<server>_<tool>`.
- Execution path common: model call → trust check → execute → normalized result → JSONL session.
- Failure of MCP server does not break built-in tools.
- Session representation remains compact and debuggable.

## Tests

- built-in tool still executes;
- MCP tool appears after server ready;
- MCP tool disappears or marks unavailable after stop/crash;
- execution result stored in session same pathway;
- MCP execution timeout returns controlled tool error;
- no duplicate tool names after list-changed.

## Verification

```bash
bun test tests/core/tools/tool-registry-mcp-integration.test.ts
bun test
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional here, mandatory after task 17. If AgentLoop behavior changes beyond MCP execution, create an immediate architecture checkpoint.
