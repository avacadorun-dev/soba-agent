# 19 — Документация и MCP examples

**ID:** 0.4-MCP-12  
**Priority:** P1  
**Estimate:** S  
**Depends on:** 0.4-MCP-09, 0.4-MCP-10  
**Block:** UX/finalization

## Goal

Документировать настройку stdio MCP server, env, trust, troubleshooting и минимум два проверенных примера.

## Local context

Документация должна соответствовать реальному config schema и CLI/slash commands. Не описывать out-of-scope transports или MCP server/export.

## Suggested files

- `docs/mcp.md` or relevant docs location;
- examples under `docs/examples/` if project convention exists.

## Requirements

- Explain current implemented scope: MCP client with stdio foundation.
- Explain v0.4.0 planned remote extension: Streamable HTTP/OAuth tasks 22–36, without documenting it as available before implementation.
- Config example with env placeholders and redaction note.
- Trust/security explanation: local config only, annotations ignored.
- Troubleshooting: spawn failure, timeout, crash, incompatible capabilities, missing env.
- At least two verified examples:
  - simple local mock/stdin server;
  - common external stdio MCP server if feasible.
- Commands documented: `/mcp status/start/stop/restart`.

## Tests / validation

- Run examples or mark exact verification command.
- Validate docs against implementation names.

## Verification

```bash
bun run lint
```

Optional if `doc-scout` is applicable:

```bash
bun run .soba/skills/doc-scout/scripts/validate.ts docs/mcp.md
```

## Checkpoint

Optional docs checkpoint if examples require caveats.
