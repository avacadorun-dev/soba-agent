# 22 — Remote MCP scope и protocol baseline

**ID:** 0.4-MCP-13  
**Priority:** P0  
**Estimate:** S  
**Depends on:** 0.4-MCP-01  
**Block:** Remote MCP foundation

## Goal

Зафиксировать v0.4.0 scope для remote MCP: Streamable HTTP transport, OAuth baseline, security boundary, fallback policy и
explicit non-goals.

## Local context

Предыдущий baseline исключал remote HTTP/OAuth из v0.4.0. Эта задача меняет release boundary, поэтому должна обновить
phase artifacts до implementation.

## Suggested files

- `docs/phases/phase-4-v0.4.0-project-memory-mcp/remote-http-oauth-plan.md`
- `docs/phases/phase-4-v0.4.0-project-memory-mcp/mcp-protocol-baseline.md`
- `docs/phases/phase-4-v0.4.0-project-memory-mcp/implementation-plan.md`
- `docs/phases/phase-4-v0.4.0-project-memory-mcp/README.md`

## Requirements

- Released compatibility baseline остаётся MCP `2025-11-25`.
- Remote transport target: Streamable HTTP.
- Client must support POST responses with both `application/json` and `text/event-stream`.
- Client must support optional GET SSE listen stream where server exposes it.
- Client must handle `MCP-Session-Id` for HTTP sessions.
- OAuth scope must follow MCP authorization for HTTP-based transports.
- Deprecated HTTP+SSE from `2024-11-05` remains non-goal unless a named legacy server requires a later compatibility task.
- Server metadata, tool annotations, server instructions, and `_meta` remain non-authoritative for SOBA trust decisions.

## Tests

Docs-only task. Validate by checking that all new task links resolve and no phase artifact still says remote HTTP/OAuth is
out of v0.4.0 scope.

## Verification

```bash
rg "remote HTTP transport|OAuth|Streamable HTTP" docs/phases/phase-4-v0.4.0-project-memory-mcp
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Create checkpoint: **Remote MCP scope baseline**.

Include:

- release boundary change summary;
- spec baseline;
- remote transport non-goals;
- risk list before implementation.
