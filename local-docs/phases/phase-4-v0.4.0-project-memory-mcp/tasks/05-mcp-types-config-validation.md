# 05 — MCP types и config validation

**ID:** 0.4-MCP-02  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-01  
**Block:** Foundation

## Goal

Добавить erasable TypeScript-типы и runtime validation для MCP config, включая `${ENV}` expansion без утечки значений в логи.

## Local context

Config validation — security foundation. Нельзя стартовать subprocess до успешной validation.

## Suggested files

- `src/core/mcp/types.ts`
- `src/core/mcp/config.ts`
- `tests/core/mcp/config.test.ts`

## Requirements

- Без `enum`; использовать literal unions/object consts.
- Config поддерживает несколько servers.
- Server fields: name/id, command, args, env mapping, cwd, timeout/output limits, trust mode.
- `${ENV}` placeholders resolve at runtime.
- Значения secrets/env не логируются и не попадают в error text.
- Invalid config даёт actionable i18n-ready errors.
- Path/cwd validation не допускает неожиданного traversal.

## Tests

- valid config with two servers;
- missing command/name;
- invalid trust mode;
- env placeholder resolves;
- missing env var gives redacted error;
- logs/errors do not include secret values;
- default timeout/output limits applied.

## Verification

```bash
bun test tests/core/mcp/config.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Необязателен, если schema совпала с baseline. Обязателен при изменении config shape.
