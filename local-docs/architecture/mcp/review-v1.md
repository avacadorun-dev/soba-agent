# Ревью: MCP Implementation Plan

**Дата ревью:** 2026-06-17  
**Документ:** `docs/mcp-implementation-plan.md`  
**Версия протокола в плане:** 2025-11-25  
**Актуальная версия протокола:** draft (2026-07-28)

---

## Критические замечания

### 1. Устаревшая версия протокола

**Проблема:** План основан на версии `2025-11-25`, но уже существует draft версия `2026-07-28` с **breaking changes**.

**Рекомендация:** Рассмотреть поддержку обеих версий или сразу ориентироваться на draft `2026-07-28`.

---

### 2. Механизм handshake заменен на per-request versioning

**План описывает:**
```
initialize handshake:
  Client → Server: initialize (protocolVersion, capabilities, clientInfo)
  Server → Client: initialize response (protocolVersion, capabilities, serverInfo)
  Client → Server: notifications/initialized
```

**Актуальная спецификация (draft 2026-07-28):**
- **Нет handshake**. Каждый запрос объявляет версию в `_meta`:
  ```json
  {
    "method": "tools/list",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {...},
        "io.modelcontextprotocol/clientCapabilities": {...}
      }
    }
  }
  ```
- Server принимает или отклоняет каждый запрос независимо
- При неподдерживаемой версии возвращается `UnsupportedProtocolVersionError`

**Влияние:** Архитектура middleware и connection management в плане устарела.

---

### 3. Отсутствует `server/discover`

**План не упоминает:** Новый метод `server/discover` для discovery capabilities.

**Актуальная спецификация:**
```json
{
  "method": "server/discover",
  "params": { "_meta": {...} }
}
```

**Response:**
```json
{
  "result": {
    "resultType": "complete",
    "supportedVersions": ["2026-07-28"],
    "capabilities": {...},
    "serverInfo": {...},
    "instructions": "...",
    "ttlMs": 3600000,
    "cacheScope": "public"
  }
}
```

**Влияние:** 
- Clients могут вызвать `server/discover` перед другими запросами
- Обязателен для серверов (MUST implement)
- Полезен для stdio backward compatibility probe

---

### 4. Подписки: `subscriptions/listen` вместо отдельных методов

**План описывает:**
- `resources/subscribe` / `resources/unsubscribe` для отдельных ресурсов
- Отдельные уведомления `notifications/tools/list_changed`, `notifications/prompts/list_changed`

**Актуальная спецификация (draft 2026-07-28):**
Единый метод `subscriptions/listen` с фильтром:

```json
{
  "method": "subscriptions/listen",
  "params": {
    "notifications": {
      "toolsListChanged": true,
      "promptsListChanged": true,
      "resourcesListChanged": true,
      "resourceSubscriptions": ["file:///path/to/resource"]
    }
  }
}
```

**Сервер отвечает:**
```json
{
  "method": "notifications/subscriptions/acknowledged",
  "params": {
    "notifications": {...}
  }
}
```

**Влияние:** 
- Упрощенная модель подписок
- Один long-lived stream вместо множества
- `resources/subscribe` / `resources/unsubscribe` удалены

---

### 5. Multi Round-Trip Requests (MRTR) — новый паттерн

**План не упоминает:** MRTR заменяет server-initiated requests.

**Актуальная спецификация:**
Серверы **НЕ МОГУТ** отправлять запросы клиенту (sampling, elicitation, roots). Вместо этого:

1. Client отправляет запрос (например, `tools/call`)
2. Server отвечает `InputRequiredResult` с `inputRequests` и `requestState`:
   ```json
   {
     "resultType": "input_required",
     "inputRequests": {
       "github_login": {
         "method": "elicitation/create",
         "params": {...}
       }
     },
     "requestState": "opaque-string"
   }
   ```
3. Client собирает input, повторяет запрос с `inputResponses`:
   ```json
   {
     "method": "tools/call",
     "params": {
       "inputResponses": {
         "github_login": {
           "action": "accept",
           "content": {...}
         }
       },
       "requestState": "opaque-string"
     }
   }
   ```

**Влияние:**
- **Breaking change**: Server-initiated requests больше не поддерживаются
- Client должен реализовать MRTR pattern
- Server должен кодировать состояние в `requestState`

---

### 6. Удалено поле `execution` из Tool

**План описывает:**
```typescript
interface Tool {
  name: string;
  description?: string;
  inputSchema: object;
  execution?: ToolExecution; // taskSupport: "forbidden" | "optional" | "required"
}
```

**Актуальная спецификация (draft 2026-07-28):**
Поле `execution` **удалено**. Tool теперь:
```typescript
interface Tool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: {...};
  outputSchema?: {...};
  annotations?: ToolAnnotations;
  icons?: Icon[];
}
```

**Влияние:** Task-augmented execution больше не часть core spec (возможно, перенесено в extensions).

---

### 7. Deprecation: sampling, roots, logging (SEP-2577)

**План описывает:**
- `sampling/createMessage` как активную фичу
- `roots/list` как активную фичу
- `notifications/message` (logging) как активную фичу

**Актуальная спецификация (draft 2026-07-28):**
Все три **deprecated** (SEP-2577):
- `@deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577)`
- Остаются в spec минимум 12 месяцев
- Но новые реализации должны использовать альтернативы

**Влияние:**
- Sampling через `sampling/createMessage` → использовать MRTR с `elicitation/create`
- Roots через `roots/list` → deprecated
- Logging через `notifications/message` → deprecated

---

### 8. Новый формат Result с `resultType`

**План не упоминает:** Структура `Result` изменилась.

**Актуальная спецификация:**
```typescript
interface Result {
  resultType: "complete" | "working" | "input_required";
  _meta?: MetaObject;
}

interface CacheableResult extends Result {
  ttlMs: number;
  cacheScope: "public" | "private";
}
```

**Влияние:**
- Каждый результат имеет `resultType`
- Кеширование через `ttlMs` и `cacheScope`
- Client должен обрабатывать разные типы результатов

---

### 9. Tool inputSchema: JSON Schema 2020-12 по умолчанию

**План описывает:**
```typescript
inputSchema: { type: "object"; properties?: object; required?: string[] }
```

**Актуальная спецификация:**
```typescript
inputSchema: { 
  $schema?: string;  // defaults to 2020-12 if absent
  type: "object"; 
  [key: string]: unknown  // any JSON Schema keyword
}
```

**Влияние:**
- По умолчанию JSON Schema 2020-12 (не draft-07)
- Можно использовать `$schema` для явного указания версии
- Поддержка всех keywords (oneOf, anyOf, allOf, if/then/else, $ref, $defs)

---

### 10. Tool annotations: `title` вынесен на верхний уровень

**План описывает:**
```typescript
annotations?: {
  title?: string;
  readOnlyHint?: boolean;
  // ...
}
```

**Актуальная спецификация:**
```typescript
interface Tool extends BaseMetadata {
  title?: string;  // на верхнем уровне
  annotations?: ToolAnnotations;  // без title
}

interface ToolAnnotations {
  title?: string;  // deprecated, use top-level title
  readOnlyHint?: boolean;
  // ...
}
```

**Приоритет:** `title` > `annotations.title` > `name`

**Влияние:** Нужно использовать `title` на уровне Tool, а не в annotations.

---

## Рекомендации по обновлению плана

### Приоритет 1: Критические изменения

1. **Переписать архитектуру connection management**
   - Убрать `initialize` handshake
   - Добавить per-request versioning через `_meta`
   - Реализовать `UnsupportedProtocolVersionError` handling

2. **Добавить `server/discover`**
   - Обязательный метод для серверов
   - Useful для clients (optional)
   - Backward compatibility probe для stdio

3. **Реализовать `subscriptions/listen`**
   - Заменить `resources/subscribe` / `resources/unsubscribe`
   - Единый long-lived stream
   - Фильтр через `notifications` object

4. **Реализовать MRTR pattern**
   - Заменить server-initiated requests
   - `InputRequiredResult` + `InputResponses`
   - `requestState` для server-side state encoding

### Приоритет 2: Важные изменения

5. **Удалить `execution` из Tool**
   - Task support больше не в core spec
   - Возможно, перенесено в extensions

6. **Обновить Result структуру**
   - Добавить `resultType`
   - Поддержка `CacheableResult` с `ttlMs` и `cacheScope`

7. **Обновить Tool schema**
   - JSON Schema 2020-12 по умолчанию
   - `title` на верхнем уровне
   - Поддержка `outputSchema`

### Приоритет 3: Deprecations

8. **Отметить deprecated фичи**
   - `sampling/createMessage` → deprecated
   - `roots/list` → deprecated
   - `notifications/message` (logging) → deprecated
   - Поддержать для backward compatibility, но не использовать в новых фичах

---

## Дополнительные замечания

### Положительные стороны плана

✅ Четкая структура: от мотивации → архитектура → протокол → задачи  
✅ Хорошее покрытие use cases  
✅ Детальный план реализации с разбивкой на задачи  
✅ Учет тестирования после каждой задачи  

### Что можно улучшить

⚠️ **Dual-era support**: План не учитывает необходимость поддержки обеих версий (legacy `2025-11-25` и modern `2026-07-28`)

⚠️ **Backward compatibility**: Не описан механизм определения era сервера (legacy vs modern)

⚠️ **Extensions negotiation**: Не упомянуто расширение протокола через `capabilities.extensions`

⚠️ **Security considerations**: MRTR `requestState` требует integrity protection (HMAC/AEAD)

---

## Источники

- Актуальная спецификация: https://modelcontextprotocol.io/specification/draft
- Schema (draft): `/Users/avacado/Projects/ai-projects/modelcontextprotocol/schema/draft/schema.ts`
- Schema (2025-11-25): `/Users/avacado/Projects/ai-projects/modelcontextprotocol/schema/2025-11-25/schema.ts`
- Versioning: `/Users/avacado/Projects/ai-projects/modelcontextprotocol/docs/specification/draft/basic/versioning.mdx`
- Discovery: `/Users/avacado/Projects/ai-projects/modelcontextprotocol/docs/specification/draft/server/discover.mdx`
- Subscriptions: `/Users/avacado/Projects/ai-projects/modelcontextprotocol/docs/specification/draft/basic/patterns/subscriptions.mdx`
- MRTR: `/Users/avacado/Projects/ai-projects/modelcontextprotocol/docs/specification/draft/basic/patterns/mrtr.mdx`

---

## Заключение

План хорошо структурирован и детализирован, но основан на устаревшей версии протокола `2025-11-25`. Draft версия `2026-07-28` содержит **breaking changes**:

1. Замена handshake на per-request versioning
2. Новый метод `server/discover`
3. Унифицированные подписки через `subscriptions/listen`
4. MRTR pattern вместо server-initiated requests
5. Deprecation sampling, roots, logging

**Рекомендация:** Обновить план для поддержки draft `2026-07-28` или реализовать dual-era поддержку обеих версий.
