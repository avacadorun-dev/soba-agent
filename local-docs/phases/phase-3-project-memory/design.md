# Phase 3 — Project Memory + Fix-Until-Green + CI/CD

**Версия:** SOBA 0.4.0
**Runtime:** Bun
**Предыдущая фаза:** Phase 2 — Context Intelligence + Adaptive Skills (v0.3.x)
**Следующая фаза:** Phase 4 — Memory & Orchestration (v0.5.0)
**Scope:** Project Memory (память между сессиями), Fix-Until-Green (авто-отладка), CI/CD Pipeline
**Не входит:** TUI/UX улучшения — Phase 2.5, Visual Layer — Phase 4, Multi-Agent — Phase 4

> **Ключевое изменение относительно v3 design:**
> Все TUI/UX компоненты (ProviderRegistry, Notifications, TrustDialog, ModelSelector,
> Collapsible Results, Turn Separator, Search, Hotkeys Help, ~~Session Browser~~ (исключено), Enhanced Sidebar)
> вынесены в Phase 2.5. Phase 3 фокусируется на трёх pillar'ах делегирования:
> Memory + Fix-Until-Green + Pipeline.

---

## Три столпа Phase 3

```
Phase 3: Memory + Fix-Until-Green + Pipeline
├── 🔴 PROJECT MEMORY         — киллер-фича: память между сессиями
│   ├── Knowledge Store       — 4 файла с architecture/conventions/errors/deps
│   ├── Capsule Store         — structured memory units с типами и приоритетами
│   ├── Entity Graph          — граф сущностей проекта
│   ├── Memory Injector       — инжекция в system prompt
│   ├── Memory Tools          — read/write_project_memory для агента
│   └── Auto-Extractor        — авто-капсулы из Fix-Until-Green
├── 🔴 FIX-UNTIL-GREEN        — self-healing loop (killer feature)
│   ├── CommandDetector       — определяет test/lint/build проекта
│   ├── Runner+Diagnostics    — запуск команд + парсинг ошибок
│   ├── Auto-fix Loop         — generate→run→detect→fix→repeat
│   ├── TUI Progress          — визуализация fix-цикла
│   └── Agent Loop Integration— триггер после tool execution
└── 🟡 CI/CD Pipeline          — foundation для непрерывной разработки
    ├── GitHub Actions        — lint → test → build
    ├── Pre-commit hook       — biome + tsc + test
    └── Templates             — PR/issue templates, contributing guide
```

## Принципы

1. **Persistent Memory** — агент помнит проект между сессиями. Капсулы переживают компакцию.
2. **Self-Healing** — код не бросается на полпути. Агент проверяет и чинит сам.
3. **Trust by Transparency** — всё видно в логах и событиях.
4. **CI/CD as Infrastructure** — качество кода автоматизировано от коммита до релиза.

---

## Компоненты дизайна

### 3.1. Project Memory

Файловая структура в `.soba/memory/`:

```
.soba/memory/
├── knowledge/
│   ├── architecture.md      — Ключевые архитектурные решения
│   ├── conventions.md       — Стиль кода, нейминг, паттерны
│   ├── known-errors.md      — Известные ошибки и их фиксы
│   └── dependencies.md      — Критические зависимости и версии
├── capsules/
│   ├── index.json           — Индекс с метаданными
│   └── *.json               — Капсулы (structured memory units)
├── graph/
│   └── graph.json            — Граф сущностей проекта
└── config.json              — Конфигурация памяти
```

**Knowledge Store** — 4 файла с версионностью. Агент может читать и писать туда через tools.

**Capsule Store** — структурированные записи (капсулы) с типами и приоритетами:

```typescript
interface MemoryCapsule {
  id: string;
  type: "decision" | "fix" | "insight" | "dependency" | "warning";
  priority: "critical" | "high" | "medium" | "low";
  tags: string[];
  summary: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  source?: { tool: string; turn: number };
}
```

**Entity Graph** — граф связей между сущностями проекта:

```typescript
interface GraphNode {
  id: string;
  type: "file" | "function" | "class" | "module" | "error" | "dependency";
  name: string;
  metadata: Record<string, string>;
}

interface GraphEdge {
  from: string;
  to: string;
  type: "depends_on" | "contains" | "fixes" | "related_to" | "imports";
}
```

### 3.2. Memory Injector

Формирует `<project_knowledge>` и `<project_memory>` секции в system prompt:

```xml
<project_knowledge>
### Architecture
- Микросервисная архитектура с 3 сервисами
- PostgreSQL как основная БД

### Dependencies
- biome@1.9.4 — линтер/форматтер
- openai@4.0.0 — API клиент
</project_knowledge>

<project_memory>
[critical] 2026-06-14: useImportType — convention
  Всегда используй import type для type-only импортов
  Source: Phase 2 migration → conventions.md

[fix] 2026-06-13: SessionManager race condition
  При параллельном read/write сессии — race condition.
  Фикс: мьютекс в SessionManager.read()
  Source: bug-fix → capsules/...
</project_memory>
```

### 3.3. Memory Tools

Два новых инструмента для агента:

| Tool | Description | Arguments |
|------|-------------|-----------|
| `read_project_memory` | Read project knowledge or capsules | `type: "knowledge"\|"capsules"\|"graph"`, `filter?: { tags?, type?, date? }` |
| `write_project_memory` | Write a capsule to project memory | `capsule: { type, priority, tags, summary, content }` |

### 3.4. Auto-Extractor

Автоматически создаёт капсулы из действий агента:

- **Из Fix-Until-Green:** ошибка + фикс → капсула `type: "fix"`
- **Из write_project_memory:** релевантные капсулы → индекс
- **Из команд юзера:** неявные решения → капсула `type: "decision"`

### 3.5. Fix-Until-Green

Цикл самоисправления:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ 1. DEFECT    │────→│ 2. DIAGNOSE  │────→│ 3. REPAIR    │
│ Run test/    │     │ Parse errors │     │ LLM генери-  │
│ lint/build   │     │ + структури- │     │ рует фикс    │
│              │     │ ровать       │     │ + write/edit │
└──────────────┘     └──────────────┘     └──────────────┘
       ↑                                       │
       │         ┌──────────────┐              │
       └─────────│ 4. VERIFY    │←─────────────┘
                 │ Run test     │
                 │ ещё раз      │
                 │ 🟢 done/🔴   │
                 │ repeat       │
                 └──────────────┘
```

**Компоненты:**

| Компонент | File | Responsibility |
|-----------|------|----------------|
| CommandDetector | `src/core/fix-until-green/detector.ts` | Определяет test/lint/build команды проекта |
| CommandRunner | `src/core/fix-until-green/runner.ts` | Запускает команды, собирает stdout/stderr |
| ErrorDiagnostics | `src/core/fix-until-green/diagnostics.ts` | Парсит stderr в структурированные ошибки |
| FixUntilGreenLoop | `src/core/fix-until-green/loop.ts` | Основной цикл: generate → run → detect → fix → repeat |
| FixProgress (TUI) | `src/widgets/tui/ui/fix-progress.tsx` | Solid-компонент с анимацией прогресса |

**Flow:**
1. После write/edit/bash → Agent Loop проверяет, нужно ли исправление
2. FixUntilGreenLoop запускает test/lint/build
3. Если ошибки → диагностика → LLM генерирует фикс → write/edit → повтор
4. Max 3 attempts, budget-aware, partial progress
5. Результат: 🟢 success / 🔴 failure / ⚠ partial

### 3.6. CI/CD Pipeline

**Pre-commit hook** (`.hooks/pre-commit`):
- `biome check --write` (линт + формат)
- `tsc --noEmit` (проверка типов)
- `bun test` (только changed)

**GitHub Actions** (`.github/workflows/ci.yml`):
- `biome check` (без изменений)
- `bun test` (все)
- `bun run build`

**Release workflow** (`.github/workflows/release.yml`):
- Авто-инкремент версии (conventional commits)
- Changelog generation
- Сборка binary для macOS/Linux
- GitHub release

**Templates:**
- `PULL_REQUEST_TEMPLATE.md` — чек-лист для PR
- `ISSUE_TEMPLATE/bug_report.md` — structured bug report
- `ISSUE_TEMPLATE/feature_request.md` — feature proposal
- `CONTRIBUTING.md` — как начать разработку
- `CHANGELOG.md` — keep a changelog format

---

## Спецификация API

### ProjectMemory

```typescript
interface ProjectMemory {
  knowledge: KnowledgeStore;
  capsules: CapsuleStore;
  graph: EntityGraph;

  init(): Promise<void>;
  load(): Promise<void>;
  save(): Promise<void>;
  getKnowledgeFiles(): KnowledgeFile[];
  getRelevantCapsules(context: ContextInfo): MemoryCapsule[];
  addCapsule(capsule: Omit<MemoryCapsule, "id" | "createdAt">): Promise<void>;
  getGraph(): GraphData;
  estimateTotalTokens(): number;
  formatForPrompt(): string;
}
```

### FixUntilGreenLoop

```typescript
interface FixUntilGreenConfig {
  enabled: boolean;          // default: true
  maxAttempts: number;       // default: 3
  maxTokens: number;         // default: 5000
  timeoutPerCommand: number;  // default: 30s
  includeLint: boolean;      // default: true
  includeBuild: boolean;     // default: false
}

interface FixResult {
  success: boolean;
  attempts: FixAttempt[];
  totalDuration: number;
  totalTokens: number;
  lastError?: string;
  partialFix: boolean;
}

const FUG_EVENTS = {
  START: "fix_until_green_start",
  ATTEMPT: "fix_attempt",
  PROGRESS: "fix_progress",
  SUCCESS: "fix_success",
  FAILURE: "fix_failure",
} as const;
```

---

## Команды Phase 3

| Команда | Описание | Фаза |
|---------|----------|------|
| `/fix on` | Включить Fix-Until-Green | Phase 3 |
| `/fix off` | Выключить | Phase 3 |
| `/fix status` | Статус и статистика | Phase 3 |

---

## Производительность

| Метрика | Target | Допуск |
|---|---|---|
| Knowledge Store read | < 5ms | +5ms |
| Capsule Store query (100 capsules) | < 10ms | +5ms |
| Memory injector build | < 20ms | +10ms |
| Fix: detect commands | < 20ms (кэш) | — |
| Fix: run command | < 30s (timeout) | +10s |
| Fix: parse diagnostics | < 5ms | +5ms |
| Fix: full cycle (3 attempts) | < 90s | +30s |
| CI pipeline (lint+test) | < 2 min | +1 min |

---

## Зависимости от предыдущих фаз

| Компонент Phase 3 | Зависит от Phase 1/2 |
|---|---|
| Knowledge Store | File system I/O (Phase 1) |
| Capsule Store | File system I/O (Phase 1) |
| Entity Graph | File system I/O (Phase 1) |
| Memory Injector | `buildSystemPrompt()` (Phase 1) |
| Memory Tools | ToolRegistry (Phase 1) |
| CommandDetector | Config + fs (Phase 1) |
| Runner | `bash` tool execution (Phase 1) |
| FixUntilGreenLoop | LLM + ToolExecutor (Phase 2) |
| Agent Loop Integration | agent-loop.ts (Phase 1) |
| FixProgress | TUI stores (Phase 1) |
| CI/CD | Git + Bun (Phase 1) |

---

## Что не входит в Phase 3

- **ProviderRegistry, Notifications, TrustDialog** — Phase 2.5
- **ModelSelector, Enhanced Sidebar** — Phase 2.5
- **Collapsible Results, Turn Separator** — Phase 2.5
- **Search, Hotkeys Help** — Phase 2.5 (Session Browser — исключено, откачено)
- **Visual Layer** (headless-браузер) — Phase 4
- **Multi-Agent orchestration** — Phase 4
- **Codebase Intelligence (RAG)** — Phase 4
