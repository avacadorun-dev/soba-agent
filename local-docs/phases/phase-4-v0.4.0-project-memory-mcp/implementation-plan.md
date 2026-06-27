# v0.4.0 — последовательный implementation plan

## Release boundary

В v0.4.0 входят только:

1. Project Memory v1:
   - markdown knowledge files;
   - JSON capsules;
   - optional persisted entity graph;
   - ProjectMemory aggregator;
   - budget-aware prompt injection;
   - memory tools with secret/path validation.
2. MCP client foundation:
   - latest MCP protocol baseline with released-version fallback;
   - config/types validation;
   - JSON-RPC 2.0 core;
   - stdio transport;
   - Streamable HTTP transport;
   - HTTP session management;
   - static bearer/API-key auth through env placeholders;
   - OAuth discovery, PKCE browser flow, token storage, refresh and logout/revoke;
   - client lifecycle;
   - multi-server manager;
   - MCP tool proxy;
   - unified ToolRegistry execution path;
   - trust/security boundary.
3. Ops:
   - Bun-only CI quality gate;
   - optional pre-commit hook.

Не входят: MCP server/export, marketplace, deprecated HTTP+SSE as a first-class transport, draft-only behavior without
released fallback.

## Глобальные инварианты

- Runtime: только Bun.
- Форматтер/линтер: только Biome.
- TypeScript: erasable syntax only, без enum, type-only imports через `import type`.
- Все новые файлы: kebab-case.
- MCP trust decisions берутся только из локального config, не из tool annotations.
- MCP subprocess не должен оставлять orphan-процессы.
- Большие MCP outputs нормализуются, ограничиваются и маркируются truncation marker.
- Memory write path не должен сохранять секреты и не должен писать вне `.soba/memory`.
- AgentLoop и ToolRegistry меняются только в bounded integration task `16-mcp-tool-registry-agent-loop-integration.md`.

## Task 00 baseline decisions

Эти решения фиксируют границы v0.4.0 перед реализацией задач 01–21.

### MCP config

- Primary config для v0.4.0: project-local `.soba/mcp.json`.
- Config загружается только из текущего project root. Auto-discovery из `package.json`, marketplace/registry и remote config не входят в v0.4.0.
- User/global MCP config не входит в v0.4.0, чтобы trust boundary оставался локальным и ревьюируемым в репозитории.
- Минимальный stdio shape уточняется в task 05: server id/name, `command`, `args`, `cwd`, env mapping, timeout/output limits, trust mode, enabled/disabled flag.
- Remote shape добавляется в tasks 23–31: `transport: "streamableHttp"`, `url`, optional headers, auth config, OAuth metadata/token lifecycle.
- Env values не должны хранить секреты напрямую. Разрешён только mapping на переменные окружения процесса, например `${ENV:GITHUB_TOKEN}`.

### MCP protocol baseline

- Source of truth: локальный checkout `/Users/avacado/Projects/ai-projects/modelcontextprotocol/` плюс published docs
  `modelcontextprotocol.io`.
- Preferred architecture target: latest MCP draft/next era from local `schema/draft` and `docs/specification/draft`.
  На момент Task 00 это modern/stateless protocol shape с examples for `2026-07-28`: `server/discover`,
  per-request `_meta.io.modelcontextprotocol/*`, no mandatory `initialize` session handshake.
- Обязательный released fallback: latest released MCP specification `2025-11-25`, пока draft/next не опубликован как
  versioned release в `schema/<YYYY-MM-DD>/`.
- Клиент должен быть dual-era-ready: сначала modern stdio probe через `server/discover`; если server явно modern, выбрать
  взаимно поддерживаемую версию; если server legacy или probe timeout/non-modern error — fallback to `initialize`.
- Transport scope v0.4.0: stdio foundation first, then Streamable HTTP as tasks 22–36.
- OAuth/authorization scope v0.4.0: HTTP-based MCP authorization with OAuth 2.1 authorization code + PKCE, Protected
  Resource Metadata, AS metadata/OIDC discovery fallback, token refresh and logout/revoke.
- Deprecated HTTP+SSE from protocol `2024-11-05` remains out-of-scope unless a named legacy server requires a separate
  compatibility task.
- JSON-RPC 2.0 core обязателен: request/response/notification envelope, deterministic id handling, protocol errors,
  request timeouts, cancellation notification where supported.
- Вся логика строится вокруг negotiated capabilities. SOBA не должна вызывать capability, который server не объявил.
- Protocol constants должны быть изолированы в MCP module, чтобы Task 04 мог обновить preferred version без каскадного
  переписывания manager/proxy/tool registry.

### MCP capabilities in v0.4.0

Supported:

- `server/discover` modern probe where available; legacy `initialize` fallback.
- `tools`: `tools/list`, pagination, deterministic ordering assumption, `tools/call`.
- Modern tool results: preserve `resultType`, `ttlMs`, `cacheScope`, `structuredContent`, `isError`, truncation metadata.
- Tool-list change signals: legacy `notifications/tools/list_changed`; modern `subscriptions/listen` can be accepted as
  diagnostics/cache invalidation, but is not required for first successful tool-call path.
- Stdio `stderr`: принимать и безопасно записывать/показывать server logs без трактовки `stderr` как protocol failure.
- `resources`: допускается как metadata/read-only discovery surface для будущего расширения, но не является обязательным
  user-facing feature release goal.

Graceful degradation:

- `prompts`: не проксируются в model tools в v0.4.0; server остаётся подключённым, capability помечается unsupported.
- Legacy `resources/subscribe` и modern `subscriptions/listen`: не являются blocking release feature; отсутствие поддержки не
  ломает `tools/list`/`tools/call`.
- Modern MRTR `input_required` results: surface typed needs-input/unsupported result; не пытаться автоматически отвечать от
  имени пользователя или модели.
- `sampling`, `elicitation`, `roots`, `tasks`, `completions`, `experimental`, `extensions`: не исполняются в v0.4.0. Если
  server запрашивает client-side capability, SOBA возвращает typed unsupported/declined result и продолжает с доступными
  tools.
- Unknown server capabilities сохраняются в diagnostics, но не влияют на trust decision и не пробрасываются в модель.

### Quality gate

Для каждой implementation task перед коммитом обязательны:

1. `bun test`
2. `bun run lint`
3. `bunx tsc --noEmit`
4. `bun run build`
5. `bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts`

Docs-site gates запускаются только при изменениях в `docs-site/`:

1. `cd docs-site && bun run types:check`
2. `cd docs-site && bun run build`

`bun run lint` остаётся canonical lint gate для основного package и должен использовать Biome. ESLint/Prettier в проект не добавляются.

### Risk cuts

Можно урезать без нарушения v0.4.0 release goal:

- P1 persisted Entity Graph: оставить optional store behind feature flag или memory-only derivation, если tasks 01–03 начинают блокировать MCP path.
- MCP TUI management: заменить на CLI-only management и docs, если integration risk высокий.
- Rich resources UX: оставить read-only diagnostics без prompt injection.
- Optional pre-commit hook: оставить documented manual gate, если hook нестабилен на разных окружениях.

Нельзя переносить из v0.4.0:

- Project Memory stores, aggregator, injection и safe memory tools.
- MCP config validation, JSON-RPC core, stdio transport, lifecycle, manager, tool proxy.
- Unified ToolRegistry/AgentLoop execution path для MCP tools.
- Trust/security boundary и normalized/truncated MCP outputs.
- Final WOW/integration tests с минимум двумя stdio MCP servers.

## Порядок реализации

### 00. Release framing

Сначала прочитать `tasks/00-release-framing.md` и зафиксировать локальные решения: где лежит config, какие MCP schemas поддерживаются, какие команды gate используются в package scripts.

### 01–08. Foundation

Реализуются независимые foundational components. После задач 01–03 можно сделать memory checkpoint; после задач 04–07 — MCP core checkpoint; после 08 — ops checkpoint.

### 09–12. Aggregation

Собираем stores в ProjectMemory, подключаем injection, затем MCP lifecycle и общий mock server. После 12 должен быть первый устойчивый integration baseline.

### 13–17. Tool layer

Добавляем memory tools, manager, proxy, единый registry execution path и trust boundary. Это самый рискованный блок; каждую задачу держать маленькой и не растягивать контекст соседних задач.

### 18–21. UX/finalization

Добавляем управление MCP, документацию, pre-commit hook и сквозные WOW-тесты.

### 22–36. Remote MCP Streamable HTTP + OAuth

После stdio foundation добавляем remote MCP без отдельного AgentLoop path:

1. 22–24: зафиксировать remote scope, расширить config transport union, hardened transport interface.
2. 25–27: реализовать Streamable HTTP JSON path, SSE path и `MCP-Session-Id` lifecycle.
3. 28–31: static auth, OAuth discovery/PKCE, browser callback UX, token storage/refresh/logout.
4. 32–33: remote-specific security/trust policy and ToolRegistry regression.
5. 34–36: `/mcp auth` UX, docs/examples and final remote release DoD.

Подробный план: [`remote-http-oauth-plan.md`](remote-http-oauth-plan.md).

## Checkpoint cadence

См. [`checkpoint-policy.md`](checkpoint-policy.md). Минимум:

- после 03 — Project Memory stores baseline;
- после 07 — MCP JSON-RPC + stdio baseline;
- после 12 — aggregation baseline;
- после 17 — unified tool layer + trust baseline;
- после 21 — release candidate baseline.
- после 26 — Streamable HTTP transport baseline;
- после 31 — MCP OAuth credential lifecycle baseline;
- после 36 — v0.4.0 remote MCP release candidate baseline.

## Ручные проверки

После каждых 2–3 implementation tasks обновлять [`manual-test-run.md`](manual-test-run.md). Для MCP обязательно проверить реальные subprocess scenarios: pagination, timeout, cancellation, crash, restart, list-changed notification.
