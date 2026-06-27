# 35 — Remote MCP docs и examples

**ID:** 0.4-MCP-26  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-25  
**Block:** Remote MCP UX

## Goal

Обновить документацию и examples под remote MCP: Streamable HTTP config, static auth, OAuth, troubleshooting, and current
limitations.

## Local context

Docs must not claim deprecated HTTP+SSE or marketplace support. Examples should be runnable or clearly marked as
templates.

## Suggested files

- `docs/mcp.md`
- `docs/examples/mcp/*.json`
- `docs-site/content/docs/**`
- `docs/phases/phase-4-v0.4.0-project-memory-mcp/manual-test-run.md`

## Requirements

- Add remote Streamable HTTP config example.
- Add static bearer/API-key examples using `${ENV:...}`.
- Add OAuth flow guide with `/mcp auth login` and `/mcp auth logout`.
- Explain supported vs unsupported transports.
- Explain Context7-style hosted endpoint expectation without inventing a specific URL.
- Add troubleshooting for 401/403/404 session expiry/429/timeout/malformed SSE.
- Update quick start and step-by-step guide if user-facing docs changed.
- Run doc-scout/manual fact-check workflow if available for docs-site changes.

## Tests

Docs task. If docs-site changes, run docs-site checks. If examples are consumed by tests, add/adjust snapshot or config
validation tests.

## Verification

```bash
bun test tests/core/mcp/config.test.ts
bun run lint
bunx tsc --noEmit
cd docs-site && bun run check
```

## Checkpoint

Required if docs-site or public docs change materially.
