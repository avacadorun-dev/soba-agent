# 07 — stdio transport

**ID:** 0.4-MCP-04  
**Priority:** P0  
**Estimate:** L  
**Depends on:** 0.4-MCP-03  
**Block:** Foundation

## Goal

Реализовать MCP stdio transport на Bun subprocess: stdin/stdout framing, stderr isolation, AbortSignal и graceful shutdown.

## Local context

Transport не должен знать MCP lifecycle semantics (`initialize`, `tools/list`). Он только доставляет JSON-RPC messages через subprocess stdio.

## Suggested files

- `src/core/mcp/stdio-transport.ts`
- `tests/core/mcp/stdio-transport.test.ts`

## Requirements

- Start subprocess through Bun APIs.
- Send JSON-RPC messages to stdin.
- Read stdout as message stream/framing expected by baseline.
- Keep stderr isolated: log/debug only, not protocol stream.
- Support AbortSignal for start/call/shutdown paths.
- Graceful shutdown with bounded timeout, then forced kill.
- No orphan subprocess after tests.
- Clear errors for spawn failure, broken pipe, process exit.

## Tests

- starts mock process;
- sends/receives message;
- stderr does not break protocol;
- graceful shutdown exits process;
- forced kill after shutdown timeout;
- abort during long operation;
- process crash surfaces controlled error.

## Verification

```bash
bun test tests/core/mcp/stdio-transport.test.ts
bun run lint
bunx tsc --noEmit
```

## Mandatory checkpoint after this task

Создать checkpoint: **MCP JSON-RPC + stdio baseline**.

Include:

- transport lifecycle summary;
- subprocess cleanup guarantees;
- remaining MCP lifecycle work.
