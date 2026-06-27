# Phase 2.5 — TUI Polish & User Experience

**Runtime:** Bun
**Предыдущая фаза:** Phase 2 — Context Intelligence + Adaptive Skills (v0.3.x)
**Следующая фаза:** Phase 3 — Project Memory + Fix-Until-Green (v0.4.0)
**Scope:** User-friendly TUI, мультипровайдерность с переключением моделей, визуализация взаимодействия
**Не входит:** Project Memory, Fix-Until-Green, CI/CD Pipeline — Phase 3

## Статус реализации (2026-06-16)

| Компонент | Статус | Задача |
|---|---|---|
| ProviderRegistry + ClientProxy | ✅ Реализовано | A1 |
| ModelSelector (UI overlay) | ✅ Реализовано | B1a |
| ProviderStore (Solid) | ✅ Реализовано | B1a |
| `soba provider` CLI | ✅ Реализовано | B1c |
| Discovery (runtime /v1/models) | ✅ Реализовано | A1 (B1d) |
| NotificationCenter | 🚧 Планируется | A2 |
| TrustDialog | 🚧 Планируется | A3 |
| Slash Commands Registry | 🚧 Планируется | A4 |
| /model slash subcommands | 🚧 Планируется | B1b |
| test-connection notification | 🚧 Планируется | B1d |
| Collapsible Tool Results | 🚧 Планируется | B2 |
| Turn Separator | 🚧 Планируется | B3 |
| Search Overlay | 🚧 Планируется | B4 |
| Hotkeys Help | 🚧 Планируется | B5 |
| Enhanced Sidebar | 🚧 Планируется | C1 |
| ~~Session Browser~~ | ❌ Исключено | C2 |

> **Note:** API-описания ниже для 🚧 компонентов — **проектные** и могут измениться при реализации.

## Мотивация

Phase 1 заложила базовый TUI (OpenTUI, sidebar, message list, input). Phase 2 добавила мощное ядро
(proactive compaction, adaptive skills). Но пользовательский интерфейс остался минимальным.

Phase 2.5 посвящена **user experience**: сделать TUI дружелюбным, добавить мультипровайдеров
с выбором моделей, улучшить визуализацию всего взаимодействия.

**Ключевая идея:**

> SOBA должен быть не только умным, но и красивым, понятным и удобным инструментом,
> который легко настраивать под любого провайдера.

## Принципы

1. **UX > Features** — каждая новая фича должна улучшать восприятие инструмента.
2. **Zero-config мультипровайдерность** — переключение между провайдерами одной командой.
3. **Visible State** — пользователь всегда видит, что происходит: какой провайдер активен,
   сколько токенов использовано, какие скилы активны.
4. **Accessibility** — интерфейс понятен новому пользователю с первого взгляда.
5. **Обратная совместимость** — все новые UI-компоненты не ломают существующие workflows.

## Архитектурные изменения

Phase 2.5 добавляет новые TUI-слои к существующей архитектуре Phase 2:

```text
┌─────────────────────────────────────────────────────────┐
│                   Phase 2.5 Additions                     │
├─────────────────────────────────────────────────────────┤
│  + ProviderRegistry     — регистр провайдеров с моделями  │
│  + NotificationSystem   — система всплывающих уведомлений │
│  + TrustDialog          — визуальный диалог подтверждения │
│  + ContextVisualizer    — визуализация использования ctx  │
│  + SlashCommands        — registry для TUI-команд         │
├─────────────────────────────────────────────────────────┤
│                    Existing Phase 2                        │
├─────────────────────────────────────────────────────────┤
│  AgentLoop | ContextManager | SkillManager | SessionMgr  │
│  OpenResponsesClient | ProviderAdapter | TrustManager     │
└─────────────────────────────────────────────────────────┘
```

## Компоненты дизайна

### 2.5.1. ProviderRegistry + OpenResponsesClientProxy

Регистр предустановленных провайдеров с моделями. Позволяет переключаться между провайдерами
без модификации AgentLoop (через Proxy-паттерн).

```typescript
interface ProviderDefinition {
  id: string;                          // "deepseek", "kimi", "alibaba", "openrouter"
  name: string;                        // "DeepSeek"
  baseUrl: string;                     // API endpoint
  apiKeyEnv: string;                   // "DEEPSEEK_API_KEY"
  adapter: "openai" | "anthropic";     // Какой адаптер использовать
  /**
   * Models exposed by this provider. Optional — when undefined,
   * the registry discovers models at runtime from the provider's
   * /models endpoint. Custom providers save their list on disk.
   */
  models?: ModelDefinition[];
  /**
   * Default model id. Optional — for custom providers.
   * Built-in providers don't set this (model picked via discovery).
   */
  defaultModel?: string;
}

interface ModelDefinition {
  id: string;                      // "deepseek-chat"
  name: string;                    // "DeepSeek Chat"
  contextWindow: number;           // 128000
  maxOutput: number;               // 8192
  supportsStreaming: boolean;
  supportsThinking: boolean;
}
```

**Предустановленные провайдеры (B1d slim list):**

| ID | Name | Default / Seed | API Key Env |
|---|---|---|---|
| `deepseek` | DeepSeek | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| `kimi` | Moonshot Kimi (K2 for code) | `kimi-k2-0711-preview` | `MOONSHOT_API_KEY` |
| `alibaba` | Alibaba Qwen (Singapore) | `qwen3-coder-plus` | `DASHSCOPE_API_KEY` |
| `openrouter` | OpenRouter | `auto` | `OPENROUTER_API_KEY` |

> **B1d/B1e note:** Built-in providers больше не несут хардкоженный список
> моделей. Реальный каталог подтягивается discovery'ом (`src/core/provider/discovery.ts`),
> кэш in-memory. `SobaConfig.contextWindow` и `SobaConfig.maxOutputTokens`
> вычисляются из активной модели, не читаются с диска. Полный flow см.
> в `docs/phase-2-b1e-config-cleanup/`.
>
> **`supportsThinking` default:** При discovery через `/v1/models` поле может отсутствовать
> в ответе провайдера. В таком случае `supportsThinking` дефолтно = `false`.

**OpenResponsesClientProxy** — proxy-клиент, делегирующий к актуальному клиенту из ProviderRegistry.
AgentLoop получает прокси в конструкторе и не знает о переключениях.

### 2.5.2. NotificationCenter

Система уведомлений — неблокирующий overlay в правом нижнем углу терминала.

```
┌──────────────────────────────────────┐
│  ✓ Skill "commit-message" activated  │
│  ⚠ Context usage: 85% — approaching │
│  ✗ API error: rate limit exceeded    │
└──────────────────────────────────────┘
```

**Типы уведомлений:**
- `success` — зелёный (✓): компакция, скил активирован
- `warning` — жёлтый (⚠): приближение к hard limit, trust change
- `error` — красный (✗): API error, compaction failed
- `info` — голубой (ℹ): смена модели, начало компакции

**Поведение:**
- Авто-исчезают через 5s (success/info) или 10s (warning/error)
- Escape закрывает
- Макс 3 видимых одновременно
- История доступна через `/notifications`

### 2.5.3. TrustDialog

Визуальный диалог для подтверждения опасных операций вместо текстового y/n/s/r.

```
┌─────────────────────────────────────────────┐
│ ⚠ Dangerous Command                         │
│                                             │
│  rm -rf node_modules && rm -rf .git         │
│                                             │
│  Reason: This may cause data loss           │
│                                             │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐   │
│  │ Allow    │ │ Allow    │ │ Allow     │   │
│  │ Once     │ │ Session  │ │ Repo      │   │
│  ├──────────┤ ├──────────┤ ├───────────┤   │
│  │ Deny     │ │          │ │           │   │
│  └──────────┘ └──────────┘ └───────────┘   │
│                                             │
│  Tab to navigate, Enter to select           │
└─────────────────────────────────────────────┘
```

**Поведение:**
- Модальный overlay поверх содержимого
- Фокус на Deny (безопасный выбор по умолчанию)
- Tab/SHIFT+Tab для навигации по кнопкам
- Enter для выбора, Escape = Deny
- y/s/r/n работают (обратная совместимость)

### 2.5.4. ModelSelector

Меню выбора модели, вызываемое через `/model list` или клик по модели в сайдбаре.

```
┌─────────────────────────────────────┐
│ Select Model                         │
│                                     │
│ ┌─ DeepSeek ─────────────────────┐  │
│ │ ○ deepseek-chat           128k │  │
│ │ ● deepseek-reasoner       128k │  │
│ └──────────────────────────────┘   │
│ ┌─ Moonshot Kimi ──────────────┐   │
│ │ ○ kimi-k2-0711-preview   128k │   │
│ │ ○ kimi-latest            256k │   │
│ └──────────────────────────────┘   │
│ ┌─ Alibaba Qwen ───────────────┐   │
│ │ ○ qwen3-coder-plus       128k │   │
│ └──────────────────────────────┘   │
│ ┌─ OpenRouter ────────────────┐   │
│ │ ○ auto                   n/a │   │
│ │ ○ anthropic/claude-...  200k │   │
│ └──────────────────────────────┘   │
│                                     │
│ Tab/↑↓ to navigate, Enter to select│
│ /model set <name> also works       │
└─────────────────────────────────────┘
```

> **B1d/B1e note:** Когда discovery ещё не запускался, picker показывает
> одну synthetic-запись из `defaultModel` (если задан у провайдера).
> — этого достаточно, чтобы юзер мог выбрать стартовую модель и запустить
> discovery. После discovery группы наполняются реальным каталогом.

**Поведение:**
- Группировка по провайдерам
- Показывает размер контекстного окна
- Текущая модель отмечена (●)
- Поиск по названию
- После выбора: проверка API ключа → переключение клиента → тестовый запрос → уведомление

**Discovery error handling (обработка ошибок):**

| Ситуация | Поведение |
|---|---|
| `/v1/models` вернул ошибку (таймаут, 401, 403, DNS) | Selector показывает только synthetic-записи из `defaultModel`. Статус-бар отображает ⚠. Пользователь может переоткрыть selector для retry |
| Провайдер не поддерживает `/v1/models` endpoint | Fallback на synthetic-запись из `defaultModel` |
| Модель выбрана, discovery ещё не завершился | `switchModel` работает с synthetic-записью — без блокировки UI |
| Discovery вернул пустой список моделей | Selector показывает `[DRAFT]`-сообщение "No models discovered, check API key / network" |

### 2.5.5. Enhanced Sidebar

Улучшенный сайдбар с новыми секциями.

```
┌────────────────┐
│ Project        │
│ ~/my-project   │
│ ├─ src/        │
│ └─ docs/       │
│                │
│ Context        │
│ ████████░░░░ 72%│
│ 184k / 256k    │
│                │
│ Session        │
│ Tokens: 184.2k │
│ Turns: 12      │
│ Chkpt: ck_3a7f │
│                │
│ Active Skills  │
│ ● commit-msg   │
│ ● git-summary  │
│                │
│ Model          │
│ ● deepseek-chat│
│   ▸ Switch     │
│                │
│ Permissions    │
│ ● Ask mode     │
│   ▸ Change     │
│                │
│ Changes        │
│ src/cli.ts +42 │
│ src/core/ -5   │
└────────────────┘
```

**Улучшения:**
- **Context usage bar** — визуальный progress bar (зелёный <60%, жёлтый 60-85%, красный >85%)
- **Active Skills** — список с иконками
- **Model info** — текущая модель с кнопкой переключения
- **Permissions** — текущий режим с быстрым переключением
- **Collapsible секции** — сворачивание/разворачивание
- **Resizable** — настраиваемая ширина

### 2.5.6. Collapsible Tool Results

Улучшенный рендер результатов выполнения тулов.

```
┌─ read: src/core/agent-loop.ts ──────────────────
│ path: src/core/agent-loop.ts
│ size: 2016 lines, 72KB
│
│ [▼ show content (2000 lines)]                    ← сворачиваемо
│
└─ ✓ read completed  120ms
```

**Поведение:**
- Результаты read/write/bash по умолчанию свёрнуты (summary)
- Клик/Enter на заголовке — toggle
- Результаты edit — diff с подсветкой
- bash с exit code != 0 — автоматически развёрнут
- Макс 10 строк видно в свёрнутом состоянии

### 2.5.7. Turn Visual Separator

Визуальное разделение между turns в истории сообщений.

```
───────────────────────────────────── Turn 12 ──────────────────────────────────────
```

**Поведение:**
- Разделитель с номером turn
- Цвета чередуются между turns
- Возможность свернуть turn целиком

### 2.5.8. Search Overlay

Поиск по истории сообщений (Ctrl+F или `/search`).

```
┌─ Search ──────────────────────────────────┐
│ > compact                                │
│                                          │
│ 3 of 12 matches                          │
│                                          │
│ ─── Turn 5 ───                           │
│ > ...запустил компакцию...               │
│                                          │
│ ↑↓ navigate, Enter to jump, Esc to close│
└──────────────────────────────────────────┘
```

### 2.5.9. Hotkeys Help Overlay

Справка по горячим клавишам (по `?`).

```
┌─────────────────────────────────────────────┐
│ Keyboard Shortcuts                   [Esc]  │
│                                             │
│ General                                     │
│  Ctrl+C        Cancel current operation     │
│  Ctrl+L        Clear screen                 │
│  ?             Show this help               │
│                                             │
│ Navigation                                  │
│  ↑/↓           History (in input)           │
│  PgUp/PgDn     Scroll messages              │
│                                             │
│ Input                                       │
│  Enter          Submit message               │
│  Shift+Enter    Newline                      │
│ ─────────────────────────────────────────    │
│ Press any key to close                       │
└─────────────────────────────────────────────┘
```

### 2.5.10. Session Browser ❌ Исключено

Просмотр и управление сессиями (`/sessions`) — исключено из scope, откачено.

## Команды Phase 2.5

| Команда | Описание |
|---|---|
| `/model list` | Показать список провайдеров и моделей |
| `/model set <provider/model>` | Переключиться на модель |
| `/model test` | Протестировать текущего провайдера |
| `/notifications` | Показать историю уведомлений |
| `/search <query>` | Поиск по истории сообщений |

## Производительность

| Метрика | Target | Допуск |
|---|---|---|
| Notification latency | < 5ms от события до рендера | +10ms |
| Model switch time | < 2s (включая тест) | +1s на ошибку |
| Search response time | < 100ms для 1000 сообщений | +50ms |
| Trust dialog render | < 5ms | +5ms |
| Context bar update | < 5ms | +5ms |

## Зависимости от предыдущих фаз

| Компонент | Зависит от Phase 1/2 |
|---|---|
| ProviderRegistry | ProviderAdapter, OpenResponsesClient (Phase 1/2) |
| ModelSelector | ProviderRegistry (Phase 2.5) |
| Notifications | AgentEvent pipeline (Phase 1) |
| TrustDialog | TrustManager, DangerousConfirmationEvent (Phase 1) |
| Sidebar improvements | TuiStore, AgentEvent (Phase 1/2) |
| Collapsible tool results | MessageList + TuiStore (Phase 1/2) |
| Search | TuiStore.messages (Phase 1) |
| ~~Session Browser~~ | Исключено |
| Context Visualizer | BudgetTracker (Phase 1) |

## Что не входит в Phase 2.5

- **Project Memory** (Knowledge Store, Capsules, Entity Graph) — Phase 3
- **Fix-Until-Green** — Phase 3
- **CI/CD Pipeline** — Phase 3
- **Visual Layer** (headless-браузер) — Phase 4
- **Multi-Agent orchestration** — Phase 4
- **Codebase Intelligence (RAG)** — Phase 4
