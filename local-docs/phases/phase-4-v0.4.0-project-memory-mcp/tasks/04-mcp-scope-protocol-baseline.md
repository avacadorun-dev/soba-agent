# 04 — MCP scope и protocol baseline

**ID:** 0.4-MCP-01  
**Priority:** P0  
**Estimate:** S  
**Depends on:** —  
**Block:** Foundation

## Goal

Зафиксировать stable MCP specification baseline, capability matrix и out-of-scope для v0.4.0.

## Local context

Эта задача защищает релиз от MCP draft drift. Будущие draft changes не блокируют v0.4.0.

## Suggested files

- `docs/phases/phase-4-v0.4.0-project-memory-mcp/mcp-protocol-baseline.md`
- при необходимости — config/schema docs рядом с implementation docs.

## Requirements

- Указать точную версию/дату MCP спецификации, которая является compatibility baseline.
- Capability matrix: поддерживается / graceful degradation / out-of-scope.
- Initial transport decision: stdio foundation.
- Зафиксировать, что MCP annotations не участвуют в trust/security decisions.
- Amendment: task 22 moves Streamable HTTP and OAuth into v0.4.0. Marketplace and SOBA-as-MCP-server remain out of scope.

## Tests / validation

Документационная задача: проверить, что будущие implementation task cards не требуют out-of-scope behavior.

## Verification

```bash
bun run lint
```

## Checkpoint

Сделать checkpoint, если baseline отличается от roadmap или выбранной spec версии.
