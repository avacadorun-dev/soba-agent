# Phase 3 — Dependency Analysis & Execution Order

> **Проблема:** 22 задачи, 4 группы фичей (Project Memory, Fix-Until-Green, TUI Polish, CI/CD).
> Без анализа порядка будем строить то, что не на что надеть, или переписывать трижды.

---

## 1. Полный Dependency Graph

```
legend:
  A → B  = B depends on A
  A ─ B  = independent, can be parallel

PROJECT MEMORY (6 задач)
  PM-1 Knowledge Store ─ PM-2 Capsule Store ─ PM-3 Entity Graph  (independent)
  PM-1 + PM-2 → PM-4 Memory Injector
  PM-1 + PM-2 + PM-3 → PM-Aggregator (ProjectMemory class)
  PM-Aggregator → PM-5 Memory Tools (read/write_project_memory)
  PM-5 + FUG-3 → PM-6 Auto-Extractor

FIX-UNTIL-GREEN (5 задач)
  FUG-1 CommandDetector ─ (parallel with PM-1,2,3)
  FUG-1 → FUG-2 Runner + Diagnostics
  FUG-2 → FUG-3 Auto-fix Loop
  FUG-3 → FUG-4 TUI Progress
  FUG-3 → FUG-5 Agent Loop Integration

TUI POLISH (8 задач)
  TUI-1 ProviderRegistry ─ TUI-3 Notifications ─ TUI-4 TrustDialog (independent)
  TUI-1 → TUI-2 ModelSelector
  TUI-1 + TUI-2 → TUI-7 Sidebar
  ─ Collapsible (TUI-5), Search (TUI-8),
    ~~SessionBrowser~~ (TUI-9, исключено), Hotkeys (TUI-10) — semi-independent
  TUI-5 → TUI-6 (TurnSeparator) — последовательно, обе модифицируют message-list.tsx
  TUI-5 + TUI-6 + FUG-4 → MessageList Expansion

CI/CD (1 задача)
  CI-1 Pipeline — полностью независим

E2E (1 задача)
  E2E-1 — только после всего
```

---

## 2. Непротиворечивый порядок (5 фаз)

### Фаза A: Foundation (ни от кого не зависит)

Выполняется **параллельно** — задачи не пересекаются:

| # | Задача | Группа | Почему первая |
|---|--------|--------|---------------|
| **A1** | PM-1 Knowledge Store | Memory | Только IO, нет зависимостей |
| **A2** | PM-2 Capsule Store | Memory | Только IO, можно параллельно с A1 |
| **A3** | PM-3 Entity Graph | Memory | Только типы и IO |
| **A4** | FUG-1 CommandDetector | Fix | Сканирует файлы, нет зависимостей |
| **A5** | TUI-1 ProviderRegistry | TUI | Фундамент для ModelSelector |
| **A6** | TUI-3 Notifications | TUI | Изолированный компонент |
| **A7** | TUI-4 TrustDialog | TUI | Изолированный компонент |
| **A8** | CI-1 Pipeline | CI | Независим от кода |

**Что проверяем после Фазы A:**
- PM-1 читает/пишет `./.soba/memory/knowledge/*.md` ✅
- PM-2 создаёт/индексирует/prunes капсулы ✅
- PM-3 строит граф сущностей ✅
- FUG-1 находит команды в package.json, Cargo.toml, pyproject.toml, Makefile ✅
- TUI-1: 8 провайдеров, switchModel, testConnection ✅
- TUI-3: уведомления появляются и исчезают ✅
- TUI-4: модальный диалог с Tab-навигацией ✅
- CI: GitHub Actions прогоняет lint+test+build ✅

---

### Фаза B: Aggregation (собирает Фазу A)

| # | Задача | Зависит от | Что делает |
|---|--------|-----------|------------|
| **B1** | PM-4 Memory Injector | A1, A2 | Инжектит knowledge + capsules в system prompt |
| **B2** | ProjectMemory aggregator | A1, A2, A3 | Собирает 3 слоя в единый класс |
| **B3** | FUG-2 Runner + Diagnostics | A4 | Запускает команды, парсит ошибки |
| **B4** | TUI-2 ModelSelector | A5 | UI выбора модели (overlay, поиск, группировка) |
| **B5** | TUI-5 Collapsible | — | ToolResultBlock (свёртка/развёртка) |
| **B6** | TUI-6 TurnSeparator | B5 | Разделители между turns (модифицирует message-list.tsx после B5) |
| **B7** | TUI-8 Search | — | Ctrl+F, /search |
| **B8** | TUI-10 Hotkeys | — | ? overlay |

**Конфликтные точки (проверить):**
- PM-4 меняет `system-prompt.ts` → может конфликтовать с изменениями из FUG-5
  → **Решение:** PM-4 инжектит только memory-секцию. FUG-5 добавляет fix-инструкции. Они не пересекаются.
- TUI-2 (ModelSelector) и TUI-1 (ProviderRegistry) — разные файлы, конфликта нет
- TUI-5 (Collapsible) и TUI-6 (TurnSeparator) — обе модифицируют `message-list.tsx`
  → **Решение:** B6 зависит от B5 (последовательное выполнение). B5 регистрирует `ToolResultBlock`, B6 добавляет `TurnSeparator` поверх уже модифицированного файла.

---

### Фаза C: Loop & Tools (строит на Фазе B)

| # | Задача | Зависит от | Что делает |
|---|--------|-----------|------------|
| **C1** | FUG-3 Auto-fix Loop | B3 | Generate → run → detect → fix → repeat |
| **C2** | PM-5 Memory Tools | B2 | read/write_project_memory для агента |
| **C3** | TUI-7 Sidebar | A1, B4, A6 | Context bar, model, skills, permissions |

**Конфликтные точки:**
- C1 (FUG-3) и C2 (PM-5) регистрируют tools → могут конфликтовать в `tools/registry.ts`
  → **Решение:** разные tool names (`fix`, `read_project_memory`, `write_project_memory`), конфликта нет

---

### Фаза D: Integration (соединяет всё)

| # | Задача | Зависит от | Что делает |
|---|--------|-----------|------------|
| **D1** | PM-6 Auto-Extractor | C1, C2 | Авто-капсулы из Fix-Until-Green |
| **D2** | FUG-4 TUI Progress | C1 | Fix-прогресс в TUI (анимация, overlay) |
| **D3** | FUG-5 Agent Loop Integration | C1 | Запуск Fix после write/edit/bash |
| **D4** | MessageList Expansion | B5, B6, D2 | Группировка, turn-сепараторы, fix-блоки |
| **D5** | ~~TUI-9 SessionBrowser~~ (исключено) | — | Браузер сессий — откачен |

**Критический конфликт:**
- D3 (FUG-5) модифицирует `agent-loop.ts` — **самый опасный файл**
  → D3 должен быть последним изменением agent loop. Всё остальное (PM, другие тулы) должно быть готово до D3, чтобы loop integration был единственным изменением и не создавал merge hell
- **Правило:** Agent Loop модифицируется **ровно один раз** в Phase 3 (в D3)

---

### Фаза E: Polish & Verify

| # | Задача | Зависит от |
|---|--------|-----------|
| **E1** | E2E Tests | Всё |

---

## 3. Итоговый execution plan

```
Фаза A (Foundation) — 8 параллельных задач
├── PM-1 Knowledge Store        — ./soba/memory/knowledge/*.md CRUD
├── PM-2 Capsule Store           — capsules + index + pruning
├── PM-3 Entity Graph            — nodes + edges persistence
├── FUG-1 CommandDetector        — package.json → test/lint/build
├── TUI-1 ProviderRegistry        — 8 провайдеров + switchModel
├── TUI-3 Notifications           — Solid store + component
├── TUI-4 TrustDialog             — modal с кнопками + Tab
└── CI-1 CI/CD Pipeline           — GitHub Actions + templates

Фаза B (Aggregation) — 8 задач
├── PM-4 Memory Injector         → system-prompt.ts
├── ProjectMemory class          → aggregator
├── FUG-2 Runner + Diagnostics   → stderr parser
├── TUI-2 ModelSelector          → overlay с поиском
├── TUI-5 Collapsible            → tool-result fold
├── TUI-6 TurnSeparator          → turn divider (после TUI-5, обе модифицируют message-list.tsx)
├── TUI-8 Search                 → Ctrl+F overlay
└── TUI-10 Hotkeys               → ? overlay

Фаза C (Loop & Tools) — 3 задачи
├── FUG-3 Auto-fix Loop          → generate → fix → repeat
├── PM-5 Memory Tools            → read/write_project_memory
└── TUI-7 Sidebar                → context + model + skills + perms

Фаза D (Integration) — 5 задач
├── PM-6 Auto-Extractor          → FUG → capsules
├── FUG-4 TUI Progress           → fix animation + overlay
├── FUG-5 Agent Loop Integration → ТОЛЬКО 1 изменение agent-loop.ts
├── MessageList Expansion        → collapsible + separator + fix
└── ~~TUI-9 SessionBrowser~~ (исключено)

Фаза E (Polish)
└── E2E Tests
```

---

## 4. Критические правила

1. **Agent Loop модифицируется ровно один раз** — в D3 (FUG-5). До этого ни одна задача не трогает `agent-loop.ts`.
2. **Tools Registry — однократная модификация.** Tools регистрируются в C2 (PM-5). FUG-3 регистрирует свои через существующий механизм (Agent Loop видит tool calls).
3. **System Prompt — однократная модификация** для memory (B1, PM-4). FUG-5 добавляет fix-инструкции в другой секции.
4. **TUI Framework — модифицируется только расширением.** Никто не переписывает существующие компоненты, только добавляет новые.
5. **OpenResponsesClient — через Proxy.** A5 создаёт `OpenResponsesClientProxy`, который делегирует к актуальному клиенту из ProviderRegistry. AgentLoop получает proxy в конструкторе и не модифицируется при переключении провайдера.
6. **message-list.tsx — последовательные модификации.** B5 (Collapsible) модифицирует первой, B6 (TurnSeparator) — после B5. Параллельная работа с этим файлом запрещена.

---

## 5. Риски нарушения порядка

| Ошибка | Последствие |
|--------|-------------|
| FUG-5 (Agent Loop) до PM-5 (Memory Tools) | Agent loop без memory tools → потом 2 правки loop |
| TUI-7 (Sidebar) до TUI-2 (ModelSelector) | Sidebar без model info → рефакторинг |
| E2E до завершения всех задач | Тесты на недоделанные фичи → false negatives |
| PM-6 (Auto-Extractor) до FUG-3 (Auto-fix Loop) | Нечего экстрактить |
