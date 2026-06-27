# Checkpoint: task 35 — Remote MCP docs and examples baseline

## Scope

- `docs/mcp.md` now documents current stdio and Streamable HTTP support, not the pre-remote stdio-only baseline.
- Public docs-site MCP page and related quick-start/reference links now mention remote Streamable HTTP, OAuth auth commands and current limitations.
- Remote MCP examples were added as disabled templates for no-auth, bearer env, API-key env and OAuth configurations.
- Config tests now parse the remote documentation templates so schema drift is caught automatically.
- Troubleshooting covers HTTP 401/403/404, session expiry, 429, timeout and malformed SSE.
- Docs explicitly avoid deprecated HTTP+SSE and marketplace support claims.

## Verification

- `bun test tests/core/mcp/config.test.ts`
- `bun test`
- `bun run lint`
- `bunx tsc --noEmit`
- `bun run build`
- `bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts`
- `cd docs-site && bun run check`

## Next

- Task 36 can use the updated public docs and examples as release DoD inputs.
