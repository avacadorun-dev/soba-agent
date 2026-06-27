---
name: regression-runner
description: Автоматический прогон регресс-кейсов из docs/testing/regression-cases/. Выполняет unit-тесты, CLI-проверки и реальные API-вызовы. Сохраняет результаты в auto-result/ с датой.
---

# Regression Test Runner

Автоматический прогон регресс-кейсов для SOBA Agent. Читает кейсы из `docs/testing/regression-cases/`, выполняет проверки (unit-тесты, CLI-флаги, реальные API), сохраняет результаты с дата-префиксом.

## Когда использовать

- После завершения фазы разработки — прогнать все регресс-кейсы
- Перед релизом — убедиться что ничего не сломалось
- После крупных рефакторингов — проверить обратную совместимость
- По запросу разработчика — «прошей регресс», «regression run»

## Workflow

### 1. Подготовка (один раз)

```bash
# Убедиться что проект собран
bun run build

# Убедиться что тесты проходят
bun test

# Создать папку для результатов
DATE=$(date +%Y-%m-%d)
mkdir -p docs/testing/regression-cases/auto-result/$DATE

# Получить список файлов
ls docs/testing/regression-cases/*.md
```

> **💡 Совет:** Чтобы запускать только тесты затронутых модулей (а не все), построй dependency graph:
> ```bash
> bun run .soba/skills/ts-morph-analyzer/scripts/dependency-graph.ts
> ```
> Результат в `.soba/skills/ts-morph-analyzer/output/dependency-graph.json` — граф импортов между модулями, hubs (часто импортируемые файлы), связи `imports`/`importedBy`.

#### 1.1 Проверка подключения к API

Прочитать `~/.soba/config.json` и проверить подключение:

```bash
# Прочитать конфиг
read ~/.soba/config.json
```

Выполнить тестовый API-вызов:

```bash
bun run dist/cli.js --no-session --max-agent-iterations 1 "Say ok" 2>&1
```

**Если API работает** → продолжить прогон.

**Если API не работает** (ошибка подключения, invalid key, и т.д.) → запросить у пользователя:

1. URL API endpoint
2. API key
3. Модель

Сохранить в `~/.soba/config.json` и повторить тестовый вызов.

> **Важно:** Без рабочего API прогон регресса невозможен. Не пропускай API-кейсы — настрой подключение.

### 2. Пошаговый прогон (для каждого файла)

> **Правило:** один файл → один шаг. Не читать все файлы заранее.

Для **каждого** файла из `docs/testing/regression-cases/` выполнять цикл:

#### Шаг A: Прочитать файл

```bash
read docs/testing/regression-cases/<file>.md
```

- Извлечь заголовок, секции «Цель» и «Окружение»
- Определить тип каждого кейса по таблице классификации

#### Шаг B: Прогнать кейсы этого файла

| Тип | Действие |
|-----|----------|
| **Unit-тест** | `bun test tests/<module>/<file>.test.ts` → exit 0 = PASS, иначе FAIL |
| **CLI-флаг** | `bun run soba <флаги>` → grep ожидаемого паттерна → PASS/FAIL |
| **API-вызов** | `bun run soba "prompt" --no-session --max-agent-iterations <N> <флаги>` → ответ без ошибки = PASS |
| **TUI** | Сначала проверь TuiStore/OpenTUI Solid store покрытие (см. таблицу ниже). Если покрыто → PASS. Если требует реального TTY → SKIP_MANUAL. **SKIP_TUI больше не используется.** |
| **Manual** | Отметить как SKIP_MANUAL |

> **Правило:** `SKIP_API` запрещён. Все кейсы, которые не требуют TUI или ручного вмешательства, прогоняются с реальным API. Используй `--max-agent-iterations` для ограничения итераций (обычно 1–3 достаточно для проверки).

#### Шаг C: Сохранить результат

Записать результат в `docs/testing/regression-cases/auto-result/$DATE/<file>.md`:

```markdown
# Регресс-кейсы: <Название>

## Цель
<Из оригинального файла>

## Окружение
<Из оригинального файла>

## Кейсы

**PASS** Кейс 01: <описание>
**FAIL** Кейс 02: <описание> — <причина>
**SKIP_MANUAL** Кейс 03: <описание>

---

## Пропущенные кейсы

- **SKIP_MANUAL** Кейс 03: <описание> (причина: реальный TTY / key-коды / сигнал)

---

## FAIL — описание и баги

### Баг: Кейс 02: <описание>

**Статус:** Не исправлено
**Приоритет:** <Низкий/Средний/Высокий>
**Задача:** <Что нужно исправить>
```

> **Примечание:** SKIP_TUI не используется. Все TUI-кейсы: PASS (TuiStore/OpenTUI/CLI integration) или SKIP_MANUAL (реальный TTY).

#### Шаг D: Перейти к следующему файлу

Повторить шаги A–C для следующего файла. Не переходить к следующему, пока текущий не сохранён.

### 3. Итоговая статистика (после всех файлов)

```bash
cd docs/testing/regression-cases/auto-result/$DATE
echo "=== PASS ===" && grep -rh "^\*\*PASS\*\*" *.md | wc -l
echo "=== FAIL ===" && grep -rh "^\*\*FAIL\*\*" *.md | wc -l
echo "=== SKIP_MANUAL ===" && grep -rh "^\*\*SKIP_MANUAL\*\*" *.md | wc -l
echo "=== SKIP_TUI (should be 0!) ===" && grep -rh "^\*\*SKIP_TUI\*\*" *.md | wc -l
```

> SKIP_TUI должен быть 0 во всех регресс-файлах.

## Текущее TUI-покрытие (2026-06-15)

| Кейс | Тест | Статус |
|------|------|--------|
| `/clear` — очистка transcript | `tests/tui-pty.test.ts` (TuiStore) | PASS |
| `/compact` — ручная компакция | `tests/tui-pty.test.ts` (TuiStore) | PASS |
| `/rewind` — откат к чекпоинту | `tests/tui-pty.test.ts` (TuiStore) | PASS |
| `/capsule` — управление капсулами | `tests/tui-pty.test.ts` (TuiStore) | PASS |
| `/skill` — управление скилами | `tests/tui-pty.test.ts` (TuiStore) | PASS |
| `/project-trust` — доверие проектов | `tests/tui-pty.test.ts` (TuiStore) | PASS |
| `/help` — справка | `tests/tui-slash-commands.test.ts` | PASS |
| `/session` — инфо о сессии | `tests/tui-slash-commands.test.ts` | PASS |
| `/budget` — бюджет токенов | `tests/tui-slash-commands.test.ts` | PASS |
| `/exit` — выход | `tests/tui-slash-commands.test.ts` | PASS |
| ↑/↓ — история | `tests/tui-pty.test.ts` (historyNavigate) | PASS |
| Tab — автодополнение | `tests/widgets/tui/test-input-suggestions.test.ts` | PASS |
| Unicode ввод | `tests/tui-pty.test.ts` | PASS |
| Empty input | `tests/tui-pty.test.ts` | PASS |
| `--help`/`--version` | `tests/tui-pty.test.ts` (CLI integration) | PASS |
| `--lang ru/en/zh` | `tests/tui-pty.test.ts` (CLI integration) | PASS |
| `--theme aurora` | `tests/tui-pty.test.ts` (CLI integration) | PASS |
| `--model`, `--no-session`, `--debug` | `tests/tui-pty.test.ts` (CLI integration) | PASS |
| Streaming-ответ | `tests/widgets/tui/test-open-tui-store.test.ts` | PASS |
| Очередь сообщений | `tests/widgets/tui/test-open-tui-store.test.ts` | PASS |
| Shell-команды (`!`, `!!`) | `tests/widgets/tui/test-open-tui-store.test.ts` | PASS |
| Отмена (cancel) | `tests/widgets/tui/test-open-tui-store.test.ts` | PASS |
| Смена темы (/theme) | `tests/widgets/tui/test-open-tui-store.test.ts` | PASS |
| CHANGES panel (git) | `tests/widgets/tui/test-open-tui-store.test.ts` | PASS |
| Project trust header | `tests/widgets/tui/test-open-tui-store.test.ts` | PASS |
| Ctrl+C во время ответа | — | **SKIP_MANUAL** (сигнал, нужен TTY) |
| Ctrl+W/Ctrl+U | — | **SKIP_MANUAL** (key-коды) |
| Home/End/Ins | — | **SKIP_MANUAL** (key-коды) |
| Alt+Enter (multiline) | — | **SKIP_MANUAL** (key-коды) |
| Page Up/Down (скролл) | — | **SKIP_MANUAL** (рендеринг) |
| Resize терминала | — | **SKIP_MANUAL** (реальный TTY) |
| Узкий терминал (< 40 колонок) | — | **SKIP_MANUAL** (реальный TTY) |

## Шаблоны автоматизации TUI

> **ВАЖНО:** `@opentui/core` требует TTY для stdin, поэтому pipe-эмуляция (например, `echo "/exit" | soba -i`) **НЕ РАБОТАЕТ**. Bun `Bun.spawn({ terminal })` тоже не обрабатывает terminal capability queries `@opentui/core`. Правильный подход — тестировать `TuiStore` напрямую с mock `executeCommand`.

Для минимизации SKIP_MANUAL используй следующие шаблоны:

### 1. Прямое тестирование TuiStore для slash-команд

```typescript
import { TuiTestScenarios, assertMessageContains } from "../helpers/tui-stdin";

// Проверка /help
test("/help показывает доступные команды", async () => {
  const mock = await TuiTestScenarios.help();
  expect(mock.exitRequested).toBe(false);
  assertMessageContains(mock.store, "Доступные команды");
});

// Проверка /session
test("/session в свежей сессии не падает", async () => {
  const mock = await TuiTestScenarios.session();
  expect(mock.exitRequested).toBe(false);
  assertMessageContains(mock.store, /Session|Tokens/i);
});

// Проверка /budget
test("/budget показывает информацию", async () => {
  const mock = await TuiTestScenarios.budget();
  expect(mock.exitRequested).toBe(false);
  assertMessageContains(mock.store, /Budget|tokens/i);
});

// Проверка /exit
test("/exit завершает работу", async () => {
  const mock = await TuiTestScenarios.exit();
  expect(mock.exitRequested).toBe(true);
});
```

### 2. Кастомная обработка команд в тестах

```typescript
import { createMockTuiStore, assertMessageContains } from "../helpers/tui-stdin";

test("кастомная slash-команда", async () => {
  const mock = createMockTuiStore({
    customExecuteCommand: async (input, onOutput) => {
      if (input === "/custom") {
        onOutput?.({ type: "info", message: "Custom command executed" });
        return { handled: true, exit: false };
      }
      return { handled: false, exit: false, prompt: input };
    },
  });

  await mock.store.submit("/custom");
  expect(mock.exitRequested).toBe(false);
  assertMessageContains(mock.store, "Custom command executed");
});
```

### 3. Pre-configuration Trust Manager

```typescript
import { mockHomeTrustManager } from "../helpers/trust-setup";
import { createMockTuiStore } from "../helpers/tui-stdin";

test("dangerous command with pre-approved trust", async () => {
  const trustSetup = mockHomeTrustManager({
    autoApproveCommands: ["rm", "git push"],
  });

  try {
    const mock = createMockTuiStore();
    await mock.store.submit("rm -rf test.txt");
    // Проверить что команда была обработана без интерактивного запроса
    expect(mock.exitRequested).toBe(false);
  } finally {
    trustSetup.restore();
  }
});
```

### 4. Mock API серверы для сетевых условий

```typescript
import { RateLimitServer } from "../mocks/rate-limit-server";

test("rate limit handling", async () => {
  const server = new RateLimitServer({ port: 8081, maxRequests: 1 });
  const url = await server.start();

  try {
    // Настроить конфиг на использование мок-сервера
    // Выполнить запрос через API client напрямую, а не через TUI
    const client = new OpenResponsesClient({ baseUrl: url });
    // ... тестирование клиента
  } finally {
    await server.stop();
  }
});
```

### 5. PTY: Bun.spawn с terminal option (Bun 1.3.5+)

Для тестирования CLI-флагов через реальный PTY (проверка ANSI-вывода, инициализации терминала):

```typescript
import { describe, expect, test } from "bun:test";

const DIST_CLI = "dist/cli.js";

test("CLI в PTY с --help работает", async () => {
  let output = "";
  const proc = Bun.spawn(["bun", "run", DIST_CLI, "--help"], {
    terminal: {
      cols: 80,
      rows: 24,
      data(term, data) {
        output += typeof data === "string" 
          ? data 
          : Buffer.from(data).toString("utf-8");
      },
    },
    env: { ...process.env, TERM: "xterm-256color" },
  });

  const code = await Promise.race([
    proc.exited,
    new Promise((r) => setTimeout(() => r("timeout"), 5000)),
  ]);
  proc.terminal.close();

  if (code !== "timeout") {
    expect(code).toBe(0);
    expect(output.length).toBeGreaterThan(0);
  }
});
```

> **Ограничение:** `@opentui/core` отправляет запросы терминальных возможностей (DSR, kitty keyboard protocol). Bun Terminal не обрабатывает их полностью, поэтому **интерактивный TUI через PTY протестировать нельзя**. TUI-логика тестируется через TuiStore (см. шаблон 1).

---

## Правила классификации

### PASS
- Unit-тест прошёл (`bun test` exit code 0)
- CLI-флаг работает как ожидается (вывод содержит ожидаемый текст)
- API-вызов вернул ответ без ошибки

### FAIL
- Unit-тест упал
- CLI-флаг не работает (нет в --help, неправильный вывод)
- API-вызов вернул ошибку (не graceful error)
- Поведение не соответствует описанию кейса

### SKIP_TUI — НЕ ИСПОЛЬЗУЕТСЯ

> **Все TUI-кейсы должны быть либо PASS, либо SKIP_MANUAL.**
>
> TUI-логика тестируется программно через:
> - **TuiStore** + mock `executeCommand` — slash-команды, история, input
> - **OpenTUI Solid store** — streaming, очередь, shell-команды, темы
> - **CLI integration** — --help, --version, --lang, --theme (неинтерактивные)
>
> Если кейс покрыт этими тестами → **PASS**.
> Если кейс ТОЧНО требует реального TTY (Ctrl+C, resize, Home/End, Alt+Enter) → **SKIP_MANUAL**.
> 
> SKIP_TUI больше не существует во всех регресс-файлах.

### SKIP_MANUAL
- Кейс требует ручного тестирования (длительные сессии, моки, network conditions)
- Кейс требует интерактивного ввода (wizard, выбор сессии)
- Кейс требует специфического окружения (rate limit, content filter)
- Кейс требует реального TTY (Ctrl+C, resize, скролл, PageUp/PageDown, Home/End, Alt+Enter)
- **NOTA BENE:** Если кейс требует мока API-сервера (rate limit, slow response) — отметь SKIP_MANUAL и укажи какой мок-сервер из `tests/mocks/` нужен
- **Важно:** TUI-кейсы с горячими клавишами (↑/↓, Tab) — **НЕ** SKIP_MANUAL, они покрыты TuiStore. SKIP_MANUAL только для кейсов, где нужен сигнал (Ctrl+C), ресайз терминала, или key-коды, не воспроизводимые через TuiStore.

### SKIP_API — ЗАПРЕЩЁН

> **SKIP_API больше не используется.** Все кейсы, которые не требуют TUI или ручного вмешательства, должны быть прогнаны с реальным API.
>
- Если кейс проверяет поведение API-клиента → прогони с `--no-session --max-agent-iterations <N>`
- Если кейс проверяет обработку ошибок API → прогони с невалидным URL/key
- Если кейс требует мока сервера (rate limit, timeout) → отметь как SKIP_MANUAL

## Приоритеты багов

| Приоритет | Критерий |
|-----------|----------|
| **Высокий** | Критическая функциональность не работает (сборка, API, данные) |
| **Средний** | Функциональность работает частично или некорректно |
| **Низкий** | Косметические проблемы, устаревшие тест-кейсы |

## Формат SUMMARY.md

После прогона всех файлов создать `SUMMARY.md` со следующей структурой:

```markdown
# Регресс-прогон: Сводный отчёт

**Дата:** YYYY-MM-DD
**Версия:** <версия из package.json>
**Модель:** <использованная модель>
**Окружение:** <macOS/Linux арх, Bun-версия>
**Тип:** Автоматический (regression-runner skill)

---

## Общая статистика

| Метрика | Значение |
|---------|----------|
| Всего файлов | <N> |
| **PASS** | <число> |
| **FAIL** | <число> |
| **SKIP_MANUAL** | <число> |
| **SKIP_TUI** (должен быть 0) | 0 |
| Unit-тестов пройдено | <число> |
| Unit-тестов провалено | <число> |
| Mock API-сервер | есть/нет |

---

## Детализация по файлам

| # | Файл | Результат |
|---|------|-----------|
| 01 | example.md | 5 PASS, 1 FAIL, 2 SKIP_MANUAL |
| ... | ... | ... |

---

## TUI-покрытие (если есть TUI-файлы)

Какие unit-тесты покрывают TUI-кейсы, что НЕ покрыто (SKIP_MANUAL).

---

## Mock API-серверы (если есть)

Какие моки есть в `tests/mocks/` и для чего.

---

## Найденные баги (FAIL)

### 🔴 Баг #1: <название>
- **Файл:** <файл>, кейс <N>
- **Симптом:** <подробно>
- **Приоритет:** <Высокий/Средний/Низкий>
- **Воспроизведение:** <команда>

### ...

---

## Статус исправлений

| Баг | Статус | Приоритет |
|-----|--------|-----------|
| Баг #1 | ❌ Не исправлен/✅ Исправлен | Высокий |
| Баг #2 | ... | ... |

---

## Методология

Как выполнялся прогон (CLI-тесты, unit-тесты, TUI-тесты).
```

## Пример использования

Разработчик: «Прошей регресс»

1. Подготовка: билд, тесты, создание `auto-result/$(date +%Y-%m-%d)/`
2. Для **каждого** файла (по одному):
   - Прочитать файл кейсов
   - Прогнать кейсы по классификации (**TUI-кейсы: сначала проверить таблицу покрытия!**)
   - Сразу сохранить результат в `auto-result/$DATE/`
   - Перейти к следующему файлу
3. После всех файлов — итоговая статистика
4. Создать SUMMARY.md в `auto-result/$DATE/` по шаблону выше
5. Показать список FAIL с описанием багов
