# MCP (Model Context Protocol) — План реализации для SOBA Agent

**Дата:** 2026-06-17  
**Статус:** Design & Plan (v3 — учтено ревью v2 от 2026-06-17, dual-era: 2025-11-25 + draft 2026-07-28)  
**Целевая фаза:** Phase 4 (MCP-native tooling)  
**Целевые версии протокола:** 2025-11-25 (стабильная) + 2026-07-28 (draft, SEP-2577)

---

## 1. Что такое MCP и зачем он SOBA

### 1.1 Определение

**Model Context Protocol (MCP)** — открытый протокол от Anthropic, стандартизирующий способ
подключения AI-агентов к внешним инструментам и источникам данных. MCP заменяет хаотичный "каждый
провайдер делает свой plugin API" единым contract-ом.

Протокол определяет **клиент-серверную архитектуру**:

```
┌──────────────┐   JSON-RPC 2.0     ┌──────────────┐
│  MCP Client  │◄──────────────────►│  MCP Server   │
│  (SOBA)      │  over stdio/HTTP   │  (ext. tool)  │
└──────────────┘                    └──────────────┘
```

Серверы — отдельные процессы (подпроцессы SOBA или HTTP-эндпоинты), которые регистрируют свои
возможности (tools, resources, prompts) и выполняют вызовы от клиента.

### 1.2 Почему MCP важен для SOBA

| Без MCP | С MCP |
|---|---|
| Только встроенные инструменты (read/write/bash/edit) | Любые инструменты из MCP-экосистемы |
| Skills через Markdown/YAML внутри проекта | Skills могут подключаться как MCP-серверы |
| Нет доступа к внешним API (Jira, GitHub, Linear) | Прямое подключение к API через MCP-серверы |
| Нет стандартного Web Scraping, PDF-парсинга | Готовые MCP-серверы для Research |
| Каждый инструмент требует ручного кодинга | Zero-code подключение чужих серверов |

**Стратегическое значение** (из [docs/strategy.md](../strategy.md)):
- SOBA позиционируется как **MCP-native экосистема** — и клиент, и сервер
- Deep Research (Phase 4) базируется на MCP-серверах
- MCP — must-have для совместимости с экосистемой

---

## 2. Архитектурные решения

### 2.1 Position в архитектуре SOBA

MCP-клиент — **ещё один уровень абстракции над ToolRegistry**, а не замена ему:

```
                    ┌─────────────────────┐
                    │    AgentLoop        │
                    │  (tool execution)   │
                    └──────┬──────────────┘
                           │
                    ┌──────▼──────────────┐
                    │   ToolRegistry      │  ◄── единый реестр
                    │  ├─ built-in tools  │
                    │  ├─ skill tools     │
                    │  └─ MCP tools       │  ◄── прозрачно регистрируются
                    └──────┬──────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
    ┌─────────▼──┐  ┌─────▼──────┐  ┌──▼───────────┐
    │ Built-in   │  │ Skill      │  │ MCP Client    │
    │ (read,     │  │ Manager    │  │ Manager       │
    │  write...) │  │            │  │               │
    └────────────┘  └────────────┘  │ ┌───────────┐ │
                                    │ │ Server 1  │ │
                                    │ │ (stdio)   │ │
                                    │ ├───────────┤ │
                                    │ │ Server 2  │ │
                                    │ │ (HTTP)    │ │
                                    │ └───────────┘ │
                                    └───────────────┘
```

**Принцип**: MCP-тулы выглядят **абсолютно так же**, как встроенные тулы — модель вызывает их
теми же function_call и получает function_call_output.

### 2.2 Именование MCP-тулов

Каждый MCP-тул получает префикс `mcp.<server-name>.`:

```
Встроенный тул:     read, write, bash, edit
MCP-тул:            mcp.github.search_issues, mcp.jira.get_issue
```

Это:
- Гарантирует отсутствие коллизий
- Делает происхождение тула очевидным в логах
- Позволяет модели понимать, какой сервер обслуживает вызов

**Альтернатива (не выбрана)**: `/`-разделитель (`mcp/github/search_issues`) — конфликтует
с файловыми путями и bash-синтаксисом в промптах.

### 2.3 Транспорты

**Фаза 1: stdio (подпроцесс)**

Самый простой и надёжный транспорт. SOBA spawn'ит MCP-сервер как дочерний процесс:

```
  SOBA (Client)             MCP Server (Child Process)
       │                             │
       ├────spawn("npx", [...])─────►│
       │                             │
       ├──► initialize ─────────────►│
       │◄── capabilities ◄───────────┤
       │                             │
       ├──► tools/list ─────────────►│
       │◄── tool definitions ◄───────┤
       │                             │
       ├──► tools/call ─────────────►│
       │◄── tool result ◄────────────┤
       │                             │
       ├──► terminate ──────────────►│
       │◄── SIGTERM / stdin close ◄──┤
```

**Фаза 2: Streamable HTTP (отложено)**

Для удалённых MCP-серверов или serverless-окружений. Менее приоритетно,
так как большинство рабочих сценариев — локальные тулы.

### 2.4 Жизненный цикл серверов

```
  ┌─────────┐
  │ CONFIG  │  Пользователь добавляет сервер в ~/.soba/config.json
  └────┬────┘
       │
  ┌────▼────┐
  │ STORED  │  Сервер сохранён в конфиге, но не запущен
  └────┬────┘
       │  soba start → pre-fetch tools/list (из кэша или пропускается)
  ┌────▼────┐
  │ STARTING│  spawn процесса: для modern (2026-07-28) — сразу
  │         │  tools/call через server/discover; для legacy
  │         │  (2025-11-25) — initialize handshake
  └────┬────┘
       │
  ┌────▼────┐
  │ ACTIVE  │  Сервер запущен, tools/list загружен, готов к вызовам
  └────┬────┘
       │  crash / таймаут / ошибка
  ┌────▼────┐
  │ RETRYING│  Попытка реконнекта (max 3 раза, экспоненциальная
  │         │  задержка: 1s, 2s, 4s). Для stateless modern —
  │         │  реконнект тривиален (нет сессионного состояния)
  └────┬────┘
       │  soba stop / удаление сервера из конфига
  ┌────▼────┐
  │ STOPPED │  1. Close stdin (primary signal)
  │         │  2. Wait 5s for process exit
  │         │  3. SIGTERM (if still alive)
  │         │  4. SIGKILL after 5s timeout
  └─────────┘
```

**Два независимых параметра инициализации:**

- **`enabled: boolean`** — сервер вообще доступен для использования. Если `false`:
  сервер не отображается, тулы не регистрируются.
- **Инициализация всегда ленивая**: spawn происходит при **первом вызове** MCP-тула
  от этого сервера (первый turn, где модель вызывает тул), а не при старте SOBA.
  Это экономит ресурсы и ускоряет старт.

**Cold start — важная проблема** (см. §2.6). Первый вызов после lazy init может занять
5–10 секунд (spawn + initialize + tools/list + сам вызов). Модель не знает об этой
задержке и может интерпретировать её как поломку тула. Mitigation описан ниже.

### 2.5 Обработка ошибок и реконнект

| Событие | Поведение |
|---|---|
| Сервер не запускается (spawn fail) | Инструменты этого сервера **исключаются** из tools/list, отправляемого в API. Модель не видит недоступные тулы |
| Сервер упал во время tools/call | Реконнект (max 3 попытки), повтор вызова. Если не удалось — tool error |
| Сервер упал, реконнект невозможен | Все тулы сервера **убираются** из ToolRegistry. Модель уведомляется в следующем turn через системное сообщение. Все pending-вызовы получают error |
| Сервер стал недоступен **посередине сессии** | Активные тулы немедленно возвращают ошибку. Будущие turns не видят эти тулы в tools/list. При следующем turn — повторная попытка pre-fetch (если сервер восстановился — тулы возвращаются) |
| Таймаут tools/call (настраиваемый per-server) | Abort вызова, tool error, модель может повторить |
| Protocol violation | Сервер помечается broken, требует ручного перезапуска (`/mcp restart`) |

### 2.6 Cold start: первый вызов MCP-тула

Первый `tools/call` после lazy init может занять 5–10 секунд. Mitigation:

1. **Pre-fetch tools/list при старте SOBA** (лёгкая операция без spawn — из кэша
   предыдущей сессии). Модель видит сигнатуры тулов с самого начала, даже если сервер
   ещё не запущен
2. **Промежуточный статус `"initializing"`**: когда модель вызывает тул впервые,
   SOBA spawn'ит сервер и возвращает `{ status: "initializing", message: "Starting
   MCP server, please wait..." }`. Модель понимает, что тул не сломан, а запускается
3. **Таймаут initialization**: 30 секунд на spawn + initialize. При превышении —
   tool error, сервер помечается broken

### 2.7 Управление конкурентностью

MCP использует JSON-RPC 2.0 над одним stdio-потоком. Параллельные вызовы к одному
серверу возможны (разные `id` в JSON-RPC), но требуют контроля:

- **`JsonRpcParser`** отслеживает pending-запросы по `id`, матчит ответы асинхронно
- **Транспортный семафор**: не более `maxConcurrentCalls` одновременных запросов к одному
  серверу (по умолчанию — 5). При превышении — запросы в очередь
- **Защита от race condition**: во время реконнекта все новые вызовы отклоняются с
  ошибкой `"server reconnecting"`, активные — ждут завершения реконнекта (до таймаута)
- **Межсерверная параллельность**: вызовы к разным серверам не блокируют друг друга —
  каждый сервер имеет независимый транспорт и семафор

---

## 3. MCP-протокол: что нужно реализовать

### 3.1 Базовый протокол и Dual-Era Architecture

MCP использует **JSON-RPC 2.0** over stdio (JSON-сообщения, разделённые `\n`).

**Ключевое архитектурное решение: dual-era support.** SOBA поддерживает две эры протокола:

| Эра | Версия | Handshake | Состояние | Метаданные |
|---|---|---|---|---|
| **Legacy** | 2025-11-25 (стабильная) | `initialize` → `initialized` | Stateful (сессия) | В `initialize.params` |
| **Modern** | 2026-07-28 (draft, SEP-2577) | `server/discover` (stateless discovery) | Stateless | Per-request `_meta` |

**Как SOBA определяет эру сервера:**
1. Пробует `server/discover` → если отвечает — modern server
2. Если `server/discover` возвращает `MethodNotFound` (-32601) — legacy server, используем `initialize`
3. Клиент кэширует обнаруженную эру на время жизни подключения

**Формат сообщений (общий для обеих эр):**

```typescript
// Запрос (Request)
interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

// Ответ (Response)
interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Нотификация (Notification — без id, без ответа)
interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}
```

### 3.2 Методы, которые реализует SOBA (клиент → сервер)

#### server/discover (modern — 2026-07-28 draft)

**Это основной метод для modern servers.** Заменяет `initialize` handshake.

```json
// Request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "server/discover",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "soba-agent",
        "version": "0.4.0"
      },
      "io.modelcontextprotocol/capabilities": {
        "tools": {}
      }
    }
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "supportedVersions": ["2026-07-28", "2025-11-25"],
    "capabilities": {
      "tools": { "listChanged": true }
    },
    "serverInfo": {
      "name": "github-mcp-server",
      "version": "1.0.0"
    }
  }
}
```

**Преимущества `server/discover`:**
- Сервер остаётся **stateless** — нет сессионного состояния
- Каждый запрос самодостаточен (carries own metadata в `_meta`)
- Упрощается реконнект (не нужно восстанавливать сессию)
- Убирает состояние `initializing` из state machine (для modern servers)

#### Per-request `_meta` (modern)

В modern-эре **каждый запрос** несёт метаданные в `params._meta`:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "search_issues",
    "arguments": { "query": "bug" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/progressToken": "mcp_github_progress_42"
    }
  }
}
```

#### initialize (legacy — 2025-11-25, только для обратной совместимости)

**Важно:** `initialize` + `initialized` notification — **legacy-механизм**. Используется только если `server/discover` вернул `MethodNotFound`. Modern servers 2026-07-28 **не требуют** handshake.

```json
// Request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {}
    },
    "clientInfo": {
      "name": "soba-agent",
      "version": "0.4.0"
    }
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "serverInfo": {
      "name": "github-mcp-server",
      "version": "1.0.0"
    },
    "capabilities": {
      "tools": { "listChanged": true },
      "resources": {},
      "prompts": {}
    }
  }
}
```

#### tools/list (с поддержкой пагинации)

Клиент автоматически проходит все страницы до получения полного списка тулов.

```json
// Request (первая страница)
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}

// Response (с пагинацией, если тулов > страницы)
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "search_issues",
        "description": "Search GitHub issues",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": { "type": "string", "description": "Search query" },
            "repo": { "type": "string", "description": "Repository name" }
          },
          "required": ["query"]
        }
      }
    ],
    "nextCursor": "cursor-page-2"
  }
}

// Request (вторая страница)
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": { "cursor": "cursor-page-2" }
}
```
Автополлинг: клиент продолжает запрашивать страницы пока `nextCursor` не null.

#### tools/call

```json
// Request
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "search_issues",
    "arguments": {
      "query": "bug: auth failure",
      "repo": "my-org/my-repo"
    }
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      { "type": "text", "text": "Found 3 issues:\n1. #42 - ..." }
    ],
    "isError": false
  }
}
```

#### notifications/cancelled (cancellation support)

SOBA отправляет `notifications/cancelled` при прерывании пользователем (Ctrl+C) или таймауте:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/cancelled",
  "params": {
    "requestId": 3,
    "reason": "User cancelled via Ctrl+C"
  }
}
```

**Интеграция:** AbortSignal из tool execution context автоматически триггерит cancellation. Сервер получает нотификацию и освобождает ресурсы.

#### notifications/progress (progress tracking)

Сервер может отправлять прогресс во время долгих операций:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": {
    "progressToken": "mcp_github_progress_42",
    "progress": 45,
    "total": 100,
    "message": "Processing 45/100 issues..."
  }
}
```

**Интеграция:** SOBA отображает прогресс в TUI и логирует. Модель видит, что тул не завис, а работает.

#### tools/listChanged (нотификация от сервера)

```json
// Notification (server → client)

{
  "jsonrpc": "2.0",
  "method": "notifications/tools/list_changed"
}
```

При получении SOBA перезапрашивает `tools/list` и обновляет ToolRegistry.

#### Методы resources и prompts (Фаза 2)

- `resources/list` — список доступных ресурсов (файлы, БД, API)
- `resources/read` — чтение ресурса по URI
- `prompts/list` — список шаблонных промптов
- `prompts/get` — получение конкретного промпта

### 3.3 Что НЕ нужно реализовывать в Фазе 1

- ❌ **Resources** — отложено до Phase 2
- ❌ **Prompts** — отложено до Phase 2
- ❌ **HTTP Transport** — только stdio
- ❌ **OAuth / сложная аутентификация** — только env-переменные
- ❌ **Server-Sent Events** — только request/response
- ❌ **Sampling** (`sampling/createMessage`) — сервер не может запрашивать LLM-генерацию
- ❌ **Elicitation** — сервер не может запрашивать ввод у пользователя
- ❌ **Task-augmented execution** (долгие операции через polling) — все вызовы синхронные
- ❌ **InputRequiredResult (multi-round-trip requests)** — сервер не может запрашивать дополнительный ввод
- ❌ **ToolExecution.taskSupport** — все тулы считаются синхронными; поддержка `"required"` в Фазе 2
- ❌ **Multi-modal tool results** (image/audio в ответе модели) — только text + заглушки

### 3.4 Совместимость с MCP-спецификацией и Version Negotiation

**Целевые версии протокола:**
- **2026-07-28** (draft, SEP-2577) — приоритетная, modern era
- **2025-11-25** (стабильная) — legacy era, обратная совместимость

**Dual-era version negotiation** (SOBA пробует версии по приоритету):

```typescript
// Стратегия согласования версий (в client.ts)
async connect(): Promise<void> {
  const preferredVersions = ["2026-07-28", "2025-11-25"];

  for (const version of preferredVersions) {
    try {
      const result = await this.transport.request({
        method: "server/discover",
        params: {
          _meta: { "io.modelcontextprotocol/protocolVersion": version }
        }
      });
      // Modern server ответил — используем эту версию
      this.protocolVersion = version;
      this.era = "modern";
      return;
    } catch (error) {
      if (error.code === -32601) {  // MethodNotFound
        // server/discover не поддерживается — пробуем legacy initialize
        if (version === "2025-11-25") {
          await this.legacyInitialize(version);
          this.era = "legacy";
          return;
        }
      }
      if (error.code === -32004) {  // UnsupportedProtocolVersionError
        // Сервер поддерживает другую версию — берём из ответа
        const supported = error.data?.supported ?? [];
        const compatible = preferredVersions.find(v => supported.includes(v));
        if (compatible) {
          this.protocolVersion = compatible;
          return;
        }
      }
      // Продолжаем со следующей версией
    }
  }
  throw new Error("No compatible protocol version found");
}
```

**UnsupportedProtocolVersionError (-32004):**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32004,
    "message": "Unsupported protocol version",
    "data": {
      "supported": ["2026-07-28", "2025-11-25"],
      "requested": "2024-11-05"
    }
  }
}
```

**Per-request version** (modern era): каждый запрос несёт версию в `_meta`. Сервер может
отклонить запрос с `UnsupportedProtocolVersionError` — клиент ретраит с подходящей версией.

История версий в спецификации:
- `2024-11-05` — первая стабильная (не поддерживается SOBA)
- `2025-03-26` — уточнения (не поддерживается SOBA)
- `2025-06-18` — content types, annotations (не поддерживается SOBA)
- `2025-11-25` — стабильная (structuredContent, ToolAnnotations, ToolExecution) — **legacy era**
- `2026-07-28` — draft (SEP-2577: stateless, server/discover, per-request _meta) — **modern era**

SOBA реализует **клиентскую сторону** протокола. Серверная сторона (SOBA как MCP-сервер) —
вне скоупа этого плана.

### 3.5 Поддержка content types в результатах

Спецификация 2025-11-25 определяет `ContentBlock` как:

```typescript
type ContentBlock = TextContent | ImageContent | AudioContent | ResourceLink | EmbeddedResource;
```

**Решение для Фазы 1:**
- **`text`** — основная поддержка, полный текст результата
- **`image`** (base64) — сохраняется в сессии как ссылка (не отправляется модели, но
  доступно пользователю через TUI). В tool result подставляется `"[Image: <mimeType>, <size> bytes]"`
- **`audio`** (base64) — аналогично image: ссылка в сессии, заглушка в tool result
- **`resource`** (link / embedded) — если `ResourceLink`: подставляется URI. Если
  `EmbeddedResource`: извлекается text content, blob — заглушка

**Причина**: большинство LLM-провайдеров не поддерживают мультимодальные tool results.
Полноценная поддержка image/audio в tool results — в Фазе 2.

### 3.6 Structured content

`CallToolResult` теперь включает необязательное поле:

```typescript
structuredContent?: { [key: string]: unknown };
```

А `Tool` — поле `outputSchema` (JSON Schema для structuredContent).

**Решение**: structuredContent **поддерживается** в Фазе 1 как JSON-строка в tool result.
Если сервер возвращает и `content`, и `structuredContent` — оба включаются в ответ
(сначала text-содержимое, затем "\n---\nStructured result:\n<JSON>"). Это улучшает
качество для модели (структурированные данные).

### 3.7 Tool Annotations (UI hints, NOT trust decisions)

Спецификация 2025-11-25 определяет `ToolAnnotations`:

```typescript
interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}
```

**⚠️ Критическое предупреждение из спецификации:**

> **NOTE:** all properties in `ToolAnnotations` are **hints**. They are not guaranteed to provide
> a faithful description of tool behavior.
>
> **Clients should never make tool use decisions based on ToolAnnotations received from untrusted servers.**

**Использование в SOBA (только для UI, не для trust decisions):**
- `annotations.title` → human-readable имя тула в TUI
- `destructiveHint: true` → отображение иконки ⚠️ в TUI (предупреждение, НЕ авто-prompt)
- `readOnlyHint: true` → отображение иконки 📖 в TUI
- Аннотации **не влияют** на trust level — trust всегда берётся из конфига пользователя
- Аннотации **не влияют** на то, будет ли тул показан модели — всегда показываем,
  но trust-уровень из конфига может требовать подтверждения пользователя

**Почему это важно:** злонамеренный MCP-сервер может указать `destructiveHint: false`
для деструктивной операции. Если SOBA полагается на аннотации для trust-решений,
пользователь может потерять данные без предупреждения.

---

## 4. Интеграция с архитектурой SOBA

### 4.1 Новые модули

```
src/core/mcp/                          # Новый модуль MCP
├── types.ts                           # Типы: JSON-RPC, server config, tool proxy
├── json-rpc.ts                        # JSON-RPC 2.0 парсер/сериализатор
├── transport.ts                       # Транспорт (stdio spawn+readline)
├── client.ts                          # MCP Client (один инстанс на сервер)
├── client-manager.ts                  # MCP Client Manager (все серверы)
├── tool-proxy.ts                      # ToolDefinition-обёртка для MCP-тулов
└── config.ts                          # Парсинг MCP-конфига
```

### 4.2 Изменения в существующих модулях

| Модуль | Изменение |
|---|---|
| `src/cli.ts` | Инициализация McpClientManager, запуск при старте, остановка при выходе |
| `src/core/tools/tool-registry.ts` | Метод `registerMcpTools()` — регистрирует прокси-тулы |
| `src/core/config/types.ts` | Поле `mcp` в `SobaConfig` |
| `src/core/loop/agent-loop.ts` | Поддержка `mcp.*` namespace в trust-чеке |
| `src/core/trust/trust-manager.ts` | Правила для MCP-тулов (все `mcp.*` → `normal` по умолчанию) |
| `src/widgets/tui/` | Отображение MCP-статуса в подвале/сайдбаре |
| `src/cli/commands.ts` | Slash-команда `/mcp` для управления серверами |

### 4.3 Формат конфигурации (config.json)

```json
{
  "mcp": {
    "configVersion": 1,
    "servers": {
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {
          "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
        },
        "enabled": true,
        "timeout": 60000,
        "trust": "normal",
        "maxOutputSize": 51200
      },
      "playwright": {
        "command": "npx",
        "args": ["-y", "@playwright/mcp"],
        "enabled": false
      },
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-server-filesystem", "/home/user/projects"],
        "cwd": "/home/user/projects",
        "enabled": true,
        "trust": "dangerous",
        "trustReason": "Имеет доступ к файловой системе — операции записи/удаления",
        "compactResult": true
      }
    }
  }
}
```

**Поля конфигурации:**

| Поле | Тип | По умолчанию | Описание |
|---|---|---|---|
| `servers` | Record<string, McpServerConfig> | — | Словарь серверов, ключ = server name |
| `configVersion` | number | 1 | Версия формата конфига (для будущих миграций) |
| `command` | string | — | Исполняемый файл или команда |
| `args` | string[] | — | Аргументы командной строки |
| `env` | Record<string, string> | — | Переменные окружения. `${VAR}` подставляется из process.env |
| `enabled` | boolean | `true` | Сервер доступен для использования (если `false` — тулы не регистрируются) |
| `timeout` | number | `60000` | Таймаут одного tools/call в мс |
| `trust` | `"safe" \| "normal" \| "dangerous"` | `"normal"` | Уровень доверия к серверу |
| `trustReason` | string | — | Пояснение, почему задан уровень доверия |
| `maxOutputSize` | number | `51200` | Максимальный размер результата в байтах (обрезается) |
| `cwd` | string | `process.cwd()` | Рабочая директория для spawn (изоляция для опасных серверов) |
| `protocolVersion` | string | `"2025-11-25"` | Версия MCP-протокола для этого сервера |
| `compactResult` | boolean | `false` | Агрессивно сжимать результат в истории сессии (только summary) |
| `maxConcurrentCalls` | number | `5` | Максимум одновременных вызовов к этому серверу |
| `logStderr` | boolean | `true` | Логировать stderr сервера (уровень debug). Выключить если stderr шумный |

**Валидация env-подстановки:**
- Имена переменных в конфиге проверяются: только `[A-Z_][A-Z0-9_]*`
- При старте SOBA логируются имена подставленных переменных (без значений)
- Неизвестные переменные (не в process.env) — warning, но не ошибка

**TypeScript-тип:**

```typescript
interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  timeout?: number;
  trust?: "safe" | "normal" | "dangerous";
  trustReason?: string;
  maxOutputSize?: number;
  cwd?: string;
  protocolVersion?: string;
  compactResult?: boolean;
  maxConcurrentCalls?: number;
  logStderr?: boolean;
}

interface McpConfig {
  configVersion: number;
  servers: Record<string, McpServerConfig>;
}
```

### 4.4 Интеграция с Trust Manager

MCP-тулы поддерживают per-server trust level в конфиге (`trust` поле, см. §4.3).

**Правила по умолчанию:**

| Trust level | Поведение | Источник |
|---|---|---|
| `safe` | Выполняется без подтверждения всегда | Явно задано в конфиге |
| `normal` | Без подтверждения (дефолт) | Дефолт для всех MCP-серверов |
| `dangerous` | Требуется подтверждение пользователя перед каждым вызовом | Явно задано в конфиге |

**Trust decisions — только из конфига:**
MCP-тулы **никогда не используют ToolAnnotations для trust-решений** (см. §3.7).
Trust level всегда берётся из поля `trust` в конфиге сервера. По умолчанию — `"normal"`.

**Предупреждение при первом использовании:**
При первом вызове MCP-тула в сессии SOBA выводит однократный warning:
```
⚠ First use of MCP server "<name>": <N> tools registered
   Trust level: <level> (<reason>)
   Type /mcp status to review
```

Это защищает от copy-paste конфигов из интернета без понимания последствий.

### 4.5 Интеграция с Compaction

MCP-тулы могут возвращать большие результаты — это ускоряет заполнение контекста и
форсирует compaction. Mitigation:

- **Per-server `maxOutputSize`**: результат обрезается до лимита (по умолчанию 50KB)
- **`compactResult: true`**: результат заменяется на краткий summary в истории сессии
  (например, `"[MCP github/search_issues returned 3 issues (1.2KB)]"`)
- **Жирные результаты (≈50KB)** маркируются `size: "large"` в метаданных tool result —
  compaction engine может агрессивнее их сжимать

### 4.6 Progress Notifications (UX для долгих операций)

MCP-сервер может отправлять `notifications/progress` во время выполнения долгих операций.
SOBA интегрирует прогресс в TUI и логи:

```typescript
// В client.ts
this.transport.on("notification", (notification) => {
  if (notification.method === "notifications/progress") {
    const { progressToken, progress, total, message } = notification.params;
    this.emit("progress", { progressToken, progress, total, message });
    // Отображается в TUI (progress bar) и логируется
  }
});

// В tool-proxy.ts — проброс progress token
async execute(args, context, signal) {
  const progressToken = `mcp_${serverName}_${tool.name}_${Date.now()}`;

  client.on("progress", (event) => {
    if (event.progressToken === progressToken) {
      context.reportProgress(event.progress, event.total, event.message);
    }
  });

  return client.callTool(tool.name, { ...args, _meta: { progressToken } }, signal);
}
```

**Зачем это нужно:**
- Модель не думает, что тул завис (cold start / long-running mitigation)
- Пользователь видит прогресс в TUI
- Улучшает UX для операций с большими данными (100+ issues, миграции, деплои)

### 4.7 Observability и отладка

Для отладки MCP-интеграции:

- **JSON-RPC логирование** (debug level): все сообщения пишутся в debug-лог сессии.
  В production — опционально через `SOBA_LOG_LEVEL=debug`
- **Per-tool latency**: метрика `mcp_latency_ms{server,tool}` записывается в лог
- **Счётчик реконнектов**: `mcp_reconnects_total{server}` — для мониторинга
  стабильности серверов
- **Статус в TUI** (см. §5, Задача 7): индикатор состояния серверов в реальном времени

### 4.8 Интеграция с сессиями (JSONL)

MCP-тул-коллы сохраняются как обычные `function_call` / `function_call_output` items в
JSONL-сессии. Никаких специальных типов не требуется — это главное преимущество подхода
с единым ToolRegistry.

```jsonl
{"type":"message","role":"user","content":[...]}
{"type":"message","role":"assistant","content":[...]}
{"type":"function_call","call_id":"mcp_github_42","name":"mcp.github.search_issues","arguments":"{...}","status":"completed"}
{"type":"function_call_output","call_id":"mcp_github_42","output":"Found 3 issues..."}
```

### 4.9 Интеграция с Budget Tracker

MCP-тулы **не потребляют токены** (как и другие инструменты), но:

1. **Таймаут** — тул может висеть не более `timeout` мс (per-server конфиг)
2. **Размер результата** — обрезается до `maxOutputSize` байт (per-server конфиг, дефолт 50KB)
3. **Loop guard** — MCP-тулы считаются в лимит stalled-итераций
4. **Cancellation при таймауте** — при превышении timeout отправляется `notifications/cancelled`,
   сервер освобождает ресурсы, пользователь получает tool error

---

## 5. Детальный план реализации

### Этап 1: Ядро MCP-клиента (задачи 1a-3)

#### Задача 1a: Типы

**Файлы:**
- `src/core/mcp/types.ts` — все типы, чистая логика (без импорта runtime-модулей)

**Что делаем:**
1. TypeScript-типы для JSON-RPC 2.0: Request, Response, Notification, Error
2. Типы для MCP-протокола (dual-era: 2026-07-28 + 2025-11-25):
   - Modern: DiscoverRequest/Result, per-request `_meta` metadata
   - Legacy: InitializeRequest/Result, InitializedNotification
   - Tools: ListToolsRequest/Result (с пагинацией через `cursor`/`nextCursor`), CallToolRequest/Result, ToolListChangedNotification
   - Cancellation: CancelledNotification
   - Progress: ProgressNotification
   - Version negotiation: UnsupportedProtocolVersionError (-32004)
   - Tool definition: Tool (с annotations, execution, outputSchema — все поля)
   - Content: TextContent, ImageContent, AudioContent, ResourceLink, EmbeddedResource, ContentBlock
   - Structured content: structuredContent в CallToolResult
3. Внутренние типы SOBA: McpServerConfig, McpConfig, McpClientState (dual-era), ToolProxy
4. Тип `McpEra = "modern" | "legacy"` для отслеживания эры сервера

**Тесты:**
- TypeScript type tests (assert типов через `satisfies`)
- Проверка дискриминированных union'ов (ContentBlock, JSONRPC-сообщения)
- Валидация McpServerConfig (полный/минимальный/невалидный)

#### Задача 1b: JSON-RPC парсер/сериализатор

**Файлы:**
- `src/core/mcp/json-rpc.ts`

**Что делаем:**
1. `JsonRpcParser`:
   - Line-delimited JSON парсер для stdin/stdout
   - Сообщения разделены `\n` (MCP-спецификация)
   - Обработка incomplete lines (буферизация)
   - Обработка malformed JSON (skip + error event)
   - Отслеживание pending-запросов по `id` (для конкурентности)
2. `JsonRpcSerializer`:
   - Сериализация Request/Notification в JSON + `\n`
   - Валидация перед отправкой (проверка обязательных полей)
3. `sendCancellation(requestId, reason)` — отправка `notifications/cancelled`

**Тесты:**
- Unit: валидные сообщения
- Unit: невалидный JSON → error event
- Unit: incomplete lines (частичный JSON, дочитывание)
- Unit: multiple messages in one chunk
- Unit: binary data in stream → error event
- Unit: concurrent requests (разные id), проверка матчинга ответов
- Unit: отправка `notifications/cancelled` — формат, парсинг

#### Задача 1c: Stdio-транспорт

**Файлы:**
- `src/core/mcp/transport.ts`

**Что делаем:**
1. `StdioTransport`:
   - `spawn(command, args, opts)` — запуск подпроцесса (cwd, env, timeout)
   - `send(message)` — запись в stdin
   - `onMessage` — EventEmitter для входящих сообщений (использует JsonRpcParser)
   - `close()` — graceful shutdown: 1) close stdin, 2) wait 5s, 3) SIGTERM, 4) wait 5s, 5) SIGKILL
   - `isAlive` — проверка жив ли процесс (exitCode === null, сигналы)
2. `TransportSemaphore(maxConcurrent)` — ограничение конкурентности:
   - Очередь запросов при превышении `maxConcurrentCalls`
   - Промисы для асинхронного ожидания
3. Обработка stderr:
   - Перенаправляется в лог с префиксом `[mcp:<server>]`
   - Уровень логирования: `debug` (не `error` — согласно спецификации, stderr **не всегда** означает ошибку)
   - Опциональный флаг `logStderr: boolean` в конфиге сервера (дефолт: `true`)
   - Парсинг stderr для progress messages (опционально, если сервер пишет прогресс в stderr)

**Тесты:**
- Интеграционный тест с mock-процессом: spawn → send/recv → close
- Тест graceful shutdown: SIGTERM → процесс завершился
- Тест: процесс не отвечает → kill после таймаута
- Тест семафора: 10 параллельных запросов, maxConcurrent=3 → 3 выполняются, 7 ждут
- Тест: реконнект во время активного вызова → pending-запросы получают ошибку

#### Задача 2: MCP Client (один сервер)

**Файлы:**
- `src/core/mcp/client.ts`

**Что делаем:**
1. `McpClient` — инстанс одного подключения к серверу, dual-era aware:
   - `discover()` — отправляет `server/discover` (modern), если MethodNotFound → `legacyInitialize()`
   - `legacyInitialize()` — initialize handshake + initialized notification (legacy fallback)
   - `listTools()` — tools/list с автоматической пагинацией (поллинг `nextCursor`)
   - `callTool(name, args, signal)` — tools/call с поддержкой cancellation:
     - При abort сигнала — отправка `notifications/cancelled` серверу
     - В modern-эре: добавляет `_meta` с protocolVersion, progressToken
   - `disconnect()` — graceful shutdown (close stdin → SIGTERM → SIGKILL)
   - `healthCheck()` — ping-механизм:
     - Каждые 30 секунд — проверка process.exitCode и isAlive
     - Если процесс мёртв → авто-реконнект
     - Если 3 health check'а подряд провалены → `fatal-error`
     - Для stateless modern servers — реконнект тривиален (нет сессионного состояния)
2. Реконнект-логика:
   - До 3 попыток с экспоненциальной задержкой (1с, 2с, 4с)
   - Все новые вызовы во время реконнекта возвращают `{ status: "reconnecting" }`
   - При провале всех попыток — эмит события `fatal-error`, все тулы убираются из реестра
3. Таймаут на каждый вызов (из конфига сервера)
4. Обработка `notifications/tools/list_changed` — перезапрос tools/list, обновление ToolRegistry
5. Обработка `notifications/progress`:
   - Эмит события `"progress"` с `{ progressToken, progress, total, message }`
   - Интеграция с tool-proxy для отображения в TUI
6. Content type handling:
   - `text` → как есть
   - `image`/`audio` → `"[Image/Audio: <mimeType>, <size> bytes]"` в выводе
   - `resource` → `ResourceLink`: подставить URI; `EmbeddedResource`: извлечь text, blob → заглушка
   - `structuredContent` → JSON-строка в выводе (после text-контента)
7. Version negotiation:
   - Пробует версии по приоритету: `["2026-07-28", "2025-11-25"]`
   - Обрабатывает `UnsupportedProtocolVersionError` (-32004) — извлекает supported версии
   - Для modern era: каждый запрос несёт версию в `_meta`
   - Кэширует обнаруженную эру (`"modern"` | `"legacy"`) на время жизни подключения

**State machine (dual-era):**
```typescript
type McpClientState = "disconnected" | "connecting" | "initializing" | "connected" | "error" | "shutting_down";
type McpEra = "modern" | "legacy";

// Modern era (2026-07-28):
// disconnected → connecting (discover attempt)
// connecting → connected (discover response получен, tools/list загружен)
// Нет состояния "initializing" — stateless!

// Legacy era (2025-11-25):
// disconnected → connecting
// connecting → initializing (spawn успешен, отправили initialize)
// initializing → connected (initialize response получен, tools/list загружен)

// Общие переходы (обе эры):
// connecting → error (spawn fail, discover fail, или инициализация провалена)
// connected → connecting (реконнект: crash, health check fail)
// connected → error (реконнект исчерпан)
// connected → shutting_down (/mcp stop или graceful shutdown)
// error → connecting (ручной /mcp restart)
// shutting_down → disconnected (процесс завершён)
// * → error (protocol violation — требует ручного перезапуска)
```

**Тесты (dual-era + новые функции):**
- Modern: discover → connected (успешный startup без initialize)
- Modern: discover → MethodNotFound → fallback to legacy initialize → connected
- Legacy: disconnected → connecting → initializing → connected (успешный startup)
- connecting → error (spawn fail: command not found)
- initializing → error (initialize timeout, сервер не отвечает)
- connected → connecting → connected (успешный реконнект после crash)
- connected → connecting → error (реконнект исчерпан)
- connected → shutting_down → disconnected (graceful shutdown: close stdin → SIGTERM → SIGKILL)
- error → connecting → connected (ручной перезапуск)
- tools/list с пагинацией: 3 страницы по 50 тулов → все 150 тулов получены
- callTool с cancellation: AbortSignal → notifications/cancelled отправлена
- notifications/progress: прогресс эмитится в событие "progress"
- Version negotiation: UnsupportedProtocolVersionError → fallback на совместимую версию
- Сервер пишет в stderr — не влияет на состояние, stderr в debug-лог

#### Задача 3: MCP Client Manager

**Файлы:**
- `src/core/mcp/client-manager.ts`
- `src/core/mcp/config.ts`

**Что делаем:**
1. `McpClientManager`:
   - Управляет словарём `Map<string, McpClient>` (server name → client)
   - `addServer(name, config)` — создаёт клиент, инциализирует
   - `removeServer(name)` — отключает клиент
   - `startAll()` — запускает все enabled серверы
   - `stopAll()` — останавливает все серверы (graceful shutdown)
   - `getTools()` — собирает тулы со всех активных серверов
   - `getTool(name)` — найти тул по полному имени `mcp.<server>.<tool>`
   - `callTool(fullName, args, signal)` — найти нужный клиент и вызвать
   - `getStatus()` — статус всех серверов для TUI
2. `parseMcpConfig(raw)` — парсинг секции `mcp` из config.json
3. `resolveMcpEnv(env)` — подстановка `${VAR}` из process.env

**Тесты:**
- Интеграционный тест с двумя mock-серверами
- Тест парсинга конфига с env-подстановкой
- Тест graceful shutdown (все процессы завершены)

### Этап 2: Интеграция с ToolRegistry (задачи 4-5)

#### Задача 4: MCP Tool Proxy

**Файл:**
- `src/core/mcp/tool-proxy.ts`

**Что делаем:**
1. `createMcpToolProxy(serverName, mcpToolDef, client)` — создаёт `ToolDefinition`:
   ```typescript
   function createMcpToolProxy(
     serverName: string,
     mcpTool: McpToolDefinition,
     callTool: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolResult>
   ): ToolDefinition {
     return {
       name: `mcp.${serverName}.${mcpTool.name}`,
       label: `MCP: ${serverName}/${mcpTool.name}`,
       description: `[MCP] ${mcpTool.description}`,
       parameters: convertJsonSchema(mcpTool.inputSchema),
       toolType: "function",
       async execute(args, _context, signal) {
         return callTool(mcpTool.name, args, signal ?? new AbortController().signal);
       },
     };
   }
   ```
2. `convertJsonSchema(mcpSchema)` — конвертирует MCP JSON Schema в SOBA JsonSchema
3. Автоматическая регистрация/дерегистрация при изменении списка тулов сервера

**Тесты:**
- Тест конвертации схем (разные типы: string, number, enum, nested objects)
- Тест createMcpToolProxy с mock-клиентом

#### Задача 5: Интеграция с ToolRegistry и AgentLoop

**Файлы:**
- `src/core/tools/tool-registry.ts` (изменения)
- `src/core/loop/agent-loop.ts` (изменения)

**Что делаем:**
1. В `ToolRegistry` добавляем:
   - `registerMcpTools(mcpTools: ToolDefinition[])` — массовая регистрация
   - `unregisterMcpTools(prefix: string)` — удаление всех тулов с префиксом
   - MCP-тулы хранятся вместе с built-in, но с маркером `source: "mcp"`
2. В `AgentLoop`:
   - MCP-тулы выполняются через тот же code path, что и built-in (уже работает!)
   - Добавить специальную обработку `mcp.*` в trust check
   - Добавить индикацию `[MCP]` в tool_call_start событиях

**Тесты:**
- Интеграционный тест: полный цикл с mock-MCP-сервером через AgentLoop
- Тест deregistration при остановке сервера

### Этап 2.5: Shared test fixture (задача 3b)

#### Задача 3b: Mock MCP Server (shared test fixture)

**Файлы:**
- `tests/fixtures/mock-mcp-server.ts`

**Что делаем:**
1. Единый переиспользуемый mock-MCP-сервер для всех тестов:
   - Реализует JSON-RPC 2.0 over stdio (readline stdin, write JSON + `\n` в stdout)
   - Поддерживает dual-era: `server/discover` (modern) и `initialize` (legacy)
     - Флаг `--era=modern|legacy|both` (дефолт: `both`)
   - Поддерживает configurable behavior через аргументы командной строки:
     - `--tools=N` — количество тулов
     - `--delay=MS` — задержка ответа
     - `--crash-after=N` — упасть после N запросов
     - `--error-rate=PCT` — вероятность ошибки (0-100)
     - `--protocol-version=V` — версия протокола в ответе
   - Возвращает реалистичные тулы (с inputSchema, annotations)
   - Поддерживает пагинацию для tools/list (флаг `--page-size=N`)
   - Поддерживает `notifications/progress` (флаг `--progress-events=N`)
   - Поддерживает `tools/list_changed` нотификацию (при SIGUSR1)
   - Поддерживает `notifications/cancelled` (принимает и логирует)
   - Корректно обрабатывает graceful shutdown: close stdin → SIGTERM → SIGKILL
2. Используется во всех тестах задач 1c, 2, 3, 4, 5

**Тесты:**
- Modern: discover → tools/list → tools/call → shutdown
- Legacy: initialize → tools/list → tools/call → shutdown
- Пагинация: tools/list с page-size=3, tools=10 → 4 страницы
- Progress: tools/call с прогрессом
- Cancellation: отправка cancelled нотификации

### Этап 3: CLI, конфигурация и TUI (задачи 6-7)

#### Задача 6: Интеграция с cli.ts и конфигурацией

**Файлы:**
- `src/cli.ts` (изменения)
- `src/core/config/types.ts` (изменения)
- `src/core/config/config-loader.ts` (изменения)

**Что делаем:**
1. Добавляем `mcp` в `SobaConfig`:
   ```typescript
   export interface SobaConfig {
     // ...
     mcp?: McpConfig;
   }
   ```
2. В `cli.ts`:
   - После создания ToolRegistry — инициализируем McpClientManager
   - Регистрируем MCP-тулы в реестре
   - При graceful shutdown — stopAll()
   - Slash-команда `/mcp status`, `/mcp start <name>`, `/mcp stop <name>`
3. Human-readable error messages (i18n-ready):
   - `MCP_SERVER_NOT_FOUND`: "MCP server '{name}' is not configured. Check ~/.soba/config.json"
   - `MCP_SERVER_SPAWN_FAIL`: "Failed to start MCP server '{name}': {reason}. Is '{command}' installed?"
   - `MCP_TOOL_TIMEOUT`: "MCP tool '{name}' timed out after {timeout}s. Try again or increase timeout in config."
   - `MCP_SERVER_OFFLINE`: "MCP server '{name}' is offline (crashed). Use /mcp restart to recover."
   - `MCP_ENV_MISSING`: "Environment variable '{var}' referenced in MCP config for '{name}' is not set."
4. Migration plan:
   - Поле `configVersion` в MCP-конфиге (начинается с 1)
   - При загрузке: если версия конфига < текущей — применяется migration-функция
   - Если `configVersion` отсутствует (старый конфиг) — считается 1, секция `mcp` опциональна

**Тесты:**
- Тест загрузки конфига с MCP-секцией
- Тест graceful shutdown (все процессы завершены при SIGINT)

#### Задача 7: TUI-интеграция

**Файлы:**
- `src/widgets/tui/` (изменения)
- `src/cli/commands.ts` (изменения)

**Что делаем:**
1. В подвале TUI показываем индикатор MCP: `MCP: 2 servers (4 tools)`
2. По slash-команде `/mcp` открываем панель со списком серверов и их статусами:
   ```
   ┌──── MCP Servers ───────────────────────────┐
   │ ✅ github         4 tools   connected      │
   │ ✅ playwright      1 tool    connected      │
   │ ❌ custom-tool     —         error (exit 1) │
   │ ⏸  jira           3 tools   disabled       │
   └──────────────────────────────────────────────┘
   ```
3. Slash-команды:
   - `/mcp status` — показывает таблицу серверов
   - `/mcp start <name>` — запускает сервер
   - `/mcp stop <name>` — останавливает сервер
   - `/mcp restart <name>` — перезапускает сервер
4. При падении сервера — notification в TUI

**Тесты:**
- Ручной тест TUI с mock-сервером

### Этап 4: Документация и финализация (задача 8)

#### Задача 8: Документация и примеры

**Файлы:**
- `docs/mcp-usage.md` — руководство пользователя
- `docs/mcp-protocol.md` — техническая документация протокола
- `examples/mcp/github-mcp.json` — пример конфига для GitHub MCP
- `examples/mcp/playwright-mcp.json` — пример для Playwright MCP

**Что делаем:**
1. Документируем как добавить MCP-сервер
2. Примеры для популярных MCP-серверов:
   - `@modelcontextprotocol/server-github`
   - `@playwright/mcp`
   - `@anthropic/mcp-server-filesystem`
3. Troubleshooting guide
4. Обновляем `AGENTS.md` с упоминанием MCP

---

## 6. Последовательность реализации

```
  Task 1a: Types                   ─┐
  Task 1b: JSON-RPC               ─┤  Этап 1: Ядро
  Task 1c: Transport              ─┤
  Task 2:  MCP Client             ─┤
  Task 3:  Client Manager         ─┘
      │
  Task 3b: Mock MCP Server        ─┐  Этап 2.5: Shared fixtures
      │
  Task 4: MCP Tool Proxy          ─┐  Этап 2: Интеграция
  Task 5: ToolRegistry + Loop     ─┘
      │
  Task 6: CLI + Config            ─┐  Этап 3: CLI/TUI
  Task 7: TUI Integration         ─┘
      │
  Task 8: Documentation           ─   Этап 4: Документация
```

**Оценка времени:** 2-3 недели на все задачи.

- Этап 1 (задачи 1a-3): ~1.5 недели — ядро, самая сложная часть (JSON-RPC, транспорт, state machine с dual-era)
- Этап 2.5 (задача 3b): ~1 день — mock server
- Этап 2 (задачи 4-5): ~3 дня — интеграция с ToolRegistry
- Этап 3 (задачи 6-7): ~3 дня — CLI и TUI
- Этап 4 (задача 8): ~2 дня — документация

**Самые рискованные задачи по времени:**
- Задача 2 (state machine, dual-era, реконнект) — исторически недооценивается
- Задача 7 (TUI интеграция) — всегда занимает больше ожидаемого
- Задача 1c (graceful shutdown, семафор) — edge cases
- Dual-era version negotiation — новые, непроверенные сценарии

**Критерии приёмки каждого этапа:**
- `bun test` проходит без ошибок
- `biome check .` — 0 ошибок
- `bunx tsc --noEmit` — 0 ошибок
- `bun run build` проходит

---

## 7. Риски и открытые вопросы

### 7.1 Риски

| Риск | Вероятность | Mitigation |
|---|---|---|
| MCP-серверы нестабильны (падают) | Средняя | Реконнект до 3 раз, graceful degradation, авто-исключение тулов из tools/list |
| Несовместимость modern/legacy эр | Средняя | Dual-era архитектура, `server/discover` → fallback `initialize`, UnsupportedProtocolVersionError с retry |
| Злонамеренные серверы с ложными ToolAnnotations | Средняя | Trust level **только из конфига**, аннотации — только для UI (не для security decisions) |
| Конфликты env-переменных с хост-системой | Средняя | Изолированные env через spawn options, валидация имён переменных |
| MCP-тулы могут возвращать огромные ответы | Средняя | Truncation до `maxOutputSize` per-server, compactResult для истории |
| Аутентификация (OAuth) не поддерживается | Высокая | Фаза 1 — только env-переменные |
| Безопасность: пользователь копирует чужой конфиг | Средняя | Warning при первом использовании сервера, per-server trust level только из конфига |
| Env-инжекция через сторонние инструменты | Низкая | Валидация имён переменных `[A-Z_][A-Z0-9_]*`, логирование подставленных переменных |
| Недооценка сложности state machine + dual-era | Высокая | Детальные тесты для modern и legacy путей (задача 2) |
| stderr забивает логи (debug-спам) | Низкая | `logStderr: false` в конфиге, дефолтный уровень логирования: debug |
| Модель думает, что MCP-тул завис (cold start) | Средняя | Progress notifications + initializing статус + pre-fetch tools/list |

### 7.2 Открытые вопросы

1. **Нужно ли кэшировать tools/list между запусками SOBA?**
   - Решение: Да, кэшировать в памяти на время сессии. Сбрасывать при `tools/list_changed`.

2. **Как обрабатывать MCP-серверы, которые требуют интерактивного ввода?**
   - Решение: Не поддерживать в Фазе 1. MCP-сервер должен быть полностью неинтерактивным.

3. **Нужна ли поддержка нескольких подключений к одному серверу?**
   - Решение: Нет. Один инстанс сервера на один SOBA-процесс.

4. **Как тестировать с реальными MCP-серверами?**
   - Решение: Интеграционные тесты с mock-серверами (поддерживающими dual-era). Один smoke-тест с реальным сервером
     (например, `@modelcontextprotocol/server-filesystem`) в рамках manual test run.

5. **Заменяют ли MCP-тулы встроенные инструменты (read/write/bash/edit)?**
   - Решение: **Нет**. MCP — дополнение, не замена. Built-in тулы остаются всегда.
     Даже если MCP-сервер предоставляет filesystem-тулы, built-in `read`/`write`/`edit`
     не отключаются — модель сама выбирает.

6. **Где пользователь находит MCP-серверы для подключения?**
   - Решение: Документация `docs/mcp-usage.md` содержит ссылки на:
     - [MCP Registry](https://registry.modelcontextprotocol.io)
     - [Smithery](https://smithery.ai)
     - [Awesome MCP Servers](https://github.com/punkpeye/awesome-mcp-servers)

7. **Нужно ли указывать era сервера в конфиге пользователю?**
   - Решение: Нет. SOBA автоматически определяет эру через `server/discover`.
     Пользователю не нужно знать, modern сервер или legacy.

8. **Что если сервер 2026-07-28 также поддерживает legacy initialize?**
   - Решение: SOBA предпочитает modern path (`server/discover`), но если он
     возвращает ошибку — пробует legacy `initialize`. Приоритет всегда modern.

---

## 8. Конфигурация Biome и правила кода

Новый код должен следовать тем же стандартам:
- `biome.json` — общий конфиг для всего проекта
- `verbatimModuleSyntax: true` — type imports через `import type`
- `erasableSyntaxOnly: true` — без enum
- Файлы именуются в kebab-case

---

## 9. Сводка: что изменится для пользователя

### До MCP
```bash
$ soba
> search github issues for "bug"

# Модель: не могу, у меня нет доступа к GitHub API
```

### После MCP
```bash
$ cat ~/.soba/config.json
# добавляем github MCP-сервер в конфиг

$ soba
> search github issues for "bug"
# Модель вызывает mcp.github.search_issues → получает результаты
# Отображает найденные issues прямо в чате
```

### Slash-команды
```
/model ...     — уже есть
/compact       — уже есть
/skill ...     — уже есть
/mcp status    — новое: показать статус MCP-серверов
/mcp list      — новое: список доступных MCP-серверов (из конфига + предложения из документации)
/mcp start X   — новое: запустить сервер
/mcp stop X    — новое: остановить сервер
/mcp restart X — новое: перезапустить сервер
```
