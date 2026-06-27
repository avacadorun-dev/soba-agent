# Task 14 — MCP Client Manager

Date: 2026-06-19

## Scope

Implemented multi-server MCP client management without ToolRegistry/AgentLoop wiring.

## Lifecycle contract

- Manager owns one configured entry per MCP server id.
- Servers are lazy-started on first `getClient(serverId)`.
- Explicit operations are available:
  - `start(serverId)`;
  - `stop(serverId)`;
  - `restart(serverId)`;
  - `stopAll()`.
- `getStatus()` returns per-server state plus aggregate state counts for CLI/TUI use.
- Disabled servers stay configured but cannot be started.

## Crash recovery policy

- Crash recovery is bounded and demand-driven.
- A crashed client is restarted on the next `getClient()`/`start()` access while `crashRestartCount < maxCrashRestarts`.
- Default `maxCrashRestarts` is `2`.
- When the bound is reached, the server stays `crashed`, `restartExhausted=true`, and the manager throws a controlled `McpClientManagerError` with code `restart_exhausted`.
- Explicit `restart(serverId)` is treated as an operator action: it stops the current client, resets the crash policy counter, and starts a fresh client.
- No timer-based backoff is implemented in v0.4.0. The manager does not spawn background recovery loops, which keeps subprocess ownership deterministic and avoids hidden orphan processes.

## Partial failure behavior

- One degraded/crashed server does not affect other configured servers.
- `stop(serverId)` only stops that server.
- `stopAll()` awaits all stop operations through `Promise.allSettled`.

## Verification

- `bun test tests/core/mcp/client-manager.test.ts`
- `bun run lint`
- `bunx tsc --noEmit`

## Next task context

- Task 15 should use `McpClientManager.getClient()` for lazy start and crash recovery before proxying `tools/list`/`tools/call`.
- Task 18 can render `getStatus()` directly for CLI/TUI status commands.
