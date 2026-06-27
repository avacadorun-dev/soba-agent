# 18 — CLI/TUI управление MCP

**ID:** 0.4-MCP-10  
**Priority:** P1  
**Estimate:** M  
**Depends on:** 0.4-MCP-06, 0.4-MCP-08  
**Block:** UX/finalization

## Goal

Добавить управление MCP из CLI/TUI: `/mcp status/start/stop/restart`, статусы и понятные i18n-ready ошибки.

## Local context

UX-команды не должны менять MCP core semantics. Они вызывают Client Manager и отображают состояние.

## Suggested files

- slash command registration files;
- TUI status rendering files if present;
- `tests/tui` or `tests/core` command tests according to existing structure.

## Requirements

- Slash commands:
  - `/mcp status`;
  - `/mcp start <server>`;
  - `/mcp stop <server>`;
  - `/mcp restart <server>`.
- Status includes configured/running/ready/degraded/crashed/stopped.
- Errors are actionable and i18n-ready.
- Unknown server gives clear message.
- Commands do not leak env/secrets.
- UX remains usable when no MCP config exists.

## Tests

- status with no servers;
- status with two servers;
- start server command;
- stop server command;
- restart crashed server command;
- unknown server error;
- redaction in displayed errors.

## Verification

```bash
bun test
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional. Сделать, если command names/UX differ from roadmap.
