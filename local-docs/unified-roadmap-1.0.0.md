# Дорожная карта SOBA Agent → 1.0.0

**Дата синтеза:** 18 июня 2026
**Последнее обновление:** 27 июня 2026
**Текущая версия:** 0.5.0
**Целевая версия:** 1.0.0
**Источники:** [phase-3-project-memory/](./phases/phase-3-project-memory/),
[phase-4-v0.4.0-project-memory-mcp/](./phases/phase-4-v0.4.0-project-memory-mcp/),
[phase-4.5-agent-loop-tuning/](./phases/phase-4.5-agent-loop-tuning/)

---

## 1. Общая стратегия

### Видение релиза 1.0.0

> **SOBA 1.0.0 — инфраструктура доверия и делегирования: агент помнит проект, проверяет себя, оставляет доказательства и доставляет результат.**

SOBA не позиционируется как «ещё один агент с лучшей моделью» — модели стали commodity. К моменту 1.0.0 SOBA должна быть платформой, где разработчик делегирует задачи, а сам занимается архитектурными решениями.

### Целевая аудитория

- **Senior-разработчики** с большими кодовыми базами (6+ часовые сессии, память проекта)
- **Fullstack-разработчики** (одна сессия на весь день без потери контекста)
- **Техлиды / настройщики процессов** (Skills как Markdown, кастомизация без DevOps)
- **Privacy-conscious команды** (BYOK + open-source + self-hosted)
- **Open-source сообщество** (MIT лицензия, OpenResponses протокол)

### Ключевые метрики успеха 1.0.0

| Метрика | Target |
|---------|--------|
| Память между сессиями | Агент помнит архитектуру, конвенции, известные ошибки при перезапуске |
| Fix-Until-Green success rate | > 70% задач чинится без вмешательства пользователя |
| Время до первого полезного результата | < 30 секунд от установки |
| Сессия без деградации | 6+ часов (proactive compaction) |
| Покрытие тестами ядра | > 80% |
| Публичные бенчмарки | Опубликованы результаты на стандартных задачах |

---

## 2. Критический путь

```
Phase 2.5 (TUI/UX) → v0.4.0 (Memory + MCP + Verified Loop) → v0.5.0 (Clean Architecture + ACP) → v0.5.x (Evidence UX) → Background Delegation
        v0.3.5       →                  v0.4.0                  →              v0.5.0              →      v0.5.x       → v0.7.x–v0.8.x → v1.0.0
```

**Критическая последовательность:** Без единого tool layer и MCP нет расширяемой интеграции → без Project Memory
делегирование теряет контекст → без Verified Agent Loop и Fix-Until-Green нет доверия → без Background Agents нет
автономности.

---

## 3. Версионный план

---

### v0.3.5 — TUI/UX Polish (Phase 2.5)

**Цель:** Сделать TUI красивым и удобным. Всё, что пользователь видит каждый день.

**Фичи:**

| Приоритет | Название | Сложность | Влияние | Источник |
|-----------|----------|-----------|---------|----------|
| P0 | ProviderRegistry — 4 встроенных провайдера + runtime discovery моделей | M | High | A, B |
| P0 | TrustDialog — визуальный диалог подтверждения (кнопки вместо y/n) | M | High | A |
| P1 | NotificationCenter — система уведомлений | M | Medium | A |
| P1 | ModelSelector — меню выбора модели (overlay, поиск, группировка) | M | Medium | A |
| P1 | Collapsible Tool Results — сворачиваемые результаты тулов | S | Medium | A |
| P1 | Turn Separator — визуальное разделение turns | S | Medium | A |
| P2 | Enhanced Sidebar — context bar (skills, model, permissions) | M | Medium | A |
| P2 | Search Overlay — Ctrl+F поиск по истории сессии | M | Low | A |
| P2 | Hotkeys Help — `?` справка | S | Low | A |

**Критерии готовности (DoD):**
- ProviderRegistry: все 4 провайдера работают, switchModel не ломает AgentLoop
- TrustDialog: Tab-навигация, approve/deny работают
- NotificationCenter: уведомления появляются и исчезают без багов
- Все тесты зелёные, `biome check` → 0, `tsc --noEmit` → 0

**Риски:**
- ProviderRegistry может сломать AgentLoop (решение: OpenResponsesClientProxy)

**Что НЕ входит:**
- Session Browser — исключено, откачено из плана

---

### v0.4.0 — Project Memory + MCP + Verified Agent Loop

**Цель:** Агент помнит проект между сессиями, подключает внешние инструменты через MCP и выполняет короткие запросы по
проверяемому инженерному workflow. Это обязательный trust foundation-релиз, а не optional preview.

**Граница MCP-релиза:** SOBA в 0.4.0 является MCP-клиентом. Внешние MCP tools и встроенные tools работают через единый
`ToolRegistry` и единый execution path. В релиз входят stdio MCP foundation и remote MCP over Streamable HTTP with OAuth
UX. Экспорт SOBA как MCP-сервера и marketplace не входят в 0.4.0.

**Граница Agent Loop-релиза:** phase label `4.5` входит в v0.4.0 как hardening-блок. В релиз входят prompt/runtime
contract, user-visible Working Narration, Evidence Ledger, verification policy, Auto-Verifier, Fix-Until-Green MVP,
checkpoint/memory integration и built-in skills hardening. Multi-agent delegation, marketplace skills и enterprise
policy engine не входят.

#### Задачи 0.4.0

| ID | Приоритет | Задача | Результат | Зависит от | Оценка |
|----|-----------|--------|-----------|------------|--------|
| 0.4-MEM-01 | P0 | Knowledge Store | CRUD для `architecture.md`, `conventions.md`, `known-errors.md`, `dependencies.md`; шаблоны и token estimate | — | M |
| 0.4-MEM-02 | P0 | Capsule Store | JSON-капсулы, индекс, фильтры, relevance, pruning (`max 50`, critical не удаляются) | — | M |
| 0.4-MEM-03 | P1 | Entity Graph | Persisted graph для file/function/class/module/error/dependency | — | M |
| 0.4-MEM-04 | P0 | ProjectMemory aggregator | Единый lifecycle и API над knowledge/capsules; graph подключается опционально | MEM-01, MEM-02 | M |
| 0.4-MEM-05 | P0 | Memory Injector | Бюджетированная инжекция `<project_knowledge>` и `<project_memory>` в system prompt | MEM-01, MEM-02 | M |
| 0.4-MEM-06 | P0 | Memory Tools | `read_project_memory` и `write_project_memory`, валидация секретов и путей | MEM-04 | M |
| 0.4-MCP-01 | P0 | MCP scope и protocol baseline | Зафиксировать стабильную версию спецификации, capability matrix и out-of-scope; будущий draft не блокирует релиз | — | S |
| 0.4-MCP-02 | P0 | MCP types и config validation | Erasable TypeScript-типы, runtime-валидация config, `${ENV}` без утечки значений в лог | MCP-01 | M |
| 0.4-MCP-03 | P0 | JSON-RPC 2.0 core | Correlation по `id`, buffering, malformed messages, errors, timeouts и cancellation | MCP-01 | M |
| 0.4-MCP-04 | P0 | stdio transport | Bun subprocess, stdin/stdout framing, stderr isolation, AbortSignal, graceful shutdown | MCP-03 | L |
| 0.4-MCP-05 | P0 | MCP client lifecycle | Stable initialize handshake, tools/list с pagination, tools/call, notifications, state machine | MCP-02, MCP-04 | L |
| 0.4-MCP-06 | P0 | MCP Client Manager | Несколько серверов, lazy start, start/stop/restart, crash recovery, aggregate status | MCP-05 | M |
| 0.4-MCP-07 | P0 | MCP Tool Proxy | OpenAI-compatible namespace `mcp_<server>_<tool>`, JSON Schema mapping, result normalization/truncation | MCP-05 | M |
| 0.4-MCP-08 | P0 | ToolRegistry + AgentLoop integration | Динамическая регистрация/дерегистрация и общий execution path для built-in/MCP tools | MCP-06, MCP-07 | M |
| 0.4-MCP-09 | P0 | Trust и security boundary | Per-server trust из локального config; annotations не участвуют в security decisions; лимиты output/timeout/env | MCP-02, MCP-08 | M |
| 0.4-MCP-10 | P1 | CLI/TUI управление | `/mcp status/start/stop/restart`, статусы и понятные i18n-ready ошибки | MCP-06, MCP-08 | M |
| 0.4-MCP-11 | P0 | Shared mock MCP server + integration tests | Реальный subprocess fixture: pagination, timeout, cancellation, crash, restart, list-changed | MCP-03, MCP-04 | M |
| 0.4-MCP-12 | P1 | Документация и примеры | Настройка stdio-сервера, env, trust, troubleshooting и минимум два проверенных примера | MCP-09, MCP-10 | S |
| 0.4-MCP-13 | P0 | Remote MCP scope baseline | Зафиксировать Streamable HTTP/OAuth scope, non-goals и security boundary | MCP-01 | S |
| 0.4-MCP-14 | P0 | Config transport union | `.soba/mcp.json` поддерживает stdio и Streamable HTTP без миграции старых configs | MCP-02, MCP-13 | M |
| 0.4-MCP-15 | P0 | Transport interface hardening | Общий transport abstraction для stdio/HTTP, cancellation и diagnostics | MCP-03, MCP-04, MCP-14 | M |
| 0.4-MCP-16 | P0 | Streamable HTTP JSON path | HTTP POST, JSON-RPC response, status/error handling, redaction | MCP-15 | L |
| 0.4-MCP-17 | P0 | Streamable HTTP SSE path | `text/event-stream` response/listen support, SSE parser, reconnect metadata | MCP-16 | L |
| 0.4-MCP-18 | P0 | HTTP session management | `MCP-Session-Id`, 404 re-init, DELETE cleanup | MCP-16, MCP-17 | M |
| 0.4-MCP-19 | P0 | HTTP static auth | Bearer/API-key auth через env placeholders без утечек | MCP-14, MCP-16 | M |
| 0.4-MCP-20 | P0 | OAuth discovery + PKCE | Protected Resource Metadata, AS/OIDC discovery, scopes, PKCE | MCP-19 | L |
| 0.4-MCP-21 | P0 | OAuth browser callback UX | Browser login, localhost callback, state validation, token exchange | MCP-20 | L |
| 0.4-MCP-22 | P0 | OAuth token lifecycle | Token store, refresh, logout/revoke, redaction | MCP-21 | L |
| 0.4-MCP-23 | P0 | Remote trust/security policy | URL/header/origin policy, local-config-only trust for remote tools | MCP-18, MCP-22 | M |
| 0.4-MCP-24 | P0 | Remote ToolRegistry regression | Remote tools use the same ToolRegistry/AgentLoop path as stdio tools | MCP-23, MCP-08 | M |
| 0.4-MCP-25 | P0 | CLI/TUI remote auth UX | `/mcp auth status/login/logout`, concise auth states and notifications | MCP-22, MCP-24 | M |
| 0.4-MCP-26 | P0 | Remote MCP docs/examples | Streamable HTTP config, OAuth guide, troubleshooting, verified examples | MCP-25 | M |
| 0.4-REL-36 | P0 | Remote MCP release DoD | Final remote MCP WOW tests and full regression gate | MCP-13..MCP-26 | L |
| 0.4-AL-00 | P0 | Agent Loop eval baseline | Fixture tasks for short prompts, weak model rails, evidence and finish assertions | MEM-06, MCP-08 | M |
| 0.4-AL-01 | P0 | Prompt/runtime contract parity | `SYSTEM.md` и runtime prompt закрепляют один loop: inspect → plan → act → verify → finish | AL-00 | M |
| 0.4-AL-01A | P0 | Working Narration contract | Агент оставляет краткий user-visible след: context scan, observation, plan, verification/result без hidden CoT | AL-00, AL-01 | S |
| 0.4-AL-02 | P0 | Evidence Ledger | Runtime-журнал reads, mutations, diagnostics, verification и finish attempts | AL-00 | M |
| 0.4-AL-03 | P0 | Verification policy | Code mutation не завершается без command evidence; docs-only допускает inspection | AL-02 | M |
| 0.4-AL-04 | P0 | Finish schema alignment | Finish status, criteria и evidence не расходятся с rejection messages | AL-03 | S |
| 0.4-AL-05 | P0 | Project command detector | Bun/Biome-first detector для test/lint/typecheck/build без ESLint/Prettier drift | AL-03 | M |
| 0.4-AL-06 | P0 | Auto-Verifier runner | Loop сам запускает подходящие проверки после мутаций, если модель их пропустила | AL-05 | M |
| 0.4-AL-07 | P0 | Fix-Until-Green MVP | Bounded recovery loop: diagnostics → patch → targeted verification, max 3 итерации | AL-06 | L |
| 0.4-AL-08 | P0 | Checkpoint wiring | `checkpoint` становится control signal для milestone/plan_pivot compaction | AL-02 | M |
| 0.4-AL-09 | P1 | Reflection memory policy | Lessons из successful recovery сохраняются только после фильтра secret/dedupe/relevance | AL-07, AL-08 | M |
| 0.4-AL-10 | P1 | Built-in Skills 2.0 | Core skills получают procedure, verification contract, recovery и memory policy | AL-01 | L |
| 0.4-AL-11 | P1 | Tool ACI hardening | Helpful tool errors, mutating batch guard, search/inspect rails для слабых моделей | AL-02 | L |
| 0.4-OPS-01 | P1 | CI quality gate | Bun-only CI: Biome, `tsc --noEmit`, tests, build, dead-code scan | — | M |
| 0.4-OPS-02 | P2 | Pre-commit hook | Локальный Bun-only hook с тем же минимальным quality gate и инструкцией установки | OPS-01 | S |

#### Порядок реализации

1. Foundation: MEM-01..03, MCP-01..04 и OPS-01.
2. Aggregation: MEM-04..05, MCP-05 и MCP-11.
3. Tool layer: MEM-06, MCP-06..09. Изменения `ToolRegistry` и `AgentLoop` объединяются в одну интеграционную задачу MCP-08.
4. UX/finalization: MCP-10..12 и сквозные use-case тесты.
5. Agent Loop hardening: AL-00..11 и AL-01A как отдельный bounded epic внутри v0.4.0; самые рискованные изменения идут
   через narration/evidence/verification tests до runtime wiring.

После **каждой** задачи выполняются `bun test`, `bun run lint`, `bunx tsc --noEmit` и dead-code scan. После каждых 2–3 задач обновляется `docs/phase-3-project-memory/manual-test-run.md` или эквивалентный manual-run документ для MCP.

**Критерии готовности (DoD):**
- `.soba/memory/knowledge/*.md` создаются при первом запуске, память переживает перезапуск и укладывается в token budget.
- Агент читает и пишет project memory через tools; потенциальные секреты не сохраняются.
- Минимум два одновременно настроенных stdio MCP-сервера публикуют tools в общем registry.
- MCP tool проходит полный путь model call → trust check → execution → normalized result → JSONL session.
- Timeout, cancellation, падение и restart сервера не завершают процесс SOBA и не оставляют orphan subprocess.
- Неизвестные/несовместимые protocol capabilities дают понятную ошибку и graceful degradation.
- Stable MCP specification является обязательным compatibility baseline; поддержка неопубликованного draft не входит в release gate.
- WOW-тесты: «новая сессия знает архитектуру проекта» и «агент вызывает внешний MCP tool без специального code path».
- Short-prompt WOW-тест: «почини падение тестов» запускает inspect/verify/fix workflow без ручного описания процесса.
- Нетривиальная задача оставляет понятный рабочий след: что агент понял, какой контекст собрал, что обнаружил, что
  делает дальше и чем проверил результат.
- Code mutation не может завершиться как `completed` без verification evidence.
- `lint-fix` и похожие skills следуют project instructions и не предлагают ESLint/Prettier в SOBA project.
- `bun test`, `bun run lint`, `bunx tsc --noEmit`, `bun run build` и dead-code scan проходят без ошибок.

**Риски:**
- Объём 0.4.0 велик: P1 Entity Graph и MCP TUI могут быть урезаны, но MCP client/tool integration (MCP-01..09, MCP-11) переносить нельзя.
- Нестабильные серверы: timeout, cancellation, ограниченный restart и graceful degradation.
- Злонамеренные описания tools: trust берётся только из локального config, не из MCP annotations.
- Большие ответы: per-server byte limit, truncation marker и compact session representation.
- Draft drift: будущие версии протокола добавляются capability-адаптерами после стабилизации, без усложнения 0.4.0 release gate.
- Agent Loop дестабилизируется: AL-задачи изолированы, каждая требует eval/regression case до расширения runtime path.
- Fix-Until-Green зацикливается: max 3 итерации, repeated-diagnostic stop и budget control.

---

### v0.5.0 — Clean Architecture + ACP

**Статус:** завершено 27 июня 2026.

**Цель:** сделать SOBA protocol-independent runtime: CLI, TUI и ACP работают поверх одного runtime contract, а core policy
не зависит от app/protocol adapters.

**Фичи:**

| Приоритет | Название | Сложность | Влияние | Источник |
|-----------|----------|-----------|---------|----------|
| P0 | Clean Architecture boundaries — apps/application/core/adapters split | L | High | D |
| P0 | Shared `SobaRuntime` contract for CLI/TUI/ACP | M | High | D |
| P0 | Focused controllers/services for model turn, tools, permissions, completion, verification and context | L | High | D |
| P0 | ACP v1 stdio server for Zed | L | High | D |
| P0 | ACP tool visibility and slash-command bridge | M | High | D |
| P0 | Pre-ACP and post-ACP architecture gates | M | High | D |

**Критерии готовности (DoD):**
- Core has no imports from app/protocol/TUI layers.
- ACP adapter talks to `SobaRuntime`, not `AgentLoop` internals.
- CLI and ACP share command metadata and execution path.
- Zed receives assistant text, tool calls, file locations, raw input/output, permissions and command metadata.
- `bun test`, `bun run lint`, `bunx tsc --noEmit`, `bun run build` pass.

**Что НЕ закрыто этим релизом:**
- Evidence Bundle v1 as final handoff artifact.
- Hunk-level Diff Review UX.
- Agent Flight Recorder replay artifact.
- `soba init` first-run polish.
- ACP v2 support.

---

### v0.5.x — Evidence UX + Diff Review

**Цель:** Пользователь видит доказательства работы агента, а не просто «готово».

**Фичи:**

| Приоритет | Название | Сложность | Влияние | Источник |
|-----------|----------|-----------|---------|----------|
| P0 | Evidence Bundle v1 — changed files + commands run + pass/fail + summary | M | High | B |
| P0 | Diff Review UX — accept/reject file, accept/reject hunk, rollback turn | M | High | B |
| P1 | Agent Flight Recorder — prompt snapshot, tool calls, approvals, diffs, reasoning | L | High | B |
| P1 | First-run experience — `soba init`, provider setup, first task suggestion | M | High | B |
| P1 | `/sessions` — управление сессиями (возвращено после отката) | M | Medium | B |
| P2 | Public eval suite — 20-50 реальных задач на маленьких репах | L | Medium | B |
| P2 | Harbor + Terminal-Bench 2.0 adapter — Linux x64 one-shot binary, Docker/uv/Harbor config, API env passthrough, 1-10 task smoke runs on Air M2 | L | Medium | B |

**Критерии готовности (DoD):**
- Каждый ответ «готово» имеет evidence: changed files, commands, pass/fail
- Diff Review UX: можно принять/отклонить отдельные hunks
- Flight Recorder записывает полную сессию с возможностью replay
- `soba init` → first useful result < 30 секунд
- Опубликованы результаты eval suite
- Harbor adapter запускает SOBA в one-shot режиме через Linux x64 binary или Bun-based fallback внутри Docker.
- Terminal-Bench 2.0 smoke profile документирован: `hello-world`, 3-5 фиксированных задач и 10-task subset.
- Hardware profile для Air M2 зафиксирован: Docker Desktop, `uv tool install harbor`, `DOCKER_DEFAULT_PLATFORM=linux/amd64`,
  `n_concurrent_trials: 2` для 8GB RAM и до `4` для 16GB RAM.

**Риски:**
- Diff Review UX сложен для TUI (митигация: упрощённый inline diff, не полноценный merge tool)
- Terminal-Bench результаты могут быть шумными из-за модели/API/железа; в v0.5.x они используются как диагностический
  eval, а не как финальный benchmark claim.

---

### v0.6.0 — Project Memory 2.0 + Memory Doctor

**Цель:** Память проекта живёт, обновляется и не устаревает.

**Фичи:**

| Приоритет | Название | Сложность | Влияние | Источник |
|-----------|----------|-----------|---------|----------|
| P0 | Memory Update Loop — после успешной задачи агент предлагает memory patch | M | High | B |
| P0 | Memory Doctor — найти устаревшие memories, сравнить с кодом, предложить обновления | M | High | B |
| P1 | Repo-aware Memory Diff — после изменения кода агент обновляет память | M | High | B |
| P1 | Docs Consistency Check — если код меняется, проверить docs-site/README | M | Medium | B |
| P1 | Memory Retrieval — не всё в prompt, выбирать релевантные memories по задаче | M | Medium | B |
| P2 | Knowledge Store v2 — ADR-lite, decisions.jsonl с provenance | M | Medium | B |

**Критерии готовности (DoD):**
- Memory auto-update: агент сам предлагает обновления после задач
- Memory Doctor: находит устаревшие капсулы и предлагает обновления
- Memory Retrieval: правильные капсулы попадают в контекст по тегам

**Риски:**
- Memory Doctor даёт ложные срабатывания (митигация: confidence score, только предлагать)

---

### v0.7.0 — Background Tasks + Git Worktrees

**Цель:** Задачи живут дольше терминала. Переход от ассистента к делегированию.

**Фичи:**

| Приоритет | Название | Сложность | Влияние | Источник |
|-----------|----------|-----------|---------|----------|
| P0 | Task Model — task id, status, branch, session, evidence, logs | L | **Critical** | B |
| P0 | Background Runner — `soba task start/list/attach/cancel` | L | **Critical** | B |
| P0 | Isolated Git Worktrees — каждая задача в своём worktree/branch | M | **Critical** | B |
| P1 | Notifications — terminal, desktop, webhook (Slack/Telegram) | M | High | B |
| P1 | Scheduled Maintenance — weekly dependency update, docs freshness, dead code scan | M | Medium | B |
| P1 | Autonomous benchmark runner — много Terminal-Bench/Harbor задач в фоне, очередь, лимиты параллельности, retries, artifacts и summary reports | L | High | B |

**Критерии готовности (DoD):**
- `soba task start "добавь фичу X"` — работает в фоне
- `soba task list` — показывает статус всех задач
- `soba task attach <id>` — подключает к активной задаче
- Изолированные git worktrees: нет конфликтов между задачами
- Нотификации приходят, когда задача завершена
- `soba bench terminal-bench run --n-tasks 10` или эквивалент запускает Harbor jobs как background tasks.
- Большие прогоны не требуют открытого TUI: можно detach/attach, посмотреть status, логи, reward summary и failed task artifacts.
- Runner уважает hardware profile: ограничивает concurrency, timeouts и disk cleanup для локального Air M2, а также допускает cloud backend позже.

**Риски:**
- Race conditions на файловой системе (митигация: git worktrees изолируют)
- Сложность UX attach/detach (митигация: интерактивный TUI)
- Долгие benchmark runs создают много Docker artifacts и логов; нужен cleanup policy и явный jobs-dir.

---

### v0.8.0 — Verification-as-Contract + Confidence Escalation

**Цель:** Агент не просто говорит «готово», а сдаёт работу с доказательствами. Сам понимает, когда спрашивать.

**Фичи:**

| Приоритет | Название | Сложность | Влияние | Источник |
|-----------|----------|-----------|---------|----------|
| P0 | Verification-as-Contract — YAML-контракт с acceptance criteria + proof | L | High | B |
| P0 | Confidence-based Escalation — >95% автономно, <80% спрашивает, dangerous → explicit | M | High | B |
| P1 | Multi-Model Arbitration — Planner на дешёвой, Coder на coding, Reviewer на reasoning | L | Medium | B |
| P1 | Agent Bisection — найти turn деградации, сравнить ветки session tree, откатить | M | Medium | B |
| P2 | Policy Engine v1 — декларативные YAML политики (allow/deny/network/filesystem/secrets) | L | Medium | B |

**Критерии готовности (DoD):**
- Контракт: acceptance criteria + proof bundle + command outputs
- Escalation: агент сам решает, когда спросить пользователя
- Bisection: можно найти, где агент ошибся в JSONL-tree
- Multi-model: разные модели для разных ролей

**Риски:**
- Multi-model дорого (митигация: только для сложных задач)
- Confidence-модель может быть неточной (митигация: калибровка на eval suite)

---

### v1.0.0-rc.1 — Заморозка фич

**Цель:** Никаких новых фич. Только стабилизация, баг-фиксы, документация, бенчмарки.

**Что входит:**
- Полный прогон регресс-тестов
- Закрытие всех известных багов P0/P1
- Финальная документация (user guide, API reference, getting started)
- Публикация eval suite результатов
- Подготовка к релизу: changelog, migration guide, release notes
- Сборка бинарников под macOS (arm64/x64) и Linux (x64)

**Критерии готовности (DoD):**
- Регресс-тесты: 0 FAIL
- `biome check` → 0
- `tsc --noEmit` → 0
- `bun test` → 100% green
- `bun run build` → success
- Dead code scan → 0 `💀 dead`
- Документация синхронизирована с кодом
- Все известные P0/P1 баги закрыты

**Риски:**
- Обнаружение критических багов на финальном прогоне

---

### v1.0.0 — Релиз

**DoD финального релиза:**

1. **Core-фичи (все P0):**
   - ✅ Project Memory: агент помнит проект между сессиями
   - ✅ MCP Client: внешние stdio tools работают через единый ToolRegistry
   - ✅ Fix-Until-Green: агент чинит свой код до зелёного
   - ✅ Evidence Bundle: каждый ответ с доказательствами
   - ✅ Background Tasks: задачи живут дольше терминала
   - ✅ Confidence Escalation: агент знает, когда спросить

2. **UX:**
   - ✅ ProviderRegistry: 4+ провайдера, runtime discovery
   - ✅ TUI: sidebar, notifications, trust dialog, search, hotkeys
   - ✅ `soba init` → first useful result < 30 секунд

3. **Качество:**
   - ✅ Все тесты зелёные
   - ✅ CI/CD: GitHub Actions на push/PR
   - ✅ Pre-commit hook
   - ✅ Публичные бенчмарки

4. **Документация:**
   - ✅ User Guide
   - ✅ API Reference
   - ✅ Getting Started
   - ✅ Changelog

5. **Дистрибуция:**
   - ✅ Бинарники: macOS arm64/x64, Linux x64
   - ✅ npm пакет
   - ✅ Homebrew (опционально)

---

## 4. Зависимости и риски

### Таблица зависимостей

| Фича | Блокеры | Блокирует | Можно параллельно |
|------|---------|-----------|-------------------|
| ProviderRegistry | — | ModelSelector, Sidebar | Knowledge Store, Capsule Store |
| Knowledge Store | — | Memory Injector, ProjectMemory | Capsule Store, Entity Graph, CommandDetector |
| Capsule Store | — | Memory Injector, ProjectMemory | Knowledge Store, Entity Graph, CommandDetector |
| Entity Graph | — | ProjectMemory | Knowledge Store, Capsule Store, CommandDetector |
| Memory Injector | Knowledge Store, Capsule Store | System Prompt | — |
| ProjectMemory (aggregator) | Knowledge Store, Capsule Store, Entity Graph | Memory Tools | Runner |
| Memory Tools | ProjectMemory | Auto-Extractor | Auto-fix Loop |
| MCP JSON-RPC + stdio | MCP protocol baseline | MCP Client | Memory stores |
| MCP Client | MCP JSON-RPC + stdio | Client Manager, Tool Proxy | ProjectMemory |
| MCP Client Manager | MCP Client | ToolRegistry integration, CLI/TUI | Memory Injector |
| MCP Tool Proxy | MCP Client | ToolRegistry integration | MCP Client Manager |
| MCP ToolRegistry integration | Client Manager, Tool Proxy | Trust boundary, external tools | Memory Tools |
| MCP Trust boundary | MCP config, ToolRegistry integration | MCP release gate | MCP CLI/TUI |
| Prompt/runtime contract | SYSTEM.md, prompt builder | Working Narration, Evidence Ledger, skill protocol | MCP docs |
| Working Narration | Prompt/runtime contract, Agent Loop eval baseline | Evidence Ledger, Flight Recorder, Evidence Bundle UX | TUI polish |
| Evidence Ledger | Agent Loop eval baseline | Verification policy, finish gate, checkpoints | ProjectMemory |
| Verification policy | Evidence Ledger | Auto-Verifier, Completion Gate | Built-in skills |
| CommandDetector | Project instructions, package scripts | Auto-Verifier | Knowledge Store, Capsule Store |
| Auto-Verifier | CommandDetector, verification policy | Fix-Until-Green | ProjectMemory |
| Fix-Until-Green | Auto-Verifier, diagnostics | Reflection memory, Evidence Bundle | Memory Tools |
| Checkpoint wiring | Evidence Ledger, ContextManager | Long-task handoff | Built-in skills |
| Auto-Extractor / reflection memory | Fix-Until-Green, Memory Tools | Memory Doctor | — |
| Evidence Bundle | Verified Agent Loop, Memory Tools | Diff Review UX | — |
| Flight Recorder | Verified Agent Loop | — | — |
| Background Tasks | ProjectMemory, Verified Agent Loop | — | — |
| Confidence Escalation | ProjectMemory, Evidence Bundle | — | — |
| Verification-as-Contract | Evidence Bundle, Fix-Until-Green | — | — |

### Ключевые риски и митигация

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| **Agent Loop дестабилизируется** | Средняя | Критичное | Bounded AL-задачи, Evidence Ledger первым, обязательные eval/regression tests |
| **Память раздувается** | Средняя | Среднее | Pruning: max капсул, приоритеты, budget токенов |
| **Fix-Until-Green зацикливается** | Средняя | Высокое | Max 3 итерации + budget control |
| **TUI перформанс падает** | Низкая | Среднее | Каждый компонент профилируется отдельно |
| **Несовместимость с новыми моделями** | Средняя | Среднее | OpenResponses — абстрактный протокол |
| **Утечка API ключей** | Низкая | Критичное | Memory файлы валидируются при записи |
| **Недоверенный MCP-сервер** | Средняя | Критичное | Trust только из локального config, output/time/env limits, annotations не являются policy input |
| **Падение/зависание MCP subprocess** | Средняя | Высокое | Timeout, cancellation, bounded restart, graceful shutdown без orphan processes |
| **MCP draft drift** | Высокая | Среднее | Release gate на стабильной спецификации; draft поддерживается только отдельным compatibility adapter |
| **Конфликты Background Tasks** | Средняя | Высокое | git worktrees изолируют workspace |
| **Benchmark результаты ниже ожиданий** | Средняя | Низкое | Не конкурировать по benchmark, а по delegation |

---

## 5. Что НЕ входит в 1.0.0 (пост-релизный бэклог)

### После 1.0.0

| Категория | Фича | Причина откладывания |
|-----------|------|---------------------|
| Multi-Agent | Planner → Coder → Tester → Reviewer как sub-agents | Слишком сложно без доверенной памяти и верификации |
| MCP server/export | SOBA публикует встроенные tools как MCP-сервер | Для 1.0 обязателен MCP-клиент; server-side export — отдельное расширение |
| Visual Layer | Headless browser, скриншоты, визуальный diff | Ниша фронтенда, не core-платформа |
| Deep Research | Web scraping, PDF-парсинг, скриншот-анализ | MCP-серверы делают это лучше |
| Team Memory | Shared `.soba/memory` между командой | Нужна сначала стабильная single-user память |
| GitHub/GitLab | Issue-to-PR flow, PR review agent | Нужны сначала background tasks |
| Enterprise | SSO, RBAC, audit dashboard | До adoption нет смысла |
| Skill Marketplace | Publish/install/rate skills | Нужна экосистема пользователей |
| IDE Bridge | VS Code / JetBrains extension | Отдельный продукт, не core |
| Windows Support | Бинарники под Windows | Только после стабильного macOS/Linux |
| Semantic Code Index | Embeddings/AST/LSP-aware map | Отдельная RAG-подсистема |

---

## 6. Полный дедуплицированный бэклог

> **Формат:** Название | Категория | Приоритет | Сложность | Версия | Источники

### Уже реализовано (Phase 1-2)

| Название | Источник |
|----------|----------|
| JSONL session tree | A, B |
| Proactive compaction | A, B |
| Context Capsules | A, B |
| Adaptive Skills (bundled/user/project) | A, B |
| Trust model (safe/normal/dangerous) | A, B |
| TUI: очередь, sidebar, hotkeys | A, B |
| Provider registry: OpenAI-compatible | A |
| Мультиязычность и темы | A |
| OpenResponses-клиент | A |

### Запланировано (Phase 2.5 – 1.0.0)

| # | Название | Категория | Приоритет | Сложность | Версия | Источники |
|---|----------|-----------|-----------|-----------|--------|-----------|
| 1 | ProviderRegistry + runtime model discovery | Core | P0 | M | v0.3.5 | A, B |
| 2 | TrustDialog (визуальный) | Enhancement | P0 | M | v0.3.5 | A |
| 3 | NotificationCenter | Enhancement | P1 | M | v0.3.5 | A |
| 4 | ModelSelector (overlay) | Enhancement | P1 | M | v0.3.5 | A |
| 5 | Collapsible Tool Results | Enhancement | P1 | S | v0.3.5 | A |
| 6 | Turn Separator | Enhancement | P1 | S | v0.3.5 | A |
| 7 | Enhanced Sidebar | Enhancement | P2 | M | v0.3.5 | A |
| 8 | Search Overlay (Ctrl+F) | Enhancement | P2 | M | v0.3.5 | A |
| 9 | Hotkeys Help (`?`) | Enhancement | P2 | S | v0.3.5 | A |
| 10 | Knowledge Store | Core | P0 | M | v0.4.0 | A, B, C |
| 11 | Capsule Store + pruning | Core | P0 | M | v0.4.0 | A, B, C |
| 12 | Entity Graph | Core | P1 | M | v0.4.0 | A, B, C |
| 13 | Memory Injector | Core | P0 | M | v0.4.0 | A, B, C |
| 14 | Memory Tools (read/write) | Core | P0 | M | v0.4.0 | A, B, C |
| 15 | ProjectMemory aggregator | Core | P0 | M | v0.4.0 | A, B, C |
| 15a | MCP client + stdio transport + JSON-RPC | Core | P0 | XL | v0.4.0 | A, B |
| 15b | MCP ToolRegistry/AgentLoop integration | Core | P0 | L | v0.4.0 | A, B |
| 15c | MCP trust, resilience and integration tests | Core | P0 | L | v0.4.0 | A, B |
| 15d | MCP CLI/TUI + documentation | Enhancement | P1 | M | v0.4.0 | A, B |
| 16 | Agent Loop eval baseline | Core | P0 | M | v0.4.0 | D |
| 17 | Prompt/runtime contract parity | Core | P0 | M | v0.4.0 | D |
| 17a | Working Narration contract | Core | P0 | S | v0.4.0 | D |
| 18 | Evidence Ledger + strict finish gate | Core | P0 | L | v0.4.0 | D |
| 19 | CommandDetector + Auto-Verifier | Core | P0 | L | v0.4.0 | A, B, C, D |
| 20 | Fix-Until-Green MVP (max 3) | Core | P0 | L | v0.4.0 | A, B, C, D |
| 21 | Checkpoint wiring + reflection memory policy | Core | P0 | M | v0.4.0 | D |
| 21a | Built-in Skills 2.0 + skill evals | Core | P1 | L | v0.4.0 | D |
| 21b | Tool ACI hardening for weak models | Core | P1 | L | v0.4.0 | D |
| 22 | CI/CD Pipeline | Tech Debt | P1 | M | v0.4.0 | A, B, C |
| 23 | Pre-commit hook | Tech Debt | P2 | S | v0.4.0 | C |
| 23a | Clean Architecture boundaries | Core | P0 | L | v0.5.0 | D |
| 23b | Shared `SobaRuntime` contract | Core | P0 | M | v0.5.0 | D |
| 23c | ACP v1 server for Zed | Core | P0 | L | v0.5.0 | D |
| 23d | ACP tool visibility and slash-command bridge | Core | P0 | M | v0.5.0 | D |
| 24 | Evidence Bundle v1 | Core | P0 | M | v0.5.x | B |
| 25 | Diff Review UX | Core | P0 | M | v0.5.x | B |
| 26 | Agent Flight Recorder | Core | P1 | L | v0.5.x | B |
| 27 | First-run experience (`soba init`) | Enhancement | P1 | M | v0.5.x | B |
| 28 | `/sessions` management | Enhancement | P1 | M | v0.5.x | B |
| 29 | Public eval suite | Tech Debt | P2 | L | v0.5.x | B |
| 29a | Harbor + Terminal-Bench 2.0 adapter | Tech Debt | P2 | L | v0.5.x | B |
| 30 | Memory Update Loop | Core | P0 | M | v0.6.0 | B |
| 31 | Memory Doctor | Core | P0 | M | v0.6.0 | B |
| 32 | Repo-aware Memory Diff | Core | P1 | M | v0.6.0 | B |
| 33 | Docs Consistency Check | Enhancement | P1 | M | v0.6.0 | B |
| 34 | Memory Retrieval (relevance) | Core | P1 | M | v0.6.0 | B |
| 35 | Knowledge Store v2 (provenance) | Core | P2 | M | v0.6.0 | B |
| 36 | Task Model | Core | P0 | L | v0.7.0 | B |
| 37 | Background Runner | Core | P0 | L | v0.7.0 | B |
| 38 | Isolated Git Worktrees | Core | P0 | M | v0.7.0 | B |
| 39 | Notifications (desktop/Slack) | Enhancement | P1 | M | v0.7.0 | B |
| 40 | Scheduled Maintenance | Enhancement | P1 | M | v0.7.0 | B |
| 40a | Autonomous benchmark runner | Enhancement | P1 | L | v0.7.0 | B |
| 41 | Verification-as-Contract | Core | P0 | L | v0.8.0 | B |
| 42 | Confidence-based Escalation | Core | P0 | M | v0.8.0 | B |
| 43 | Multi-Model Arbitration | Enhancement | P1 | L | v0.8.0 | B |
| 44 | Agent Bisection | Enhancement | P1 | M | v0.8.0 | B |
| 45 | Policy Engine v1 | Core | P2 | L | v0.8.0 | B |

### Исключено из 1.0.0 (отложено)

| # | Название | Причина | Источники |
|---|----------|---------|-----------|
| 46 | Multi-Agent Orchestrator (Planner→Coder) | Phase 4+ | A, B |
| 47 | SOBA as MCP server / built-in tool export | После client-side стабилизации | A, B |
| 48 | Visual Layer (headless browser) | Phase 6+ | A, B |
| 49 | Deep Research (MCP-сервер) | Phase 6+ | A, B |
| 50 | Team Memory Sync | Phase 7+ | B |
| 51 | Issue-to-PR flow | Phase 4+ | B |
| 52 | PR Review Agent | Phase 4+ | B |
| 53 | Enterprise (SSO/RBAC/Audit) | Phase 7+ | B |
| 54 | Skill Marketplace/Registry | Phase 6+ | B |
| 55 | IDE Bridge (VS Code/JetBrains) | Отдельный продукт | B |
| 56 | Semantic Code Index (RAG) | Phase 4+ | B |
| 57 | Windows Support | После 1.0.0 | A |
| 58 | Session Browser | Исключено, откачено | A |

---

## 7. Приложения

### A. Ссылки на исходные планы

- **План А:** [docs/phases/phase-3-project-memory/](./phases/phase-3-project-memory/) — Project Memory и исходный
  Fix-Until-Green дизайн.
- **План Б:** [docs/phases/phase-4-v0.4.0-project-memory-mcp/](./phases/phase-4-v0.4.0-project-memory-mcp/) —
  Project Memory + MCP foundation v0.4.0.
- **План В:** [docs/phases/phase-4.5-agent-loop-tuning/](./phases/phase-4.5-agent-loop-tuning/) — Verified Agent Loop,
  Working Narration, Evidence Ledger и built-in skills hardening.

### B. Текущий статус (20 июня 2026)

- **Версия:** 0.4.0
- **Реализовано:** Phase 1 (Core), Phase 2 (Context Intelligence + Skills), Phase 2.5 (TUI/UX), v0.4.0 Memory/MCP
  foundation.
- **В процессе:** v0.4.0 hardening: Verified Agent Loop, Working Narration, Evidence Ledger, Auto-Verifier,
  Fix-Until-Green MVP и built-in skills 2.0.
- **MCP статус:** входит в v0.4.0 release boundary как client + unified ToolRegistry path. Server/export и marketplace
  остаются post-1.0 backlog.

### C. Легенда приоритетов

| Метка | Значение |
|-------|----------|
| P0 | Критично — релиз 1.0.0 невозможен без этого |
| P1 | Важно — значительно улучшает продукт |
| P2 | Желательно — можно подвинуть |

### D. Легенда сложности

| Метка | Значение |
|-------|----------|
| S | Малая — до 3 часов |
| M | Средняя — 3-8 часов |
| L | Большая — 8-20 часов |
| XL | Эпик — 20+ часов |

---

## 8. Консистентность и полнота

### Проверка покрытия исходных планов

| Источник | Статус покрытия | Комментарий |
|----------|-----------------|-------------|
| `phase-3-project-memory/` | Покрыт с переносом | Memory входит в 0.4.0; Fix-Until-Green теперь входит в v0.4.0 через Agent Loop Tuning epic |
| `phase-4-v0.4.0-project-memory-mcp/` | Покрыт | MCP-client, ToolRegistry, remote Streamable HTTP/OAuth и release gates остаются scope v0.4.0 |
| `phase-4.5-agent-loop-tuning/` | Покрыт | Phase label сохранён, но релизная версия — v0.4.0 |
| MCP plan (`architecture/mcp/plan.md`) | Требует актуализации до implementation | Scope задач использован, но future-draft baseline и устаревшие пути нельзя переносить в код без исправления |

Точные счётчики «всего/учтено/потеряно» удалены: источники используют разные уровни гранулярности (эпики, фичи и implementation tasks), поэтому прежние числа `17/42/24` не были воспроизводимой проверкой покрытия.

### Выявленные противоречия и разрешения

| Противоречие | Старое состояние | Новое решение |
|-------------|----------------|-------------|
| Session Browser | Исключён, затем частично возвращался в backlog | Исключён из v0.4.0; возможен только отдельным UX backlog после evidence/diff priorities |
| MCP | Одновременно must-have, optional и post-1.0 | MCP-клиент, единый ToolRegistry и stdio/remote integration входят в 0.4.0; server-side export остаётся позже |
| Fix-Until-Green | Отдельная версия v0.4.5 | Входит в v0.4.0 как часть Verified Agent Loop epic |
| Auto-Extractor | Был связан с FUG и переносился после 0.4.0 | Reflection memory policy входит в v0.4.0; широкий Auto-Extractor остаётся Memory 2.0 backlog |
| MCP protocol baseline | Draft мог выглядеть как release gate | Стабильная опубликованная спецификация — release gate; будущий draft не блокирует 0.4.0 |
| Phase 4.5 scope | Выглядел как будущая версия | Это phase/epic label внутри v0.4.0 |
| MCP architecture | «MCP-native» могло означать client и server | Для 0.4.0 это MCP client + единый ToolRegistry; SOBA-as-server явно отложен |
| Visual Layer | Фигурировал до 1.0.0 в старых стратегиях | Отложен после 1.0.0 как отдельный frontend/multimodal track |
| Multi-Agent Orchestration | Фигурировал до стабилизации single-agent runtime | Отложен после 1.0.0; сначала нужен verified single-agent loop |
| Memory структура | `.soba/memory/` была консистентной во всех phase-дизайнах | Остаётся базовой структурой Project Memory |

### Найденные ошибки, исправленные этой ревизией

1. MCP одновременно был must-have, optional и post-1.0 — закреплён как P0 версии 0.4.0.
2. В 0.4.0 отсутствовали исполнимые MCP-задачи — добавлены protocol, transport, lifecycle, registry, trust, tests и UX tasks с зависимостями.
3. Fix-Until-Green больше не выделен в v0.4.5; Verified Agent Loop входит в v0.4.0.
4. Критический путь не содержал MCP и смешивал номера фаз с версиями — переписан по реальным release dependencies.
5. В post-1.0 backlog был ошибочно отложен весь MCP — оставлен только server-side export и ecosystem expansion.
6. Непроверяемые claims о полном покрытии источников заменены трассируемым качественным статусом.
7. Будущий draft MCP был указан как основной протокол до даты его версии — stable spec закреплена как release baseline.
8. Удалены ссылки на снятые стратегические документы; актуальные источники теперь находятся в `docs/phases/`.

---

> **Документ синтезирован из phase-артефактов. Последнее обновление: 20 июня 2026.**
