# Phase 2.5 — Техническая документация

**Версия:** SOBA 0.3.5

---

## 1. ProviderRegistry

> **Статус:** ✅ Реализовано (A1)

### 1.1. Структура файлов

```
src/
├── core/
│   └── provider/
│       ├── registry.ts           # ProviderRegistry — регистр провайдеров
│       ├── providers.ts          # 4 встроенных провайдера (B1d slim list)
│       ├── client-proxy.ts       # OpenResponsesClientProxy
│       ├── discovery.ts          # Runtime discovery моделей через /v1/models
│       └── types.ts              # ProviderDefinition, ModelDefinition
├── widgets/
│   └── tui/
│       ├── model/
│       │   └── provider-store.ts # Solid-стор поверх ProviderRegistry
│       └── ui/
│           └── model-selector.tsx # Overlay выбора модели (✅ B1a)
```

### 1.2. ProviderRegistry

> Реальные сигнатуры сверены с `src/core/provider/registry.ts`.

```typescript
class ProviderRegistry {
  constructor(private config: Config) {}

  // Получить список всех провайдеров
  getAllProviders(): ProviderDefinition[]

  // Получить активного провайдера
  getActiveProvider(): ProviderDefinition

  // Получить активную модель
  getActiveModel(): ModelDefinition

  // Переключиться на провайдер/модель
  switchModel(providerId: string, modelId: string): OpenResponsesClient | null

  // Протестировать соединение
  async testConnection(providerId: string, modelId: string): Promise<TestResult>

  // Добавить кастомного провайдера
  addProvider(provider: ProviderDefinition): void

  // Удалить провайдера (возвращает true если удалён, false если не найден)
  removeProvider(id: string): boolean

  // Создать/получить OpenResponsesClient для провайдера/модели
  getClient(providerId: string, modelId: string): OpenResponsesClient

  // Персистентность
  loadFromFile(config: Config): void
  async persistConfig(): Promise<void>
}

// Результат тестирования соединения
interface TestResult {
  ok: boolean;
  latencyMs?: number;     // Latency в миллисекундах (round-trip) при ok
  error?: string;          // Сообщение об ошибке при !ok
  statusCode?: number;     // HTTP status code при HTTP-ошибке
}

```

### 1.3. OpenResponsesClientProxy

```typescript
class OpenResponsesClientProxy implements OpenResponsesClient {
  constructor(private registry: ProviderRegistry) {}

  // Делегирует к текущему клиенту из registry
  async create(items: Item[], options: CreateOptions): Response

  // Делегирует к текущему клиенту из registry  
  async createStreaming(items: Item[], options: CreateOptions): Stream
}
```

**Почему proxy вместо прямого доступа к registry:**
- AgentLoop не должен знать о мультипровайдерности
- Proxy — минимальный слой, удовлетворяющий OpenResponsesClient interface
- При /model set меняется клиент внутри proxy, loop не реконфигурируется

### 1.4. Конфигурация

ProviderRegistry сохраняет конфиг в `~/.soba/config.json`.

> **⚠ Безопасность:** `apiKey` в примере ниже — **placeholder**. В реальном конфиге API-ключи
> **не хранятся в plaintext**. Ключи загружаются через `resolveApiKey()` — из env-переменной
> (например, `DEEPSEEK_API_KEY`) или из защищённого хранилища. Никогда не коммитьте реальные
> ключи в `config.json`.

```json
{
  "activeProvider": "deepseek",
  "activeModel": "deepseek-chat",
  "providers": {
    "deepseek": {
      "apiKey": "...",
      "baseUrl": "https://api.deepseek.com"
    }
  },
  "customProviders": {
    "my-llm": {
      "id": "my-llm",
      "name": "My Local LLM",
      "baseUrl": "http://localhost:8080/v1",
      "apiKeyEnv": null,
      "adapter": "openai",
      "defaultModel": "my-model-v1",
      "models": [
        { "id": "my-model-v1", "name": "My Model v1", "contextWindow": 8192, "maxOutput": 4096, "supportsStreaming": true, "supportsThinking": false }
      ]
    }
  }
}
```

> **B1e notes:**
> - Поле `selectedModels` в реестре **не персистится** (ранее было, теперь нет). Каталог built-in провайдеров приходит из runtime discovery.
> - `SobaConfig.contextWindow` и `SobaConfig.maxOutputTokens` **не хранятся в `config.json`**. Они вычисляются из активной модели при `loadConfig()`.
> - Подробный разбор: `docs/phase-2-b1e-config-cleanup/`.

### 1.5. Provider Definition: Пример

```typescript
// B1d slim list — built-in providers не несут хардкоженный `models[]`.
// Встроенные провайдеры не имеют `defaultModel` — модель выбирается через discovery.
export const DEEPSEEK: ProviderDefinition = {
  id: "deepseek",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  adapter: "openai",
};

// Custom provider (added via `soba provider add`) — несёт полный `models[]`.
export const MY_LLM: ProviderDefinition = {
  id: "my-llm",
  name: "My Local LLM",
  baseUrl: "http://localhost:8080/v1",
  apiKeyEnv: null,
  adapter: "openai",
  defaultModel: "my-model-v1",
  models: [
    { id: "my-model-v1", name: "My Model v1", contextWindow: 8192, maxOutput: 4096, supportsStreaming: true, supportsThinking: false },
  ],
};
```

---

## 2. Notification System

> **Статус:** 🚧 [PLANNED] — задача A2, не реализовано.
> API ниже — проектное, может измениться при реализации.

### 2.1. NotificationStore

```typescript
interface Notification {
  id: string;
  type: "success" | "warning" | "error" | "info";
  title: string;
  message: string;
  timestamp: number;
  dismissAfter?: number; // ms, 0 = manual dismiss only
}

class NotificationStore {
  private visible: Notification[];
  private history: Notification[];
  private maxVisible = 3;

  notify(n: Omit<Notification, "id" | "timestamp">): void
  dismiss(id: string): void
  getVisible(): Notification[]
  getHistory(): Notification[]
  clearHistory(): void
}
```

### 2.2. Notification Colors

| Type | Icon  | Color  | Dismiss |
|------|-------|--------|---------|
| success | ✓ | green (#22c55e) | 5s |
| warning | ⚠ | yellow (#eab308) | 10s |
| error | ✗ | red (#ef4444) | 10s |
| info | ℹ | blue (#3b82f6) | 5s |

### 2.3. Интеграция с событиями

```typescript
// agent-loop.ts → NotificationCenter
eventBus.on("compaction:complete", () => {
  notify({ type: "success", title: "Compaction complete", message: "Context reduced by 60%" });
});

eventBus.on("skill:activated", (name) => {
  notify({ type: "info", title: `Skill "${name}" activated` });
});

eventBus.on("api:error", (err) => {
  notify({ type: "error", title: "API Error", message: err.message });
});
```

---

## 3. TrustDialog

> **Статус:** 🚧 [PLANNED] — задача A3, не реализовано.
> API ниже — проектное, может измениться при реализации.

### 3.1. Интерфейс

```typescript
// ⚠ enum запрещён AGENTS.md — используем const-объект + union type
const TrustDialogChoice = {
  DENY: "deny",
  ALLOW_ONCE: "allow_once",
  ALLOW_SESSION: "allow_session",
  ALLOW_REPO: "allow_repo",
} as const;
type TrustDialogChoice = (typeof TrustDialogChoice)[keyof typeof TrustDialogChoice];

interface TrustDialogOptions {
  command: string;          // Отображаемая команда
  reason: string;           // Почему dangerous
  defaultChoice: TrustDialogChoice; // Всегда DENY
}

// Результат диалога
type TrustDialogResult = TrustDialogChoice;
```

### 3.2. Интеграция

```typescript
// В TrustManager:
class TrustManager {
  private dialogManager?: TrustDialogManager; // Опционально (только TUI)

  async confirmDangerous(cmd: string, reason: string): Promise<TrustResult> {
    if (this.dialogManager) {
      const choice = await this.dialogManager.show({
        command: cmd,
        reason: reason,
        defaultChoice: TrustDialogChoice.DENY,
      });
      return this.mapChoice(choice);
    }
    // fallback на текстовый y/s/r/n
    return this.confirmTextual(cmd);
  }

  private mapChoice(choice: TrustDialogChoice): TrustResult {
    switch (choice) {
      case TrustDialogChoice.DENY:               return { allow: false, scope: null };
      case TrustDialogChoice.ALLOW_ONCE:         return { allow: true, scope: "once" };
      case TrustDialogChoice.ALLOW_SESSION:      return { allow: true, scope: "session" };
      case TrustDialogChoice.ALLOW_REPO:         return { allow: true, scope: "repo" };
    }
  }
}
```

---

## 4. Slash Commands Registry

> **Статус:** 🚧 [PLANNED] — задача A4, не реализовано.
> Текущий `src/core/skills/slash-handler.ts` обрабатывает только `/skill:<name>` команды.
> Интеграция с TUI-командами будет добавлена после реализации A4.

### 4.1. SlashCommand Interface

```typescript
interface SlashCommand {
  name: string;
  description: string;
  usage?: string;
  aliases?: string[];
  subcommands?: SlashSubcommand[];
  handler?: (args: string[]) => Promise<void>;
}

interface SlashSubcommand {
  name: string;
  usage: string;
  description: string;
}

// Registry
class SlashCommandsRegistry {
  private commands = new Map<string, SlashCommand>();

  register(cmd: SlashCommand): void
  get(name: string): SlashCommand | undefined
  getAll(): SlashCommand[]
  has(name: string): boolean
}
```

### 4.2. Integration with existing handler

> **Статус:** 🚧 [PLANNED] — текущий `slash-handler.ts` обрабатывает только `/skill:<name>`.
> Fallback в TUI registry будет добавлен в задаче A4.

```typescript
// src/core/skills/slash-handler.ts
// Паттерн: try core → fallback to tui registry
async function handleSlashCommand(input: string): Promise<boolean> {
  const parts = input.slice(1).split(/\s+/);
  const cmdName = parts[0];

  // 1. Проверка core skills commands
  if (coreCommands.has(cmdName)) {
    return coreCommands.get(cmdName)!.handler(parts.slice(1));
  }

  // 2. Fallback в tui registry
  if (tuiRegistry.has(cmdName)) {
    return tuiRegistry.get(cmdName)!.handler!(parts.slice(1));
  }

  return false;
}
```

---

## 5. ModelSelector

> **Статус:** ✅ Реализовано (B1a)

### 5.1. Структура TUI

```
┌─────────────────────────────────────┐
│ Select Model                         │
│                                     │
│ ┌─ Provider Group ──────────────┐   │
│ │ ○ model-1             128k    │   │
│ │ ● model-2 (current)   200k    │   │
│ └──────────────────────────────┘   │
│ ┌─ Provider Group 2 ───────────┐   │
│ │ ○ model-3             200k    │   │
│ └──────────────────────────────┘   │
│                                     │
│ Search: > _____                     │
└─────────────────────────────────────┘
```

### 5.2. ProviderStore (Solid)

> **Реальная реализация:** `src/widgets/tui/model/provider-store.ts`.
> Использует сигналы Solid (`createSignal`, `createMemo`) для реактивности.

```typescript
class ProviderStore {
  // Сигналы Solid (реактивные)
  private providers: Accessor<ProviderDefinition[]>;
  private activeProviderId: Accessor<string>;
  private activeModelId: Accessor<string>;
  private isOpen: Accessor<boolean>;
  private searchQuery: Accessor<string>;
  private highlightedIndex: Accessor<number>;

  // Computed (createMemo)
  filteredGroups: Accessor<Array<{ provider: ProviderDefinition; models: ModelDefinition[] }>>;
  flatFilteredModels: Accessor<ModelDefinition[]>;
  currentModel: Accessor<{ providerId: string; modelId: string; name: string }>;

  constructor(registry: ProviderRegistry, proxy: OpenResponsesClientProxy)

  // Методы
  open(): void
  close(): void
  toggle(): void
  setSearch(q: string): void
  moveHighlight(delta: 1 | -1): void
  resetHighlight(): void
  select(providerId: string, modelId: string): boolean
  dispose(): void
}
```

---

## 6. Enhanced Sidebar

> **Статус:** 🚧 [PLANNED] — задача C1, не реализовано.
> API ниже — проектное, может измениться при реализации.

### 6.1. Новые секции

```typescript
interface SidebarSection {
  id: string;
  title: string;
  collapsible: boolean;
  collapsed: boolean;
  render: () => JSX.Element;
}

// Регистрируются в Sidebar:
const sections: SidebarSection[] = [
  { id: "context", title: "Context", collapsible: true, collapsed: false, render: ContextBar },
  { id: "session", title: "Session", collapsible: true, collapsed: false, render: SessionInfo },
  { id: "skills", title: "Active Skills", collapsible: true, collapsed: false, render: SkillsList },
  { id: "model", title: "Model", collapsible: true, collapsed: false, render: ModelInfo },
  { id: "permissions", title: "Permissions", collapsible: true, collapsed: false, render: PermissionsInfo },
  { id: "changes", title: "Changes", collapsible: true, collapsed: false, render: ChangesTracker },
];
```

### 6.2. ContextBar

```typescript
function ContextBar({ usage, total }: { usage: number; total: number }) {
  const percent = Math.round((usage / total) * 100);
  const color = percent < 60 ? "green" : percent < 85 ? "yellow" : "red";
  const bar = progressBar(percent, 10); // "████████░░"
  return (
    <div>
      <div class={color}>{bar} {percent}%</div>
      <div class="small">{formatTokens(usage)} / {formatTokens(total)}</div>
    </div>
  );
}
```

---

## 7. Collapsible Tool Results

> **Статус:** 🚧 [PLANNED] — задача B2, не реализовано.
> API ниже — проектное, может измениться при реализации.

### 7.1. ToolResultBlock

```typescript
interface ToolResultBlockProps {
  tool: string;           // "read" | "write" | "edit" | "bash" | "ls"
  args: ToolArgs;
  result: ToolResult;
  duration: number;       // ms
  defaultCollapsed?: boolean;
}

function ToolResultBlock(props: ToolResultBlockProps) {
  const shouldAutoExpand =
    props.tool === "bash" && props.result.exitCode !== 0;

  const [collapsed, setCollapsed] = createSignal(
    props.defaultCollapsed ?? !shouldAutoExpand
  );

  return (
    <div class="tool-result">
      <div class="tool-header" onClick={() => setCollapsed(!collapsed())}>
        {collapsed() ? "▶" : "▼"} {props.tool}: {getSummary(props)}
      </div>
      <Show when={!collapsed()}>
        <div class="tool-body">
          {renderBody(props.tool, props.result)}
        </div>
      </Show>
    </div>
  );
}
```

### 7.2. Summary by tool type

| Tool | Summary |
|------|---------|
| read | `path`, `size: 72KB`, `lines: 2016` |
| write | `path`, `size: 1.2KB` |
| edit | `path`, `3 edits` (diff подсветка) |
| bash | `command`, `exit code: 0`, `output: 3 lines` |
| ls | `path`, `12 entries` |

---

## 8. Search Overlay

> **Статус:** 🚧 [PLANNED] — задача B4, не реализовано.
> API ниже — проектное, может измениться при реализации.

### 8.1. SearchEngine

```typescript
class SearchEngine {
  private messages: Message[];

  constructor(messages: Message[])

  search(query: string): SearchResult[] {
    const lower = query.toLowerCase();
    return this.messages.flatMap((msg, idx) => {
      if (msg.text.toLowerCase().includes(lower)) {
        const turn = msg.metadata?.turn ?? 0;
        return [{ messageIndex: idx, turn, text: msg.text, match: query }];
      }
      return [];
    });
  }
}
```

### 8.2. SearchResult

```typescript
interface SearchResult {
  messageIndex: number;
  turn: number;
  text: string;         // Полный текст для показа
  match: string;        // Поисковый запрос для подсветки
}
```

---

## 9. Session Browser ❌ Исключено

> **Статус:** ❌ [EXCLUDED] — задача C2 исключена, откачена (3 revert-коммита).

---

## 10. Hotkeys Registry

> **Статус:** 🚧 [PLANNED] — задача B5, не реализовано.
> API ниже — проектное, может измениться при реализации.

### 10.1. Hotkey Action Registry

```typescript
interface HotkeyAction {
  key: string;       // "ctrl+f", "?", "escape"
  description: string;
  handler: () => void;
  category: "general" | "navigation" | "input";
}

class HotkeyRegistry {
  private actions: HotkeyAction[];

  register(action: HotkeyAction): void
  getByCategory(category: string): HotkeyAction[]
  getAll(): HotkeyAction[]
  find(key: string): HotkeyAction | undefined
}
```

### 10.2. Phase 2.5 Hotkeys

| Key | Action | Category |
|-----|--------|----------|
| `Ctrl+F` | Search Overlay | navigation |
| `?` | Hotkeys Help | general |
| `Escape` | Close overlay | general |
| `Tab` / `Shift+Tab` | Navigate buttons | input |

---

## 11. Интеграция с AgentLoop

AgentLoop **не модифицируется** в Phase 2.5. Все изменения — в TUI-слое:

```
AgentLoop (нетронут)
    │
    ▼
ProviderRegistry ──► OpenResponsesClientProxy ──► Provider API
    │                       │
    │                       ▼ (делегирует на активный клиент)
    │              deepseek / kimi / alibaba / openrouter ...
    │
    ▼
EventBus ──► NotificationCenter
    │
    ▼
TrustManager ──► TrustDialog (если TUI mode)
    │
    ▼
SessionManager
```

---

## 12. Тестирование

### 12.1. Структура тестов

> **Existing (✅):**
> - `tests/core/provider/registry.test.ts` — ProviderRegistry
> - `tests/core/provider/client-proxy.test.ts` — OpenResponsesClientProxy
> - `tests/core/provider/providers.test.ts` — 4 встроенных провайдера
> - `tests/widgets/tui/provider-store.test.ts` — ProviderStore (Solid)
> - `tests/cli/provider-cli.test.ts` — `soba provider` CLI
>
> **Planned (🚧):**

```
tests/
├── core/
│   └── provider/
│       ├── registry.test.ts         # ✅ ProviderRegistry
│       ├── client-proxy.test.ts     # ✅ OpenResponsesClientProxy
│       └── providers.test.ts        # ✅ 4 встроенных провайдера
├── cli/
│   └── provider-cli.test.ts         # ✅ soba provider CLI
├── widgets/
│   └── tui/
│       ├── provider-store.test.ts   # ✅ ProviderStore
│       ├── notification.test.ts     # 🚧 NotificationCenter
│       ├── trust-dialog.test.ts     # 🚧 TrustDialog
│       ├── model-selector.test.ts   # 🚧 ModelSelector (новые тесты сверх B1a)
│       ├── tool-result-block.test.ts# 🚧 Collapsible Tool Results
│       ├── turn-separator.test.ts   # 🚧 Turn Separator
│       ├── search.test.ts           # 🚧 Search Overlay
│       ├── hotkeys-help.test.ts     # 🚧 Hotkeys Help
│       └── sidebar.test.ts          # 🚧 Enhanced Sidebar
```

### 12.2. ProviderRegistry тест-кейсы

1. **getAllProviders:** возвращает 4 встроенных провайдера + custom
2. **switchModel:** успешное переключение на существующую модель
3. **switchModel:** несуществующая модель → `false`
4. **switchModel:** несуществующий провайдер → `false`
5. **testConnection:** успех/фейл с моком
6. **persistConfig:** запись/чтение конфига
7. **addProvider:** кастомный провайдер доступен после добавления
8. **removeProvider:** провайдер удалён из списка
9. **getClient:** возвращает клиент для провайдера
10. **proxy delegation:** все методы делегированы

### 12.3. Состояние тестов после Phase 1 и Phase 2

```bash
# Phase 1
bun test pass: 256 tests

# Phase 2 (ожидается)
bun test pass: ~300 tests

# Phase 2.5 (текущее состояние)
bun test pass: 1054 tests (0 fail)
```
