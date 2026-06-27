# Регресс-кейсы: MCP Client

## Цель
Проверить MCP v0.4 integration: загрузку конфигурации, stdio transport, JSON-RPC, регистрацию MCP tools, security allowlist и выполнение tools через общий `ToolRegistry`/`AgentLoop`.

## Окружение
- Дата прогона: 2026-06-19
- Runtime: Bun
- Тип прогона: automated targeted regression
- Команда:

```bash
bun test tests/core/mcp/config.test.ts tests/core/mcp/stdio-transport.test.ts tests/core/mcp/json-rpc.test.ts tests/core/mcp/client.test.ts tests/core/mcp/client-manager.test.ts tests/core/mcp/tool-proxy.test.ts tests/core/mcp/security.test.ts tests/core/tools/tool-registry-mcp-integration.test.ts tests/core/mcp/mcp-integration.test.ts tests/release/v0.4.0-dod.test.ts tests/commands.test.ts
```

## Кейсы

**PASS** Кейс 01: MCP config загружается и валидируется.

**PASS** Кейс 02: stdio transport обменивается сообщениями.

**PASS** Кейс 03: JSON-RPC protocol обрабатывает request/response/error.

**PASS** Кейс 04: MCP client выполняет initialize/listTools/callTool.

**PASS** Кейс 05: Client Manager управляет несколькими servers.

**PASS** Кейс 06: MCP Tool Proxy нормализует tool invocation.

**PASS** Кейс 07: Security policy блокирует неразрешённые MCP servers/tools.

**PASS** Кейс 08: MCP tools регистрируются в общем ToolRegistry.

**PASS** Кейс 09: MCP integration с mock server работает end-to-end.

**PASS** Кейс 10: Два stdio MCP servers публикуют tools через AgentLoop.

**PASS** Кейс 11: CLI-команды MCP не ломают остальные команды.

---

## Пропущенные кейсы

Нет.

---

## FAIL — описание и баги

Нет.

---

## Итог

- PASS: 11
- FAIL: 0
- SKIP_MANUAL: 0
- SKIP_TUI: 0
