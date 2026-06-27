# Регресс-кейсы: MCP Client

## Цель
Проверить MCP v0.4 integration: загрузку конфигурации, stdio transport, JSON-RPC, регистрацию MCP tools, security allowlist и выполнение tools через общий `ToolRegistry`/`AgentLoop`.

## Окружение
- SOBA собран через `bun run build`
- Тесты запускаются через `bun test`
- Для автоматического прогона используются mock stdio MCP servers из `tests/fixtures/mcp/`
- Реальный внешний MCP server не обязателен для базового регресса

---

## Кейс 01: MCP config загружается и валидируется

**Шаги:**
1. Запустить `bun test tests/core/mcp/config.test.ts`

**Ожидаемый результат:** MCP config принимает валидные настройки и отклоняет несовместимые версии, server id и transport-поля.

**Критерий PASS:** Тесты завершаются с exit 0.

---

## Кейс 02: stdio transport обменивается сообщениями

**Шаги:**
1. Запустить `bun test tests/core/mcp/stdio-transport.test.ts`

**Ожидаемый результат:** Transport стартует server process, отправляет JSON-RPC сообщения и корректно закрывается.

**Критерий PASS:** Тесты завершаются с exit 0.

---

## Кейс 03: JSON-RPC protocol обрабатывает request/response/error

**Шаги:**
1. Запустить `bun test tests/core/mcp/json-rpc.test.ts`

**Ожидаемый результат:** MCP JSON-RPC слой корректно сериализует запросы, ответы и ошибки.

**Критерий PASS:** Тесты завершаются с exit 0.

---

## Кейс 04: MCP client выполняет initialize/listTools/callTool

**Шаги:**
1. Запустить `bun test tests/core/mcp/client.test.ts`

**Ожидаемый результат:** Client проходит handshake, получает tools и вызывает tool через mock MCP server.

**Критерий PASS:** Тесты завершаются с exit 0.

---

## Кейс 05: Client Manager управляет несколькими servers

**Шаги:**
1. Запустить `bun test tests/core/mcp/client-manager.test.ts`

**Ожидаемый результат:** Manager поднимает несколько MCP servers, агрегирует tools и корректно освобождает ресурсы.

**Критерий PASS:** Тесты завершаются с exit 0.

---

## Кейс 06: MCP Tool Proxy нормализует tool invocation

**Шаги:**
1. Запустить `bun test tests/core/mcp/tool-proxy.test.ts`

**Ожидаемый результат:** MCP tool schema и результат приводятся к внутреннему формату SOBA.

**Критерий PASS:** Тесты завершаются с exit 0.

---

## Кейс 07: Security policy блокирует неразрешённые MCP servers/tools

**Шаги:**
1. Запустить `bun test tests/core/mcp/security.test.ts`

**Ожидаемый результат:** Небезопасные команды, env и tool names блокируются до запуска.

**Критерий PASS:** Тесты завершаются с exit 0.

---

## Кейс 08: MCP tools регистрируются в общем ToolRegistry

**Шаги:**
1. Запустить `bun test tests/core/tools/tool-registry-mcp-integration.test.ts`

**Ожидаемый результат:** MCP tools доступны через тот же registry, что и native tools, с namespace `mcp_<server>_<tool>`.

**Критерий PASS:** Тесты завершаются с exit 0.

---

## Кейс 09: MCP integration с mock server работает end-to-end

**Шаги:**
1. Запустить `bun test tests/core/mcp/mcp-integration.test.ts`

**Ожидаемый результат:** Mock MCP server публикует tools, SOBA их обнаруживает и выполняет без реального внешнего сервиса.

**Критерий PASS:** Тесты завершаются с exit 0.

---

## Кейс 10: Два stdio MCP servers публикуют tools через AgentLoop

**Шаги:**
1. Запустить `bun test tests/release/v0.4.0-dod.test.ts`

**Ожидаемый результат:** Два mock MCP servers одновременно публикуют tools, а `mcp_mock_modern_echo` проходит через `AgentLoop`, `ToolRegistry` и session recording.

**Критерий PASS:** WOW-кейс MCP в release DoD проходит.

---

## Кейс 11: CLI-команды MCP не ломают остальные команды

**Шаги:**
1. Запустить `bun test tests/commands.test.ts`

**Ожидаемый результат:** CLI command registry продолжает корректно обрабатывать существующие команды после добавления MCP.

**Критерий PASS:** Тесты завершаются с exit 0.
