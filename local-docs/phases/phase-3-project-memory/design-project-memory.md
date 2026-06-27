# SOBA Project Memory — Дизайн (Phase 3 Core Addition)

> **Киллер-фича:** SOBA помнит проект между сессиями.
> Открыл новую сессию → агент уже знает архитектуру, конвенции, известные ошибки и предыдущие решения.

---

## 1. Проблема

### Сейчас (без памяти)

```
Сессия 1:  "Напиши модуль аутентификации"  →  код + тесты
Сессия 2:  "Добавь OAuth"                  →  ??? (ничего не знает о модуле)
```

Пользователь объясняет проект заново. Каждая сессия — с нуля.

### С памятью (целевое состояние)

```
Сессия 1:  "Напиши модуль аутентификации"
           → код + тесты
           → 📝 записал в память: архитектуру, решения, паттерны

Сессия 2:  "Добавь OAuth"
           → 📖 загрузил из памяти: архитектуру auth-модуля, конвенции
           → знает КУДА добавить OAuth, не спрашивая пользователя
```

**WOW-момент:** Пользователь открывает новую сессию — SOBA уже знает проект.

---

## 2. Архитектура: Layered Project Memory

Три слоя разной детализации и разного назначения:

```
<project-root>/.soba/
├── config.json                        ← проектная конфигурация
├── skills/                            ← проектные skills
│
├── 📁 memory/                         ← PROJECT MEMORY (project-level)
│   ├── 📄 knowledge/                   #   LAYER 1: Всегда загружается
│   │   ├── architecture.md             #     ADR: ключевые архитектурные решения
│   │   ├── conventions.md              #     Стиль кода, нейминг, паттерны
│   │   ├── known-errors.md             #     Повторяющиеся ошибки и решения
│   │   └── dependencies.md             #     Критические зависимости, версии, ограничения
│   │
│   ├── 📦 capsules/                    #   LAYER 2: Загружается по релевантности
│   │   ├── cap-001.json                #     Капсула: решение/ошибка/открытие/паттерн
│   │   ├── cap-002.json
│   │   └── …
│   │
│   ├── 🕸️  graph.json                   #   LAYER 3: Запрашивается по необходимости
│   └── 📋 index.json                    #   Индекс всех капсул
│
└── …
```

**Почему в project root (`.soba/memory/`), а не в `~/.soba/`:**
- Память — знание о **проекте**, а не о пользователе
- Git-tracked: можно закоммитить и шарить на команду
- `.soba/skills` уже в project root — `.soba/memory` естественное расширение
- Пользователь может просматривать и редактировать `.soba/memory/knowledge/*.md` руками
- Отделение concern: сессии → user-level (`~/.soba/sessions/`), память → project-level (`./.soba/memory/`)

### Layer 1: Knowledge Files (always-loaded)

Человеко-читаемые Markdown-файлы. **Всегда** инжектятся в system prompt при старте сессии.

Общий объём: ~2-5K токенов (архитектура 1K, конвенции 1K, ошибки 1K, зависимости 500).

```markdown
# architecture.md

## Decision: JWT-based auth with refresh tokens
- Date: 2026-06-10
- Status: Accepted
- Context: Need stateless auth for horizontal scaling
- Decision: JWT access (15min) + refresh token rotation (7d)
- Consequences: No session store needed, but token revocation is complex

## Decision: PostgreSQL as primary DB
- Date: 2026-06-08
- Status: Accepted
- ...
```

### Layer 2: Memory Capsules (relevance-loaded)

Структурированные JSON-капсулы. При старте сессии загружаются **N самых релевантных** (по recency + приоритету + контексту задачи).

```typescript
interface MemoryCapsule {
  id: string;                    // "cap-001"
  type: CapsuleType;             // тип капсулы
  summary: string;               // краткое описание (1 предложение)
  detail: string;                // полное описание
  context: {                     // контекст создания
    task: string;                //   какая задача решалась
    sessionId: string;           //   ID сессии
    timestamp: string;           //   когда создана
  };
  priority: "critical" | "high" | "medium" | "low";
  tags: string[];                // ["auth", "jwt", "security"]
  related: string[];             // связанные капсулы
  source?: {                     // источник (если из известной ошибки)
    error: string;
    fix: string;
    file?: string;
  };
}

type CapsuleType =
  | "decision"       // архитектурное решение
  | "error_fix"      // ошибка и её исправление
  | "discovery"      // открытие о кодовой базе
  | "pattern"        // повторяющийся паттерн
  | "blocker"        // блокер и как его обошли
  | "insight";       // инсайт о проекте
```

### Layer 3: Entity Graph (queryable)

Граф сущностей проекта. НЕ загружается в контекст автоматически — запрашивается агентом через tool или используется для семантического поиска.

```typescript
interface EntityGraph {
  nodes: EntityNode[];
  edges: EntityEdge[];
}

interface EntityNode {
  id: string;                    // "file:src/auth/service.ts"
  type: "file" | "function" | "class" | "module" | "error" | "dependency";
  name: string;
  metadata: {
    path?: string;               // путь к файлу
    lineCount?: number;
    exports?: string[];
    description?: string;        // AI-generated описание
  };
}

interface EntityEdge {
  from: string;                  // node id
  to: string;                    // node id
  type: "depends_on" | "contains" | "fixes" | "related_to" | "imports";
  weight?: number;               // сила связи
}
```

---

## 3. Жизненный цикл памяти

```
┌──────────────────────────────────────────────────────────────┐
│                    SESSION LIFECYCLE                          │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  STARTUP                                                      │
│  ├── 1. ProjectMemory.load()                                  │
│  │   ├── Load knowledge/*.md (Layer 1) → inject to prompt     │
│  │   ├── Load index.json                                      │
│  │   ├── Select top-N capsules (Layer 2) → inject to prompt   │
│  │   └── Load graph.json (Layer 3) → available as tool        │
│  │                                                            │
│  DURING SESSION                                               │
│  ├── 2. Agent tools read/write memory                         │
│  │   ├── read_memory(tags?) → relevant capsules               │
│  │   └── write_memory(capsule) → create/update capsule        │
│  │                                                            │
│  ├── 3. Auto-capture from agent actions                       │
│  │   ├── After Fix-Until-Green success → record error_fix     │
│  │   ├── On major code change → record discovery              │
│  │   └── On architecture discussion → record decision         │
│  │                                                            │
│  SHUTDOWN / COMPACTION                                        │
│  ├── 4. ProjectMemory.save()                                  │
│  │   ├── Save knowledge/*.md updates                          │
│  │   ├── Save new capsules                                    │
│  │   ├── Update index.json                                    │
│  │   ├── Update graph.json                                    │
│  │   └── Prune old/low-priority capsules (keep ~50 max)      │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Интеграция с существующим ядром

### 4.1 System Prompt Injection

```typescript
// src/core/prompt/system-prompt.ts (новая секция)

function buildProjectMemorySection(memory: ProjectMemory): string {
  const parts: string[] = [];

  // Layer 1: Always loaded
  for (const [name, content] of memory.getKnowledgeFiles()) {
    parts.push(`<project_knowledge name="${name}">\n${content}\n</project_knowledge>`);
  }

  // Layer 2: Relevant capsules
  const capsules = memory.getRelevantCapsules(5);
  if (capsules.length > 0) {
    parts.push("<project_memory>");
    for (const cap of capsules) {
      parts.push(`<capsule type="${cap.type}" priority="${cap.priority}">`);
      parts.push(`  ${cap.summary}`);
      parts.push(`  Context: ${cap.context.task} (${cap.context.timestamp})`);
      if (cap.source) {
        parts.push(`  Fix: ${cap.source.fix}`);
      }
      parts.push(`</capsule>`);
    }
    parts.push("</project_memory>");
  }

  return parts.join("\n");
}
```

### 4.2 Интеграция с SessionManager

```typescript
// При создании сессии — загружаем память из .soba/memory/
class SessionManager {
  private projectMemory: ProjectMemory;

  constructor(cwd: string) {
    const sobaDir = join(cwd, ".soba");
    this.projectMemory = new ProjectMemory(join(sobaDir, "memory"));
  }

  async init(): Promise<void> {
    await this.projectMemory.load();
    // ... create session, build system prompt with memory
  }

  async close(): Promise<void> {
    await this.projectMemory.save();
    // ... close session
  }
}
```

### 4.3 Интеграция с Compaction

При компакции — создаём memory capsule из compacted content:

```typescript
// После compaction — extract knowledge
async function afterCompaction(compactionResult: CompactionResult): Promise<void> {
  const capsule = await this.extractDecisionsFromCompaction(compactionResult);
  if (capsule) {
    this.projectMemory.addCapsule(capsule);
  }
}
```

### 4.4 Интеграция с Fix-Until-Green

После успешного fix → запись в known-errors:

```typescript
async function onFixSuccess(error: DiagnosticError, fix: string): Promise<void> {
  this.projectMemory.addCapsule({
    type: "error_fix",
    summary: `Fixed: ${error.message}`,
    detail: fix,
    source: { error: error.message, fix, file: error.file },
    priority: error.recurring ? "critical" : "medium",
    tags: error.tags,
  });
}
```

---

## 5. Tool API для агента

Агент получает два новых инструмента для работы с памятью:

### `read_project_memory`

```
Parameters:
  - query: string (optional) — поисковый запрос по тегам/тексту
  - type: CapsuleType (optional) — фильтр по типу
  - limit: number (default 5) — максимум капсул

Returns:
  - capsules: MemoryCapsule[]
  - knowledgeFiles: { name: string, content: string }[]
```

### `write_project_memory`

```
Parameters:
  - type: CapsuleType (required)
  - summary: string (required)
  - detail: string (required)
  - priority: "critical"|"high"|"medium"|"low" (default "medium")
  - tags: string[] (optional)

Returns:
  - capsuleId: string
```

Агент САМ решает, когда писать в память. Системный промпт инструктирует:
> "After completing a significant task, recording an architectural decision, or fixing a non-trivial error, use write_project_memory to preserve knowledge for future sessions."

---

## 6. Файловая структура кода

```
src/core/memory/
├── project-memory.ts        # ProjectMemory — главный класс
├── knowledge-store.ts       # Layer 1: чтение/запись knowledge/*.md
├── capsule-store.ts         # Layer 2: чтение/запись capsules/*.json + index.json
├── entity-graph.ts          # Layer 3: граф сущностей
├── memory-injector.ts       # Формирование секции промпта из памяти
├── memory-tools.ts          # read_project_memory / write_project_memory tools
├── extractor.ts             # Авто-извлечение капсул из agent actions
└── types.ts                 # Все типы
```

---

## 7. Капсулы: политика хранения

```
Максимум капсул: 50 (configurable)
Приоритеты при pruning:
  1. critical — never prune
  2. high — keep last 20
  3. medium — keep last 15
  4. low — keep last 10
  5. Старее 30 дней — prune (кроме critical)

При загрузке в контекст:
  - critical: всегда (до 3)
  - high: до 5 самых свежих
  - medium/low: до 3 дополнительных по релевантности тегам
  - Всего в контексте: до 10 капсул (≈ 500-1000 токенов)
```

---

## 8. Сценарий: полный пользовательский опыт

### День 1: Создание auth-модуля

```
User:  "Напиши модуль аутентификации с JWT"

SOBA:  [пишет src/auth/service.ts, src/auth/middleware.ts, тесты]
       [Fix-Until-Green: тесты упали → чинит → зелёный ✅]
       
       → write_project_memory(type="decision", 
           summary="JWT-based auth with refresh token rotation",
           detail="Access tokens: 15min, Refresh: 7d rotation. 
                   No session store. Tokens in HttpOnly cookies.",
           tags=["auth", "jwt", "architecture"])
       
       → write_project_memory(type="pattern",
           summary="Auth middleware pattern: verifyJWT → extract user → req.user",
           detail="All protected routes use authMiddleware. User object 
                   attached to request via res.locals.user.",
           tags=["auth", "middleware", "pattern"])
       
       → write_project_memory(type="error_fix",
           summary="TypeError: jwt.verify expects string, got Buffer",
           detail="Fixed by adding .toString() to token from cookie. 
                   jwt.verify(token.toString(), secret).",
           tags=["auth", "bug", "typescript"])

User:  "exit"
```

### День 2: Добавление OAuth

```
SOBA startup:
  → Loaded knowledge/architecture.md (has JWT decision)
  → Loaded 5 memory capsules (auth-related)
  
  <project_memory>
    <capsule type="decision" priority="high">
      JWT-based auth with refresh token rotation
      Context: Напиши модуль аутентификации с JWT (2026-06-14)
    </capsule>
    <capsule type="pattern" priority="medium">
      Auth middleware pattern: verifyJWT → extract user → req.user
      Context: Напиши модуль аутентификации с JWT (2026-06-14)
    </capsule>
    <capsule type="error_fix" priority="medium">
      TypeError: jwt.verify expects string, got Buffer
      Fix: token.toString()
    </capsule>
  </project_memory>

User:  "Добавь OAuth через Google"

SOBA:  [знает архитектуру auth-модуля из памяти]
       [знает middleware-паттерн]
       [знает о TypeError с jwt.verify и не повторяет]
       → создаёт src/auth/oauth.ts
       → добавляет Google strategy
       → пишет в память новый decision: "OAuth via Google added"
       
       🟢 Done. OAuth готов. Не спросил "а как у тебя auth устроен?"
```

**Время на задачу:** 5 минут вместо 20 (не надо объяснять архитектуру заново).

---

## 9. Интеграция в Phase 3 Plan

Добавляем **новую секцию задач в Phase 3** перед Fix-Until-Green:

```
Phase 3 (обновлённый)
├── 🔴 PROJECT MEMORY (4 задачи)       ← NEW: Киллер-фича
│   ├── 3.1  Knowledge Store           Layer 1: knowledge/*.md CRUD
│   ├── 3.2  Capsule Store             Layer 2: capsules + index + pruning
│   ├── 3.3  Entity Graph              Layer 3: граф сущностей
│   ├── 3.4  Memory Injector           System prompt integration
│   ├── 3.5  Memory Tools              read/write_project_memory
│   └── 3.6  Auto-Extractor           Авто-капсулы из agent actions
│
├── 🔴 FIX-UNTIL-GREEN (5 задач)
│   ├── 3.7  CommandDetector
│   ├── 3.8  Runner + Diagnostics
│   ├── 3.9  Auto-fix Loop
│   ├── 3.10 TUI Progress
│   └── 3.11 Agent Loop Integration
│
├── 🟡 TUI POLISH (8 задач)
│   └── ...
│
└── 🟡 CI/CD PIPELINE (2 задачи)
    └── ...
```

---

## 10. Реализация: что менять в ядре

### Новые файлы (создать)

```
src/core/memory/
├── project-memory.ts
├── knowledge-store.ts
├── capsule-store.ts
├── entity-graph.ts
├── memory-injector.ts
├── memory-tools.ts
├── extractor.ts
└── types.ts
```

### Изменяемые файлы

| Файл | Изменение |
|------|-----------|
| `src/core/session/session-manager.ts` | Инициализация ProjectMemory, вызов save() при закрытии |
| `src/core/prompt/system-prompt.ts` | Вызов memory-injector для добавления секции памяти |
| `src/core/compaction/compaction.ts` | Вызов extractor после компакции |
| `src/core/tools/registry.ts` | Регистрация read/write_project_memory tools |
| `src/cli.ts` | Инициализация ProjectMemory при старте |
| `src/core/session/types-v2.ts` | Новый тип MemoryCapsuleEntry для сессий |
| `SYSTEM.md` | Инструкция агенту использовать память |

### Новые тесты

```
tests/memory/
├── project-memory.test.ts
├── knowledge-store.test.ts
├── capsule-store.test.ts
├── entity-graph.test.ts
├── memory-injector.test.ts
├── memory-tools.test.ts
└── extractor.test.ts
```

---

## 11. Почему это киллер-фича

| Критерий | Оценка |
|----------|--------|
| **Видимость** | 🔥 WOW за 10 секунд: «он помнит мой проект!» |
| **Уникальность** | Ни у кого нет. Claude Code — нет, Codex — нет, OpenCode — нет |
| **Платформенность** | На памяти строятся: delegation, orchestration, background agents |
| **Retention** | Пользователь возвращается, потому что память накапливается |
| **Сложность воспроизведения** | Глубоко в ядре, требует перестройки архитектуры. Нельзя «добавить плагином» |

---

## 12. Риски

| Риск | Митигация |
|------|-----------|
| **Память раздувается** | Pruning: max 50 капсул, старые low-priority удаляются |
| **Контекст переполняется** | Layer 1 всегда загружается (2-5K токенов фикс.), Layer 2 лимитирован (10 капсул max) |
| **Устаревшая память** | Timestamp + tagging. Старые капсулы понижаются в приоритете |
| **Конфликтующие капсулы** | Агент видит все актуальные и сам разрешает конфликты |

---

## 13. Заключение

Project Memory — это не «ещё одна фича». Это **архитектурный фундамент**, на котором стоит вся платформа делегирования:

```
Project Memory
    ↓
Fix-Until-Green (использует память для умного фикса)
    ↓
Background Agents (используют память для автономной работы)
    ↓
Orchestration (использует память для координации агентов)
    ↓
Full Delegation (использует память для end-to-end задач)
```

**Без Project Memory делегирование невозможно.** Агент без памяти — каждый раз с нуля. Агент с памятью — твоя dev-команда, которая учится на опыте.

**Стартуем с Project Memory как первой задачей Phase 3.**
