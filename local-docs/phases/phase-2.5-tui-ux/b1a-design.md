# B1a Design — ModelSelector UI + provider-store

**Scope:** Визуальный выбор модели в TUI без slash-команды. Зависит только от A1 (✅).
Slash-команды (`/model list/set/test`) и notification после testConnection — отложены в B1b/B1c.

## Архитектура

```
TuiStore ──► ProviderStore (новый)
                 │
                 ├─ providers: Accessor<ProviderDefinition[]>
                 ├─ activeProviderId / activeModelId: Accessor<string>
                 ├─ isOpen: Accessor<boolean>
                 ├─ searchQuery: Accessor<string>
                 ├─ filteredGroups: Accessor<Group[]>
                 ├─ highlightedIndex: Accessor<number>
                 ├─ open() / close() / toggle()
                 ├─ setSearch(q) / moveHighlight(±1) / resetHighlight()
                 └─ select(providerId, modelId) → boolean
                       │
                       ▼
                 registry.switchModel(providerId, modelId) → client | null
                       │
                       ▼ (success)
                 proxy.onChange(handler) → store.setModel + persist
```

## ProviderStore

Реактивный стор, оборачивающий `ProviderRegistry` и `OpenResponsesClientProxy`.

**State (сигналы Solid):**
- `providers` — все провайдеры (встроенные + кастомные)
- `activeProviderId` / `activeModelId` — текущая пара
- `isOpen` — открыт ли overlay
- `searchQuery` — текст в input
- `highlightedIndex` — индекс в плоском списке отфильтрованных моделей

**Computed:**
- `filteredGroups` — `Array<{ provider, models: ModelDefinition[] }>`, отфильтрованные по search
- `flatFilteredModels` — для клавиатурной навигации
- `currentModel` — `{ providerId, modelId, name }` (удобно для header)

**Methods:**
- `open() / close() / toggle()`
- `setSearch(q: string)`
- `moveHighlight(delta: 1 | -1)` — по плоскому списку
- `select(providerId, modelId): boolean` — вызывает `registry.switchModel`, при успехе обновляет signals + `persistConfig()`

**Constructor:** `(registry: ProviderRegistry, proxy: OpenResponsesClientProxy)`

**Lifecycle:** при конструировании подписывается на `proxy.onChange()`, при `dispose()` — отписывается.

## ModelSelector component

```tsx
<box style={{ position: "absolute", ...centered }}>
  <box border backgroundColor={theme().panel} width={60} height={20}>
    <text>{title}</text>
    <textarea value={search()} onChange={setSearch} ... />  // search input
    <scrollbox flexGrow={1}>
      <For each={filteredGroups()}>
        {(group) => (
          <text>▼ {group.provider.name}{group.provider.id === activeProviderId() ? ` (${group.provider.models.find(m => m.id === activeModelId())?.name})` : ""}</text>
          <For each={group.models}>
            {(model, idx) => (
              <text fg={idx === highlight() ? theme().primary : theme().text}>
                {model.id === activeModelId() ? "● " : "  "}
                {model.name}  ({formatTokens(model.contextWindow)} ctx)
              </text>
            )}
          </For>
        )}
      </For>
    </scrollbox>
    <text>{hint}</text>  // ↑/↓ navigate · Enter select · Esc cancel
  </box>
</box>
```

**Поведение:**
- При открытии (`isOpen=true`) — input получает фокус, search очищается
- Каждый ввод в input фильтрует группы (case-insensitive по `id` + `name`)
- ↑/↓ — перемещение по плоскому списку (с wraparound)
- Enter — выбор текущей выделенной
- Esc — закрыть без изменений
- После выбора и успешного `switchModel` — overlay закрывается
- Если `switchModel` вернул null (несуществующая модель) — overlay остаётся, status-bar покажет ошибку

## Status-bar integration

В header сейчас `tui.header.model` показывает `Model: deepseek-chat` (B1d slim list). В B1a **не меняем header**, но добавляем
**hotkey Ctrl+M** для открытия ModelSelector. Это даёт пользователю мгновенный доступ без набора команды.

(В B1b slash-команда `/model` добавится через `commands/model-command.ts` после A4.)

## i18n ключи (добавляем)

| Ключ | en | ru | zh |
|---|---|---|---|
| `tui.modelSelector.title` | Select a model | Выберите модель | 选择模型 |
| `tui.modelSelector.search` | Search… | Поиск… | 搜索… |
| `tui.modelSelector.hint` | `↑/↓ navigate · Enter select · Esc cancel` | `↑/↓ навигация · Enter выбор · Esc отмена` | `↑/↓ 导航 · Enter 选择 · Esc 取消` |
| `tui.modelSelector.active` | `● {name}` | `● {name}` | `● {name}` |
| `tui.modelSelector.empty` | No models match "{query}" | Нет моделей по запросу "{query}" | 没有匹配 "{query}" 的模型 |
| `tui.modelSelector.switched` | Switched to {provider} / {model} | Переключено на {provider} / {model} | 已切换到 {provider} / {model} |
| `tui.modelSelector.failed` | Failed to switch model: {error} | Не удалось переключить модель: {error} | 切换模型失败：{error} |
| `tui.modelSelector.hotkey` | `Ctrl+M: model` | `Ctrl+M: модель` | `Ctrl+M: 模型` |
| `tui.modelSelector.customBadge` | `[custom]` | `[пользов.]` | `[自定义]` |
| `tui.modelSelector.contextShort` | `{tokens} ctx` | `{tokens} контекста` | `{tokens} 上下文` |
| `tui.modelSelector.unknown` | Unknown provider or model: {provider}/{model} | Неизвестный провайдер или модель: {provider}/{model} | 未知的提供商或模型：{provider}/{model} |
| `tui.modelSelector.failedSwitch` | Failed to switch to {provider} / {model} | Не удалось переключиться на {provider} / {model} | 切换到 {provider} / {model} 失败 |

## Что НЕ входит в B1a

- Slash-команды `/model list/set/test` (нужен A4 — реестр команд)
- Notification center после testConnection (нужна A2 — NotificationStore)
- Клик по модели в header (header не интерактивен в текущей реализации, hotkey Ctrl+M проще и быстрее)
- Группировка по `supportsThinking` (отложено — может стать шумом)

## Файлы

- `src/widgets/tui/model/provider-store.ts` — **новый**
- `src/widgets/tui/ui/model-selector.tsx` — **новый**
- `src/widgets/tui/hooks/use-tui-keys.ts` — добавить Ctrl+M
- `src/widgets/tui/ui/tui-app.tsx` — рендерить overlay когда `isOpen`
- `src/widgets/tui/index.tsx` — создать `ProviderStore`, передать в `TuiStore` (опционально) или подключить в `TuiApp`
- `locales/{en,ru,zh}.json` — добавить 12 ключей
- `tests/widgets/model-selector.test.ts` — **новый**
