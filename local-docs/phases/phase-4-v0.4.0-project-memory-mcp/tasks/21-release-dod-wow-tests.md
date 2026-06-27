# 21 — Release DoD и WOW-тесты

**ID:** 0.4-REL-21  
**Priority:** P0  
**Estimate:** M  
**Depends on:** tasks 01–20, except deferred P1/P2 with explicit decision  
**Block:** UX/finalization

## Goal

Проверить v0.4.0 release DoD: Project Memory переживает перезапуск, MCP tools работают через единый ToolRegistry, failure modes graceful.

## Local context

Это release gate, не feature task. Если тест падает, фикс делается в соответствующем module task/context, а не раздувается здесь.

## Required WOW tests

### WOW-1: новая сессия знает архитектуру проекта

1. В тестовом проекте заполнить `.soba/memory/knowledge/architecture.md`.
2. Завершить сессию.
3. Запустить новую сессию.
4. Спросить агента о проектной архитектуре.
5. Ожидаемо: ответ учитывает knowledge без повторного ввода.

### WOW-2: внешний MCP tool без специального code path

1. Настроить mock/external stdio MCP server.
2. Убедиться, что tool появился как `mcp_<server>_<tool>`.
3. Вызвать tool через модель/agent loop.
4. Ожидаемо: path общий — trust check → execution → normalized result → JSONL session.

## Full release gate

```bash
bun test
bun run lint
bunx tsc --noEmit
bun run build
bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts
```

## DoD checklist

- `.soba/memory/knowledge/*.md` создаются при первом запуске.
- Memory survives restart and stays within token budget.
- `read_project_memory` / `write_project_memory` work and reject secrets.
- Minimum two configured stdio MCP servers can publish tools.
- MCP tool full path is proven in tests/session output.
- Timeout/cancellation/crash/restart do not crash SOBA.
- No orphan subprocesses after tests.
- Incompatible capabilities produce clear graceful degradation.
- Stable MCP baseline documented.
- Docs/examples match implementation.
- Full release gate passes.

## Mandatory checkpoint after this task

Создать checkpoint: **v0.4.0 release candidate baseline**.

Include:

- full gate results;
- deferred tasks, if any;
- known risks;
- release notes draft pointer.
