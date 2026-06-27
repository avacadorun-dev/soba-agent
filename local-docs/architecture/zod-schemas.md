# Zod-схемы OpenResponses API

> Сгенерировано Kubb из OpenAPI-спецификации OpenAI Responses API.
> Расположение: `src/core/client/schemas/`

## 1. Архитектура

```
createResponse (запрос/ответ)
  ├── createResponseBodySchema       ← тело POST-запроса
  └── responseResourceSchema         ← полный объект ответа

itemParam (типы элементов для входных запросов)
  ├── userMessageItemParamSchema
  ├── systemMessageItemParamSchema
  ├── developerMessageItemParamSchema
  ├── assistantMessageItemParamSchema
  ├── functionCallItemParamSchema
  ├── functionCallOutputItemParamSchema
  ├── reasoningItemParamSchema
  ├── compactionSummaryItemParamSchema
  └── itemReferenceParamSchema

itemField (типы элементов в выходных ответах)
  ├── messageSchema
  ├── functionCallSchema
  ├── functionCallOutputSchema
  ├── reasoningBodySchema
  └── compactionBodySchema

streaming events (~25 схем)    ← SSE-события стриминга
content schemas (~9 схем)      ← типы контента
tool schemas (~8 схем)         ← определения инструментов
enum schemas (~10 схем)        ← enum-значения
utility schemas (~10 схем)     ← вспомогательные (usage, metadata, ...)
WebSocket schemas (2 схемы)     ← WebSocket-режим
compact schemas (4 схемы)      ← compaction API
```

## 2. Основные типы элементов

### `itemParamSchema` — то, что **отправляется** в API

```typescript
z.union([
  itemReferenceParamSchema,          // ссылка на существующий item по id
  reasoningItemParamSchema,          // рассуждения модели
  compactionSummaryItemParamSchema,  // сжатый compaction-summary
  userMessageItemParamSchema,        // сообщение пользователя
  systemMessageItemParamSchema,      // системное сообщение
  developerMessageItemParamSchema,   // developer-сообщение
  assistantMessageItemParamSchema,   // сообщение ассистента
  functionCallItemParamSchema,       // вызов функции
  functionCallOutputItemParamSchema, // результат вызова функции
])
```

### `itemFieldSchema` — то, что **возвращается** из API

```typescript
z.union([
  messageSchema,            // сообщение любого role
  functionCallSchema,       // вызов функции
  functionCallOutputSchema, // результат вызова функции
  reasoningBodySchema,      // элемент рассуждения
  compactionBodySchema,     // элемент compaction
])
```

## 3. Типы сообщений (входные параметры)

| Схема | role | content |
|---|---|---|
| `userMessageItemParamSchema` | `"user"` | `input_text`, `input_image`, `input_file` |
| `systemMessageItemParamSchema` | `"system"` | `input_text` |
| `developerMessageItemParamSchema` | `"developer"` | `input_text` |
| `assistantMessageItemParamSchema` | `"assistant"` | `output_text`, `refusal` (+ поле `phase`) |

## 4. Типы контента (content schemas)

### Входные (Input)

| Схема | type | Поля |
|---|---|---|
| `inputTextContentSchema` | `"input_text"` | `text: string` |
| `inputTextContentParamSchema` | `"input_text"` | `text: string` (max 10485760) |
| `inputImageContentSchema` | `"input_image"` | `image_url?`, `detail` |
| `inputImageContentParamAutoParamSchema` | `"input_image"` | `image_url?`, `detail?` |
| `inputFileContentSchema` | `"input_file"` | `filename?`, `file_url?` |
| `inputFileContentParamSchema` | `"input_file"` | `filename?`, `file_data?`, `file_url?` |
| `inputVideoContentSchema` | `"input_video"` | `video_url: string` |

### Выходные (Output)

| Схема | type | Поля |
|---|---|---|
| `outputTextContentSchema` | `"output_text"` | `text`, `annotations[]`, `logprobs?[]` |
| `outputTextContentParamSchema` | `"output_text"` | `text` (max 10485760), `annotations?[]` |
| `textContentSchema` | `"text"` | `text: string` |
| `summaryTextContentSchema` | `"summary_text"` | `text: string` |
| `reasoningTextContentSchema` | `"reasoning_text"` | `text: string` |
| `refusalContentSchema` | `"refusal"` | `refusal: string` |
| `refusalContentParamSchema` | `"refusal"` | `refusal: string` (max 10485760) |

## 5. Инструменты (tools)

### Три представления

- **`functionToolSchema`** (response — что возвращает API): `{ type: "function", name, description?, parameters?, strict? }`
- **`functionToolParamSchema`** (request — что отправляют): `{ name (regex /^[a-zA-Z0-9_-]+$/), description?, parameters?, strict?, type }`
- **`responsesToolParamSchema`** = `functionToolParamSchema` (алиас)

### Tool Choice — выбор инструмента

```
toolChoiceParamSchema = union(
  specificToolChoiceParamSchema,   // { type: "function", name }
  toolChoiceValueEnumSchema,       // "none" | "auto" | "required"
  allowedToolsParamSchema,         // { type: "allowed_tools", tools[], mode? }
)
```

- `functionToolChoiceSchema`: `{ type: "function", name? }`
- `allowedToolChoiceSchema`: `{ type: "allowed_tools", tools: functionToolChoice[], mode }`
- `specificFunctionParamSchema`: `{ type: "function", name }`

## 6. Enum-схемы

| Схема | Значения |
|---|---|
| `messageRoleSchema` | `"user"`, `"assistant"`, `"system"`, `"developer"` |
| `messageStatusSchema` | `"in_progress"`, `"completed"`, `"incomplete"` |
| `functionCallStatusSchema` | `"in_progress"`, `"completed"`, `"incomplete"` |
| `functionCallItemStatusSchema` | `"in_progress"`, `"completed"`, `"incomplete"` |
| `functionCallOutputStatusEnumSchema` | `"in_progress"`, `"completed"`, `"incomplete"` |
| `includeEnumSchema` | `"reasoning.encrypted_content"`, `"message.output_text.logprobs"` |
| `reasoningEffortEnumSchema` | `"none"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` |
| `reasoningSummaryEnumSchema` | `"concise"`, `"detailed"`, `"auto"` |
| `toolChoiceValueEnumSchema` | `"none"`, `"auto"`, `"required"` |
| `serviceTierEnumSchema` | `"auto"`, `"default"`, `"flex"`, `"priority"` |
| `truncationEnumSchema` | `"auto"`, `"disabled"` |
| `verbosityEnumSchema` | `"low"`, `"medium"`, `"high"` |
| `imageDetailSchema` / `detailEnumSchema` | `"low"`, `"high"`, `"auto"` |

## 7. Streaming-события (~25 схем)

Каждое SSE-событие содержит: `type`, `sequence_number` и специфичные поля.

### Жизненный цикл ответа

| Событие | type | Содержит |
|---|---|---|
| `responseQueuedStreamingEventSchema` | `response.queued` | `response` (полный) |
| `responseCreatedStreamingEventSchema` | `response.created` | `response` (полный) |
| `responseInProgressStreamingEventSchema` | `response.in_progress` | `response` (полный) |
| `responseCompletedStreamingEventSchema` | `response.completed` | `response` (полный) |
| `responseIncompleteStreamingEventSchema` | `response.incomplete` | `response` (полный) |
| `responseFailedStreamingEventSchema` | `response.failed` | `response` (полный) |

### События элементов вывода

| Событие | type | Ключевые поля |
|---|---|---|
| `responseOutputItemAddedStreamingEventSchema` | `response.output_item.added` | `output_index`, `item` |
| `responseOutputItemDoneStreamingEventSchema` | `response.output_item.done` | `output_index`, `item` |

### События частей контента

| Событие | type | Ключевые поля |
|---|---|---|
| `responseContentPartAddedStreamingEventSchema` | `response.content_part.added` | `item_id`, `output_index`, `content_index`, `part` |
| `responseContentPartDoneStreamingEventSchema` | `response.content_part.done` | `item_id`, `output_index`, `content_index`, `part` |

### События текста вывода (output_text)

| Событие | type | Ключевые поля |
|---|---|---|
| `responseOutputTextDeltaStreamingEventSchema` | `response.output_text.delta` | `delta`, `logprobs?`, `obfuscation?` |
| `responseOutputTextDoneStreamingEventSchema` | `response.output_text.done` | `text`, `logprobs?` |
| `responseOutputTextAnnotationAddedStreamingEventSchema` | `response.output_text.annotation.added` | `annotation_index`, `annotation` |

### События вызова функций

| Событие | type | Ключевые поля |
|---|---|---|
| `responseFunctionCallArgumentsDeltaStreamingEventSchema` | `response.function_call_arguments.delta` | `delta`, `obfuscation?` |
| `responseFunctionCallArgumentsDoneStreamingEventSchema` | `response.function_call_arguments.done` | `arguments` |

### События рассуждений (reasoning)

| Событие | type | Ключевые поля |
|---|---|---|
| `responseReasoningDeltaStreamingEventSchema` | `response.reasoning.delta` | `delta`, `obfuscation?` |
| `responseReasoningDoneStreamingEventSchema` | `response.reasoning.done` | `text` |
| `responseReasoningSummaryDeltaStreamingEventSchema` | `response.reasoning_summary_text.delta` | `delta`, `obfuscation?` |
| `responseReasoningSummaryDoneStreamingEventSchema` | `response.reasoning_summary_text.done` | `text` |
| `responseReasoningSummaryPartAddedStreamingEventSchema` | `response.reasoning_summary_part.added` | `summary_index`, `part` |
| `responseReasoningSummaryPartDoneStreamingEventSchema` | `response.reasoning_summary_part.done` | `summary_index`, `part` |

### События отказа (refusal)

| Событие | type | Ключевые поля |
|---|---|---|
| `responseRefusalDeltaStreamingEventSchema` | `response.refusal.delta` | `delta` |
| `responseRefusalDoneStreamingEventSchema` | `response.refusal.done` | `refusal` |

### Событие ошибки

| Событие | type | Ключевые поля |
|---|---|---|
| `errorStreamingEventSchema` | `error` | `error` (errorPayloadSchema) |

## 8. Compaction API

### Запрос: `compactResponseMethodPublicBodySchema`

```typescript
{
  model: string,
  input?: itemParam[] | string | null,
  previous_response_id?: string | null,
  instructions?: string | null,
  prompt_cache_key?: string | null,
}
```

### Ответ: `compactResourceSchema`

```typescript
{
  id: string,
  object: "response.compaction",
  output: itemField[],
  created_at: number,
  usage: usageSchema,
}
```

### Элементы compaction

- **`compactionBodySchema`** (в output-ответе): `{ type: "compaction", id, encrypted_content, created_by? }`
- **`compactionSummaryItemParamSchema`** (в input-запросе): `{ id?, type: "compaction", encrypted_content (max 10485760) }`

## 9. WebSocket

- **`webSocketResponseCreateEventSchema`**: расширяет `createResponseBodySchema` + `type: "response.create"`, запрещает `stream`, `stream_options`, `background`
- **`webSocketErrorEventSchema`**: `{ type: "error", status, error: { type?, code, message, param? } }`

## 10. Формат ответа (response format)

```
textFormatParamSchema = union(
  textResponseFormatSchema,              // { type: "text" }
  jsonSchemaResponseFormatParamSchema,   // { type?, description?, name?, schema?, strict? }
)

textFieldSchema.format = union(
  textResponseFormatSchema,              // { type: "text" }
  jsonObjectResponseFormatSchema,        // { type: "json_object" }
  jsonSchemaResponseFormatSchema,        // { type: "json_schema", name, description?, schema, strict }
)
```

- **`textParamSchema`** (request): `{ format?, verbosity? }`
- **`textFieldSchema`** (response): `{ format, verbosity? }`

## 11. Вспомогательные схемы

| Схема | Описание | Структура |
|---|---|---|
| `usageSchema` | Токен-статистика | `{ input_tokens, output_tokens, total_tokens, input_tokens_details, output_tokens_details }` |
| `inputTokensDetailsSchema` | Детали входных токенов | `{ cached_tokens }` |
| `outputTokensDetailsSchema` | Детали выходных токенов | `{ reasoning_tokens }` |
| `metadataParamSchema` | Метаданные (16 пар кл-знач) | `catchall(string, max 512)` |
| `errorSchema` | Ошибка в ответе | `{ code, message }` |
| `errorPayloadSchema` | Стриминговая ошибка | `{ type, code?, message, param?, headers? }` |
| `incompleteDetailsSchema` | Причина неполноты ответа | `{ reason }` |
| `annotationSchema` | Цитирование URL (алиас) | = `urlCitationBodySchema` |
| `urlCitationBodySchema` | Цитата URL (response) | `{ type, url, start_index, end_index, title }` |
| `urlCitationParamSchema` | Цитата URL (request) | `{ type, start_index, end_index, url, title }` |
| `logProbSchema` | Лог-вероятность токена | `{ token, logprob, bytes, top_logprobs[] }` |
| `topLogProbSchema` | Топ лог-вероятность | `{ token, logprob, bytes }` |
| `itemReferenceParamSchema` | Ссылка на item по id | `{ id }` |
| `emptyModelParamSchema` | Пустой объект | `{}` |
| `streamOptionsParamSchema` | Опции стриминга | `{ include_obfuscation? }` |

## 12. Основной запрос: `createResponseBodySchema`

```typescript
{
  model?: string | null,
  input?: itemParam[] | string | null,
  previous_response_id?: string | null,
  include?: includeEnumSchema[],
  tools?: responsesToolParamSchema[] | null,
  tool_choice?: toolChoiceParamSchema | null,
  metadata?: metadataParamSchema | null,
  text?: textParamSchema | null,
  temperature?: number | null,
  top_p?: number | null,
  presence_penalty?: number | null,
  frequency_penalty?: number | null,
  parallel_tool_calls?: boolean | null,
  stream?: boolean,
  stream_options?: streamOptionsParamSchema | null,
  background?: boolean,
  max_output_tokens?: number | null,
  max_tool_calls?: number | null,
  reasoning?: reasoningParamSchema | null,
  safety_identifier?: string | null,
  prompt_cache_key?: string | null,
  truncation?: truncationEnumSchema,
  instructions?: string | null,
  store?: boolean,
  service_tier?: serviceTierEnumSchema,
  top_logprobs?: number | null,
}
```

## 13. Основной ответ: `responseResourceSchema`

```typescript
{
  id: string,
  object: "response",
  created_at: number,
  completed_at: number | null,
  status: string,
  incomplete_details: incompleteDetailsSchema | null,
  model: string,
  previous_response_id: string | null,
  instructions: string | null,
  output: itemField[],
  error: errorSchema | null,
  tools: functionToolSchema[],
  tool_choice: functionToolChoiceSchema | toolChoiceValueEnumSchema | allowedToolChoiceSchema,
  truncation: truncationEnumSchema,
  parallel_tool_calls: boolean,
  text: textFieldSchema,
  top_p: number,
  presence_penalty: number,
  frequency_penalty: number,
  top_logprobs: number,
  temperature: number,
  reasoning: reasoningSchema | null,
  usage: usageSchema | null,
  max_output_tokens: number | null,
  max_tool_calls: number | null,
  store: boolean,
  background: boolean,
  service_tier: string,
  metadata: any,
  safety_identifier: string | null,
  prompt_cache_key: string | null,
}
```

## 14. Статистика

- **Всего схем**: ~100+
- **Все сгенерированы Kubb** из OpenAPI-спецификации
- **Не редактировать вручную** — во всех файлах заголовок `Do not edit manually.`
- **Зависимости**: только `zod` (импорт из `"zod"`)
- **Использование TypeScript**: `z.infer<typeof someSchema>` для вывода типов
