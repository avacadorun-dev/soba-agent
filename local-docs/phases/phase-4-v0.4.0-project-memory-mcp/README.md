# v0.4.0 — Project Memory + MCP + Verified Agent Loop

**Источник:** [`docs/unified-roadmap-1.0.0.md`](../../unified-roadmap-1.0.0.md)  
**Цель релиза:** агент помнит проект между сессиями, подключает внешние инструменты через MCP-клиент и не завершает
инженерные задачи без проверяемого workflow.
**Граница релиза:** SOBA в v0.4.0 — MCP-клиент. В релиз входят stdio MCP foundation и remote MCP over Streamable HTTP
with OAuth UX. Agent Loop Tuning входит в v0.4.0 отдельным phase/epic label `phase-4.5-agent-loop-tuning`. MCP
server/export, marketplace и multi-agent delegation не входят.

## Как пользоваться этой папкой

- `implementation-plan.md` — последовательность реализации и глобальные инварианты.
- `checkpoint-policy.md` — когда делать чекпоинты, чтобы освобождать контекст.
- `manual-test-run.md` — ручные проверки после блоков задач.
- `remote-http-oauth-plan.md` — expansion plan для remote Streamable HTTP transport и OAuth UX.
- `../phase-4.5-agent-loop-tuning/` — Agent Loop Tuning: Evidence Ledger, verification policy, Auto-Verifier,
  Fix-Until-Green MVP и built-in skills hardening как часть v0.4.0.
- `tasks/` — автономные task cards. Каждый файл содержит локальный контекст, зависимости, DoD и проверки.

## Последовательность задач

### Block 0 — Release framing

| № | ID | Файл | Назначение |
|---|----|------|------------|
| 00 | 0.4-REL-00 | [`tasks/00-release-framing.md`](tasks/00-release-framing.md) | Зафиксировать release boundary, структуру docs и baseline-решения. |

### Block 1 — Foundation

| № | ID | Файл | Назначение |
|---|----|------|------------|
| 01 | 0.4-MEM-01 | [`tasks/01-mem-knowledge-store.md`](tasks/01-mem-knowledge-store.md) | Knowledge Store для markdown-файлов памяти. |
| 02 | 0.4-MEM-02 | [`tasks/02-mem-capsule-store.md`](tasks/02-mem-capsule-store.md) | Capsule Store с индексом, relevance и pruning. |
| 03 | 0.4-MEM-03 | [`tasks/03-mem-entity-graph.md`](tasks/03-mem-entity-graph.md) | Persisted Entity Graph. |
| 04 | 0.4-MCP-01 | [`tasks/04-mcp-scope-protocol-baseline.md`](tasks/04-mcp-scope-protocol-baseline.md) | MCP scope, stable protocol baseline, compatibility matrix. |
| 05 | 0.4-MCP-02 | [`tasks/05-mcp-types-config-validation.md`](tasks/05-mcp-types-config-validation.md) | MCP types, config validation, `${ENV}` expansion without leaks. |
| 06 | 0.4-MCP-03 | [`tasks/06-mcp-json-rpc-core.md`](tasks/06-mcp-json-rpc-core.md) | JSON-RPC 2.0 core. |
| 07 | 0.4-MCP-04 | [`tasks/07-mcp-stdio-transport.md`](tasks/07-mcp-stdio-transport.md) | stdio transport на Bun subprocess. |
| 08 | 0.4-OPS-01 | [`tasks/08-ops-ci-quality-gate.md`](tasks/08-ops-ci-quality-gate.md) | Bun-only CI quality gate. |

### Block 2 — Aggregation

| № | ID | Файл | Назначение |
|---|----|------|------------|
| 09 | 0.4-MEM-04 | [`tasks/09-mem-project-memory-aggregator.md`](tasks/09-mem-project-memory-aggregator.md) | ProjectMemory lifecycle/API над stores. |
| 10 | 0.4-MEM-05 | [`tasks/10-mem-memory-injector.md`](tasks/10-mem-memory-injector.md) | Budget-aware injection в system prompt. |
| 11 | 0.4-MCP-05 | [`tasks/11-mcp-client-lifecycle.md`](tasks/11-mcp-client-lifecycle.md) | initialize/tools/list/tools/call/state machine. |
| 12 | 0.4-MCP-11 | [`tasks/12-mcp-mock-server-integration-tests.md`](tasks/12-mcp-mock-server-integration-tests.md) | Shared mock MCP server и интеграционные тесты. |

### Block 3 — Tool layer

| № | ID | Файл | Назначение |
|---|----|------|------------|
| 13 | 0.4-MEM-06 | [`tasks/13-mem-memory-tools.md`](tasks/13-mem-memory-tools.md) | read/write project memory tools. |
| 14 | 0.4-MCP-06 | [`tasks/14-mcp-client-manager.md`](tasks/14-mcp-client-manager.md) | Multi-server lifecycle manager. |
| 15 | 0.4-MCP-07 | [`tasks/15-mcp-tool-proxy.md`](tasks/15-mcp-tool-proxy.md) | Tool proxy namespace + schema/result normalization. |
| 16 | 0.4-MCP-08 | [`tasks/16-mcp-tool-registry-agent-loop-integration.md`](tasks/16-mcp-tool-registry-agent-loop-integration.md) | Единый ToolRegistry и execution path. |
| 17 | 0.4-MCP-09 | [`tasks/17-mcp-trust-security-boundary.md`](tasks/17-mcp-trust-security-boundary.md) | Trust/security boundary для MCP. |

### Block 4 — UX/finalization

| № | ID | Файл | Назначение |
|---|----|------|------------|
| 18 | 0.4-MCP-10 | [`tasks/18-mcp-cli-tui-management.md`](tasks/18-mcp-cli-tui-management.md) | `/mcp status/start/stop/restart`, статусы, i18n-ready ошибки. |
| 19 | 0.4-MCP-12 | [`tasks/19-mcp-docs-examples.md`](tasks/19-mcp-docs-examples.md) | Документация и минимум два проверенных примера. |
| 20 | 0.4-OPS-02 | [`tasks/20-ops-pre-commit-hook.md`](tasks/20-ops-pre-commit-hook.md) | Локальный Bun-only pre-commit hook. |
| 21 | 0.4-REL-21 | [`tasks/21-release-dod-wow-tests.md`](tasks/21-release-dod-wow-tests.md) | Сквозные WOW-тесты и release DoD. |

### Block 5 — Remote MCP foundation/transport

| № | ID | Файл | Назначение |
|---|----|------|------------|
| 22 | 0.4-MCP-13 | [`tasks/22-mcp-remote-scope-protocol-baseline.md`](tasks/22-mcp-remote-scope-protocol-baseline.md) | Remote MCP scope, protocol baseline, security и UX boundary. |
| 23 | 0.4-MCP-14 | [`tasks/23-mcp-config-transport-union.md`](tasks/23-mcp-config-transport-union.md) | Config transport union: stdio + Streamable HTTP. |
| 24 | 0.4-MCP-15 | [`tasks/24-mcp-transport-interface-hardening.md`](tasks/24-mcp-transport-interface-hardening.md) | Transport abstraction hardening. |
| 25 | 0.4-MCP-16 | [`tasks/25-mcp-streamable-http-json-transport.md`](tasks/25-mcp-streamable-http-json-transport.md) | Streamable HTTP POST + JSON response path. |
| 26 | 0.4-MCP-17 | [`tasks/26-mcp-streamable-http-sse-support.md`](tasks/26-mcp-streamable-http-sse-support.md) | Streamable HTTP SSE response/listen support. |
| 27 | 0.4-MCP-18 | [`tasks/27-mcp-http-session-management.md`](tasks/27-mcp-http-session-management.md) | `MCP-Session-Id`, re-init и DELETE cleanup. |

### Block 6 — Remote MCP auth/security/integration

| № | ID | Файл | Назначение |
|---|----|------|------------|
| 28 | 0.4-MCP-19 | [`tasks/28-mcp-http-static-auth.md`](tasks/28-mcp-http-static-auth.md) | Static bearer/API-key auth через env без утечек. |
| 29 | 0.4-MCP-20 | [`tasks/29-mcp-oauth-discovery-pkce.md`](tasks/29-mcp-oauth-discovery-pkce.md) | OAuth discovery, scopes и PKCE. |
| 30 | 0.4-MCP-21 | [`tasks/30-mcp-oauth-browser-callback-ux.md`](tasks/30-mcp-oauth-browser-callback-ux.md) | Browser login flow и local callback UX. |
| 31 | 0.4-MCP-22 | [`tasks/31-mcp-oauth-token-storage-refresh.md`](tasks/31-mcp-oauth-token-storage-refresh.md) | Token storage, refresh, logout/revoke. |
| 32 | 0.4-MCP-23 | [`tasks/32-mcp-remote-security-trust-policy.md`](tasks/32-mcp-remote-security-trust-policy.md) | Remote security и trust policy. |
| 33 | 0.4-MCP-24 | [`tasks/33-mcp-remote-tool-registry-regression.md`](tasks/33-mcp-remote-tool-registry-regression.md) | ToolRegistry/AgentLoop regression для remote tools. |

### Block 7 — Remote MCP UX/release gate

| № | ID | Файл | Назначение |
|---|----|------|------------|
| 34 | 0.4-MCP-25 | [`tasks/34-mcp-cli-tui-remote-auth-ux.md`](tasks/34-mcp-cli-tui-remote-auth-ux.md) | `/mcp auth` commands и TUI auth states. |
| 35 | 0.4-MCP-26 | [`tasks/35-mcp-remote-docs-examples.md`](tasks/35-mcp-remote-docs-examples.md) | Remote MCP docs, examples и troubleshooting. |
| 36 | 0.4-REL-36 | [`tasks/36-remote-mcp-release-dod.md`](tasks/36-remote-mcp-release-dod.md) | Final regression и release DoD для remote MCP. |

## Обязательные проверки после каждой implementation task

```bash
bun test
bun run lint
bunx tsc --noEmit
bun run build
bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts
```

Для чисто документационных задач допустима проверка структуры документов и ссылок вместо полного build gate, но перед release DoD полный gate обязателен.
