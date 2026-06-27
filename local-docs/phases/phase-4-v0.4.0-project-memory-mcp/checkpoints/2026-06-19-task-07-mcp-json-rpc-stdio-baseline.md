# Checkpoint 2026-06-19 — MCP JSON-RPC + stdio baseline

## Completed

- JSON-RPC 2.0 core is transport-independent and owns ids, pending request correlation, normalized errors, timeouts,
  cancellation and notification/request dispatch.
- stdio transport starts MCP subprocesses through Bun APIs with `stdin/stdout/stderr` pipes.
- stdout is parsed as newline-delimited JSON-RPC frames using the shared `JsonRpcLineFramer`.
- stderr is isolated from the protocol stream and exposed only through diagnostics callback.
- transport shutdown is bounded: close stdin first, wait for graceful exit, then force-kill on timeout.
- abort during shutdown force-kills the subprocess before rejecting, so tests do not leave orphan processes.
- process crash and broken pipe paths surface controlled `McpStdioTransportError` values.

## Verified

- `bun test tests/core/mcp/stdio-transport.test.ts` → pass
- `bun run lint` → pass
- `bunx tsc --noEmit` → pass

## Decisions

- stdio framing is newline-delimited JSON-RPC, matching the Task 06 checkpoint contract.
- transport remains lifecycle-agnostic: it does not know `server/discover`, `initialize`, `tools/list` or `tools/call`.
- transport callbacks emit raw framed protocol lines; Task 11 should connect them to `JsonRpcEndpoint.receive()`.
- stderr is never parsed as protocol data.
- shutdown timeout returns an exit result with `forced: true`; abort rejects with `code: "aborted"` after killing the child.

## Risks / follow-ups

- Task 11 must map transport/process errors into MCP client state (`degraded`, `crashed`, incompatible protocol, etc.).
- Task 12 should add shared mock MCP server fixtures so lifecycle tests do not duplicate inline scripts.
- Task 14 should define restart/backoff policy for crashed servers.
- Task 17 must keep MCP stderr/server-provided metadata non-authoritative for trust decisions.

## Next task context

- Следующая задача: `tasks/08-ops-ci-quality-gate.md`.
- Не тащить в следующий контекст: MCP lifecycle semantics; они начинаются в Task 11.
