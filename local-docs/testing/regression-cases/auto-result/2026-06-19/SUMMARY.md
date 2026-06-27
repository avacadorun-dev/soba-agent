# Regression run summary — 2026-06-19

## Scope

Targeted automated regression for v0.4.0 additions:

- `37-project-memory.md`
- `38-mcp-client.md`

The historical 01–36 regression corpus was not re-run in this targeted pass. The release gate for the current branch is covered separately by the standard checks.

## Commands

```bash
bun test tests/memory/knowledge-store.test.ts tests/memory/entity-graph.test.ts tests/memory/capsule-store.test.ts tests/memory/memory-injector.test.ts tests/memory/memory-tools.test.ts tests/core/mcp/config.test.ts tests/core/mcp/stdio-transport.test.ts tests/core/mcp/json-rpc.test.ts tests/core/mcp/client.test.ts tests/core/mcp/client-manager.test.ts tests/core/mcp/tool-proxy.test.ts tests/core/mcp/security.test.ts tests/core/tools/tool-registry-mcp-integration.test.ts tests/core/mcp/mcp-integration.test.ts tests/release/v0.4.0-dod.test.ts tests/commands.test.ts
```

## Result

- Test files: 16
- Tests: 148
- PASS: 148
- FAIL: 0
- Regression cases recorded: 19
- SKIP_MANUAL: 0
- SKIP_TUI: 0

## Notes

- No real external API was required for these two v0.4.0 regression blocks.
- MCP coverage uses local mock stdio servers.
- Project Memory cross-session behavior is covered by the release DoD WOW test.
