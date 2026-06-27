# 15 — MCP Tool Proxy

**ID:** 0.4-MCP-07  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-05  
**Block:** Tool layer

## Goal

Проксировать MCP tools в формат SOBA tools с OpenAI-compatible namespace `mcp_<server>_<tool>`, JSON Schema mapping и result normalization/truncation.

## Local context

Tool Proxy адаптирует MCP client tools к внутреннему tool contract, но не принимает trust decisions сам.

## Suggested files

- `src/core/mcp/tool-proxy.ts`
- `tests/core/mcp/tool-proxy.test.ts`

## Requirements

- Namespace format: `mcp_<server>_<tool>`.
- Handles name collisions predictably.
- Maps MCP input JSON Schema into internal tool schema without unsupported assumptions.
- Normalizes result content into internal tool result shape.
- Applies output byte/token limits and truncation marker.
- Preserves machine-readable error information where possible.

## Tests

- proxy exposes expected names;
- schema mapping for simple object schema;
- schema mapping for unsupported/unknown schema degrades safely;
- successful tool call normalized;
- error tool call normalized;
- large output truncated with marker;
- server/tool name collision handling.

## Verification

```bash
bun test tests/core/mcp/tool-proxy.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional unless internal tool contract needs changes.
