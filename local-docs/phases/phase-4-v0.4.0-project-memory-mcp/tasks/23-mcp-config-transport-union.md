# 23 — MCP config transport union

**ID:** 0.4-MCP-14  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-02, 0.4-MCP-13  
**Block:** Remote MCP foundation

## Goal

Расширить `.soba/mcp.json`, чтобы один config schema поддерживал stdio servers и remote Streamable HTTP servers.

## Local context

Существующие stdio configs должны продолжить работать без миграции. Новая форма должна быть явной: `transport:
"stdio"` или `transport: "streamableHttp"`. Если `transport` отсутствует и есть `command`, это legacy shorthand для
`stdio`.

## Suggested files

- `src/core/mcp/types.ts`
- `src/core/mcp/config.ts`
- `tests/core/mcp/config.test.ts`
- `docs/phases/phase-4-v0.4.0-project-memory-mcp/mcp-config-schema.md`

## Requirements

- Discriminated union:
  - stdio: `command`, `args`, `cwd`, `env`;
  - Streamable HTTP: `url`, optional headers mapping, auth config, timeout/output limits.
- Remote `url` must be absolute `https://` by default.
- `http://127.0.0.1` and `http://localhost` are allowed for local development.
- Non-local plain `http://` is rejected unless an explicit insecure development flag is added later.
- Header/env placeholders use `${ENV:NAME}` and redact values in errors/logs.
- Auth shape supports `none`, `bearerEnv`, `apiKeyEnv`, and `oauth`.
- Object-map config remains supported.
- Error messages identify server id and field without exposing secrets.

## Tests

- existing stdio config still validates;
- explicit `transport: "stdio"` validates;
- valid remote HTTPS config validates;
- localhost HTTP config validates;
- non-local HTTP config fails;
- missing remote `url` fails;
- remote config with `command` fails unless `transport` is stdio;
- secret env placeholders resolve and stay redacted;
- invalid auth type fails with actionable error;
- object-map ids still become server ids.

## Verification

```bash
bun test tests/core/mcp/config.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Required if config shape differs from `mcp-config-schema.md`.
