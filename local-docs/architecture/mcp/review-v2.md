# Ревью v2: MCP Implementation Plan

**Дата ревью:** 2026-06-17  
**Ревьюер:** AI Assistant  
**Документ:** `docs/mcp-implementation-plan.md`  
**Версия протокола в плане:** 2025-11-25  
**Актуальная версия протокола:** 2025-11-25 (стабильная), draft 2026-07-28 (SEP-2577)

---

## Краткое резюме

План **хорошо структурирован и технически грамотен** для версии протокола 2025-11-25. Однако есть **критические пробелы**, которые могут привести к проблемам:

1. **Не учтена draft-версия 2026-07-28** с революционными изменениями (отказ от handshake, per-request metadata)
2. **Отсутствует поддержка ToolExecution** (task-augmented execution для long-running tools)
3. **Не реализована cancellation** (notifications/cancelled)
4. **Не реализована progress notifications** (notifications/progress)
5. **Устаревший подход к version negotiation** (в draft используется server/discover)

**Рекомендация:** план пригоден для реализации, но требует дополнений для future-proofing.

---

## Критические ошибки

### 1. ❌ Не учтена draft-версия 2026-07-28 (SEP-2577)

**Проблема:** План таргетирует версию 2025-11-25, но draft-спецификация (2026-07-28) вводит **фундаментальные изменения**:

#### 1.1 Отказ от initialize handshake

**2025-11-25 (текущая):**
```
Client → Server: initialize request
Server → Client: initialize response  
Client → Server: initialized notification
Client → Server: tools/call
```

**2026-07-28 (draft):**
```
Client → Server: tools/call (с _meta: { protocolVersion, clientInfo, capabilities })
Server → Client: response
```

**Почему это важно:**
- Draft убирает stateful handshake
- Каждый запрос теперь самодостаточен (carries own metadata)
- Сервер становится полностью stateless
- Упрощается реконнект (нет session state)

**Влияние на план:**
- §2.4 (жизненный цикл): state machine упрощается (нет `initializing` state)
- §3.2 (initialize): метод становится опциональным (только для legacy servers)
- §5 (задача 2): требуется поддержка dual-era (modern + legacy)

**Рекомендация:** Добавить в план поддержку `server/discover` для определения era сервера:

```typescript
// Новый метод для discovery
interface DiscoverRequest {
  method: "server/discover";
  params: {
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "soba", version: "0.4.0" }
    }
  };
}

interface DiscoverResult {
  supportedVersions: string[];  // ["2026-07-28", "2025-11-25"]
  capabilities: ServerCapabilities;
  serverInfo: Implementation;
}
```

**Приоритет:** 🔴 High — без этого SOBA не сможет работать с modern servers (2026-07-28+)

---

### 2. ❌ Отсутствует ToolExecution (task-augmented execution)

**Проблема:** План (§3.6) упоминает `structuredContent`, но **полностью игнорирует** поле `execution`:

```typescript
// Спецификация 2025-11-25, schema.ts:1231
interface ToolExecution {
  taskSupport?: "forbidden" | "optional" | "required";
}

interface Tool {
  // ...
  execution?: ToolExecution;
}
```

**Что это значит:**
- `taskSupport: "required"` — тул **требует** task-augmented execution
- Long-running операции (обучение модели, деплой, миграция БД) возвращают task ID
- Клиент поллит `tasks/result` для получения результата
- Без поддержки `execution` SOBA **не сможет вызвать** такие тулы

**Пример из спецификации:**
```json
{
  "name": "train_model",
  "execution": {
    "taskSupport": "required"
  }
}
```

**Влияние на план:**
- §3.6: добавить описание `ToolExecution`
- §3.3: переместить "Task-augmented execution" из "НЕ нужно" в "Фаза 2"
- §5 (задача 2): добавить обработку `taskSupport` в `callTool()`

**Рекомендация:**

```typescript
// В types.ts добавить
interface ToolExecution {
  taskSupport?: "forbidden" | "optional" | "required";
}

// В client.ts добавить
async callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult> {
  const tool = this.tools.get(name);
  if (tool?.execution?.taskSupport === "required") {
    // Task-augmented execution
    const taskResult = await this.createTask(name, args);
    return this.pollTaskResult(taskResult.taskId, signal);
  }
  // Regular execution
  return this.regularCall(name, args, signal);
}
```

**Приоритет:** 🟡 Medium — можно отложить до Фазы 2, но нужно явно задокументировать

---

### 3. ❌ Не реализована cancellation

**Проблема:** План не упоминает `notifications/cancelled`, хотя это **стандартный механизм JSON-RPC**:

```typescript
// Спецификация 2025-11-25, schema.ts:200
interface CancelledNotification {
  method: "notifications/cancelled";
  params: {
    requestId: RequestId;
    reason?: string;
  };
}
```

**Сценарий использования:**
1. Пользователь нажимает Ctrl+C во время выполнения MCP-тула
2. SOBA отправляет `notifications/cancelled` серверу
3. Сервер прекращает работу и освобождает ресурсы

**Влияние на план:**
- §5 (задача 1b): добавить `sendCancellation(requestId, reason)` в `JsonRpcSerializer`
- §5 (задача 2): добавить обработку `AbortSignal` в `callTool()`
- §4.8: упомянуть интеграцию с budget tracker (cancellation при timeout)

**Рекомендация:**

```typescript
// В client.ts
async callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult> {
  const requestId = this.nextRequestId++;
  
  signal.addEventListener("abort", () => {
    this.transport.send({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {
        requestId,
        reason: "User cancelled"
      }
    });
  });
  
  return this.transport.request(requestId, {
    method: "tools/call",
    params: { name, arguments: args }
  });
}
```

**Приоритет:** 🟢 Low — можно добавить в Фазе 2, но стоит упомянуть в плане

---

### 4. ❌ Не реализована progress notifications

**Проблема:** План не упоминает `notifications/progress`, хотя это **критично для UX**:

```typescript
// Спецификация 2025-11-25, schema.ts
interface ProgressNotification {
  method: "notifications/progress";
  params: {
    progressToken: ProgressToken;
    progress: number;
    total?: number;
    message?: string;
  };
}
```

**Сценарий использования:**
1. Модель вызывает `mcp.github.import_issues` (1000 issues)
2. Сервер отправляет progress: 10%, 20%, ..., 100%
3. SOBA показывает прогресс в TUI
4. Модель не думает, что тул завис

**Влияние на план:**
- §2.6 (cold start): progress notifications решают проблему "модель думает, что тул сломан"
- §5 (задача 2): добавить обработку `notifications/progress` в `McpClient`
- §5 (задача 7): добавить progress bar в TUI

**Рекомендация:**

```typescript
// В client.ts
this.transport.on("notification", (notification) => {
  if (notification.method === "notifications/progress") {
    const { progressToken, progress, total, message } = notification.params;
    this.emit("progress", { progressToken, progress, total, message });
  }
});

// В tool-proxy.ts
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

**Приоритет:** 🟡 Medium — сильно улучшает UX, стоит добавить в Фазу 1

---

### 5. ⚠️ Устаревший подход к version negotiation

**Проблема:** План (§3.4) описывает version negotiation через `initialize` handshake:

```typescript
// План: client отправляет protocolVersion в initialize
{
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25"
  }
}
```

**Draft 2026-07-28 использует другой подход:**
- Каждый запрос несет версию в `_meta`
- Сервер отвечает `UnsupportedProtocolVersionError` если не поддерживает
- Клиент ретраит с другой версией

**Пример из draft:**
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

**Влияние на план:**
- §3.4: добавить описание `UnsupportedProtocolVersionError`
- §5 (задача 2): добавить retry logic с version fallback

**Рекомендация:**

```typescript
// В client.ts
async connect(): Promise<void> {
  const versions = ["2026-07-28", "2025-11-25"];  // preferred first
  
  for (const version of versions) {
    try {
      await this.tryConnect(version);
      this.protocolVersion = version;
      return;
    } catch (error) {
      if (error.code === -32004) {  // UnsupportedProtocolVersionError
        const supported = error.data.supported;
        const compatible = versions.find(v => supported.includes(v));
        if (compatible) {
          await this.tryConnect(compatible);
          this.protocolVersion = compatible;
          return;
        }
      }
      throw error;
    }
  }
}
```

**Приоритет:** 🟡 Medium — нужно для совместимости с future servers

---

## Важные замечания

### 6. ⚠️ ToolAnnotations: warning о untrusted servers

**Проблема:** План (§3.7) предлагает использовать `ToolAnnotations` для автоматического trust level:

```typescript
// План
if (tool.annotations?.destructiveHint) {
  trustLevel = "dangerous";
}
```

**Спецификация содержит критический warning:**

> **NOTE:** all properties in `ToolAnnotations` are **hints**. They are not guaranteed to provide a faithful description of tool behavior.
> 
> **Clients should never make tool use decisions based on ToolAnnotations received from untrusted servers.**

**Риск:**
- Злонамеренный сервер может указать `destructiveHint: false` для деструктивной операции
- SOBA автоматически поставит `trust: "normal"` и выполнит без подтверждения
- Пользователь потеряет данные

**Рекомендация:**
- Аннотации использовать **только для UI** (отображение иконок, подсказок)
- Trust level **всегда** брать из конфига пользователя
- Добавить warning в документацию: "Не полагайтесь на аннотации для security decisions"

```typescript
// В tool-proxy.ts
function createMcpToolProxy(serverName, mcpTool, client, configTrust) {
  return {
    name: `mcp.${serverName}.${mcpTool.name}`,
    trust: configTrust,  // Из конфига, НЕ из annotations
    // ...
  };
}
```

**Приоритет:** 🔴 High — security issue

---

### 7. ⚠️ Отсутствует обработка InputRequiredResult (draft)

**Проблема:** Draft 2026-07-28 вводит `InputRequiredResult` для multi-round-trip requests:

```typescript
// Draft schema.ts:492
interface InputRequiredResult {
  inputRequests: InputRequest[];
  requestState?: string;
}

interface InputRequest {
  type: "elicitation" | "sampling";
  // ...
}
```

**Сценарий:**
1. Клиент вызывает `mcp.database.query`
2. Сервер возвращает `InputRequiredResult` с запросом "Какой database?"
3. Клиент показывает elicitation UI пользователю
4. Пользователь вводит "production"
5. Клиент ретраит запрос с `requestState`

**Влияние на план:**
- §3.3: добавить "Multi-round-trip requests" в "НЕ нужно в Фазе 1"
- §5 (задача 2): добавить обработку `InputRequiredResult` (хотя бы error)

**Рекомендация:**

```typescript
// В client.ts
async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const result = await this.transport.request({
    method: "tools/call",
    params: { name, arguments: args }
  });
  
  if (result.inputRequests) {
    // Draft: InputRequiredResult
    throw new Error("MCP tool requires additional input (not supported in Phase 1)");
  }
  
  return result;
}
```

**Приоритет:** 🟢 Low — можно игнорировать в Фазе 1, но стоит упомянуть

---

### 8. ⚠️ Не описана обработка stderr правильно

**Проблема:** План (§5, задача 1c) говорит:

> "Обработка stderr: перенаправляется в лог с префиксом `[mcp:<server>]`"

**Спецификация уточняет:**

> The client **MAY** capture, forward, or ignore the server's `stderr` output and **SHOULD NOT** assume `stderr` output indicates error conditions.

**Важно:**
- stderr может содержать debug logs, info messages, warnings
- Не все stderr — ошибки
- Некоторые серверы пишут в stderr прогресс (например, `npm install`)

**Рекомендация:**
- Логирировать stderr с уровнем `debug` (не `error`)
- Добавить флаг `logStderr: boolean` в конфиг сервера
- Парсить stderr для progress messages (опционально)

```typescript
// В transport.ts
process.stderr.on("data", (chunk) => {
  const message = chunk.toString().trim();
  if (this.config.logStderr !== false) {
    console.debug(`[mcp:${this.serverName}] ${message}`);
  }
});
```

**Приоритет:** 🟢 Low — улучшение качества логирования

---

## Мелкие замечания

### 9. Опечатка в §2.4

**Текст:** "spawn() процесса"  
**Должно быть:** "spawn процесса" или "spawn() подпроцесса"

---

### 10. Неполное описание shutdown sequence

**План (§2.4):**
> "SIGTERM → kill после таймаута"

**Спецификация (2025-11-25):**
1. Close stdin (primary signal)
2. Wait for exit
3. SIGTERM (если не вышел)
4. SIGKILL (если не вышел после SIGTERM)

**Рекомендация:** уточнить последовательность в плане

---

### 11. Отсутствует описание pagination для tools/list

**Проблема:** План не упоминает, что `tools/list` поддерживает pagination:

```json
{
  "method": "tools/list",
  "params": {
    "cursor": "optional-cursor-value"
  }
}
```

**Влияние:**
- Серверы с 100+ тулами могут возвращать пагинированный список
- Клиент должен поллить до получения всех тулов

**Рекомендация:**

```typescript
// В client.ts
async listTools(): Promise<Tool[]> {
  const allTools: Tool[] = [];
  let cursor: string | undefined;
  
  do {
    const result = await this.transport.request({
      method: "tools/list",
      params: cursor ? { cursor } : {}
    });
    
    allTools.push(...result.tools);
    cursor = result.nextCursor;
  } while (cursor);
  
  return allTools;
}
```

**Приоритет:** 🟢 Low — большинство серверов возвращают все тулы сразу

---

### 12. Не описана валидация outputSchema

**Проблема:** План (§3.6) упоминает `outputSchema`, но не говорит о валидации:

**Спецификация:**
> If an output schema is provided:
> - Servers **MUST** provide structured results that conform to this schema.
> - Clients **SHOULD** validate structured results against this schema.

**Рекомендация:**

```typescript
// В client.ts
if (tool.outputSchema && result.structuredContent) {
  const isValid = validateJsonSchema(tool.outputSchema, result.structuredContent);
  if (!isValid) {
    console.warn(`MCP tool ${tool.name} returned invalid structuredContent`);
  }
}
```

**Приоритет:** 🟢 Low — можно добавить в Фазе 2

---

## Положительные стороны (что сделано правильно)

✅ **Архитектура с ToolRegistry** — элегантное решение, MCP-тулы выглядят как built-in  
✅ **Префикс `mcp.<server>.<tool>`** — избегает коллизий, улучшает observability  
✅ **Ленивая инициализация** — правильная оптимизация для быстрого старта  
✅ **Per-server конфиг** — гибкость (timeout, trust, maxOutputSize)  
✅ **Интеграция с Trust Manager** — per-server trust level  
✅ **Обработка content types** — разумный подход (text + заглушки для image/audio)  
✅ **StructuredContent поддержка** — улучшает качество для модели  
✅ **State machine** — хорошо описаны переходы между состояниями  
✅ **Реконнект логика** — экспоненциальная задержка, max 3 попытки  
✅ **Cold start mitigation** — pre-fetch tools/list из кэша  

---

## Итоговые рекомендации

### Must-have (перед стартом реализации)

1. 🔴 **Добавить поддержку `server/discover`** для dual-era servers (modern + legacy)
2. 🔴 **Исправить ToolAnnotations security issue** — не использовать для trust decisions
3. 🔴 **Уточнить version negotiation** — добавить retry с UnsupportedProtocolVersionError

### Should-have (Фаза 1)

4. 🟡 **Добавить progress notifications** — критично для UX long-running tools
5. 🟡 **Добавить cancellation** — интеграция с AbortSignal
6. 🟡 **Упомянуть ToolExecution** — задокументировать как "Фаза 2"
7. 🟡 **Добавить pagination для tools/list** — поддержка серверов с 100+ тулами

### Nice-to-have (Фаза 2)

8. 🟢 **InputRequiredResult** — multi-round-trip requests
9. 🟢 **Task-augmented execution** — long-running tools
10. 🟢 **OutputSchema validation** — валидация structuredContent
11. 🟢 **Subscriptions** — подписки на изменения (draft)

---

## Оценка готовности плана

| Критерий | Оценка | Комментарий |
|---|---|---|
| Архитектура | ⭐⭐⭐⭐⭐ | Отличная, ToolRegistry + префиксы |
| Протокол 2025-11-25 | ⭐⭐⭐⭐ | Хорошо, но есть пробелы (cancellation, progress) |
| Протокол 2026-07-28 (draft) | ⭐⭐ | Не учтен, требует доработки |
| Безопасность | ⭐⭐⭐ | ToolAnnotations issue критичен |
| UX | ⭐⭐⭐⭐ | Cold start mitigation хороший, но нет progress |
| Future-proofing | ⭐⭐ | Нет поддержки modern servers |
| Декомпозиция задач | ⭐⭐⭐⭐⭐ | Отличная, логичная последовательность |
| Тестирование | ⭐⭐⭐⭐ | Хорошо, но можно добавить edge cases |

**Общая оценка:** ⭐⭐⭐⭐ (4/5)

**Вердикт:** План **пригоден для реализации**, но требует дополнений для production-ready MCP-клиента. Рекомендую внести must-have изменения перед стартом.

---

## Ссылки на спецификацию

- **2025-11-25 (стабильная):** `/Users/avacado/Projects/ai-projects/modelcontextprotocol/schema/2025-11-25/schema.ts`
- **2026-07-28 (draft):** `/Users/avacado/Projects/ai-projects/modelcontextprotocol/schema/draft/schema.ts`
- **Lifecycle:** `docs/specification/2025-11-25/basic/lifecycle.mdx`
- **Tools:** `docs/specification/2025-11-25/server/tools.mdx`
- **Versioning (draft):** `docs/specification/draft/basic/versioning.mdx`
- **Transports (draft):** `docs/specification/draft/basic/transports/stdio.mdx`
