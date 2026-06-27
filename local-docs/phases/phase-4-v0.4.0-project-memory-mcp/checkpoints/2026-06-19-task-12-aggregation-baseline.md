# Task 12 — Aggregation baseline

Date: 2026-06-19

## ProjectMemory API status

- `ProjectMemory` aggregates knowledge, memory capsules and entity graph state behind a single project-scoped API.
- Stores are file-backed, deterministic and covered by focused Bun tests.
- Memory tool write integration is still deferred to Task 13.

## Memory Injector status

- `buildProjectMemorySection()` renders sanitized project knowledge and memory capsules into prompt-ready XML-like sections.
- Injection is budget-aware and deterministic.
- AgentLoop wiring is still deferred to the later integration task.

## MCP client status

- `McpClient` supports modern `server/discover` first, legacy `initialize` fallback, protocol negotiation and controlled degraded startup errors.
- `tools/list` supports pagination and cache invalidation.
- `tools/call` supports success, JSON-RPC request errors, timeout and cancellation.
- `notifications/tools/list_changed` is handled by invalidating the tool cache.
- Transport crashes move the client to `crashed`.

## Mock MCP fixture status

- `tests/fixtures/mcp/mock-mcp-server.ts` is a Bun-only subprocess fixture.
- It supports:
  - modern discovery;
  - legacy initialize fallback;
  - configurable tools/list pagination;
  - successful, failing, slow and crashing tool calls;
  - `notifications/tools/list_changed`;
  - restart validation through fresh subprocess clients.

## Known flaky subprocess cases

- No known flaky cases after Task 12 verification.
- Timeout/cancellation tests use short but bounded delays; if CI becomes resource-constrained, increase `SOBA_MOCK_MCP_SLOW_CALL_MS` and request timeouts proportionally rather than weakening assertions.

## Verification

- `bun test tests/core/mcp/mcp-integration.test.ts`
- `bun run lint`
- `bunx tsc --noEmit`
