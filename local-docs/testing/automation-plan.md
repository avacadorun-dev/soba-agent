# План автоматизации SKIP_TUI и SKIP_MANUAL

## Текущее состояние

| Статус | Количество | Доля |
|--------|-----------|------|
| PASS | 150 | 60% |
| FAIL | 17 | 7% |
| SKIP_TUI | 33 | 13% |
| SKIP_MANUAL | 10 | 4% |
| SKIP_API | 0 | 0% |

**Цель:** сократить SKIP_TUI + SKIP_MANUAL с 43 до <10 (<4% от общего числа).

---

## Анализ SKIP_TUI по категориям

### Категория 1: Slash-команды (12 кейсов) — stdin-эмуляция
**Файлы:** 10-tui-slash-commands, 16-rewind, 17-compaction-capsules, 30-budget-limits

| Команда | Автоматизация |
|---------|--------------|
| `/help` | `printf '/help\n/exit\n' \| soba -i` |
| `/session` | `printf '/session\n/exit\n' \| soba -i` |
| `/budget` | `printf '/budget\n/exit\n' \| soba -i` |
| `/compact` | `printf '/compact\n/exit\n' \| soba -i` |
| `/capsule` | `printf '/capsule\n/exit\n' \| soba -i` |
| `/clear` | `printf '/clear\n/exit\n' \| soba -i` |
| `/rewind` | `printf '/rewind\n/exit\n' \| soba -i` |
| `/skill` | `printf '/skill\n/exit\n' \| soba -i` |
| `/project-trust` | `printf '/project-trust\n/exit\n' \| soba -i` |
| `/exit` | `printf '/exit\n' \| soba -i` |

**Подход:** stdin-эмуляция через pipe. TUI читает stdin, slash-команды работают без интерактивного ввода.

### Категория 2: REPL ввод/вывод (5 кейсов) — stdin-эмуляция
**Файлы:** 05-tui-basic

| Кейс | Автоматизация |
|------|--------------|
| Запуск TUI через `-i` | `printf 'exit\n' \| soba -i` |
| Ввод промпта в REPL | `printf 'скажи привет\n/exit\n' \| soba -i` |
| Вывод ответа модели | grep по выводу |
| Многострочный ввод | `printf 'line1\nline2\n\n' \| soba -i` |
| История промптов | Не автоматизируется (стрелки требуют pty) → SKIP_MANUAL |

### Категория 3: Темы (2 кейса) — grep по выводу
**Файлы:** 02-cli-flags, 29-themes

| Кейс | Автоматизация |
|------|--------------|
| `--theme ember` | `printf '/exit\n' \| soba -i --theme ember 2>&1` — проверка что не падает |
| `--theme nonexistent` | `soba -i --theme nonexistent 2>&1` — grep ошибки |

### Категория 4: Выбор сессии (2 кейса) — stdin-эмуляция
**Файлы:** 02-cli-flags, 13-sessions

| Кейс | Автоматизация |
|------|--------------|
| `-r` (resume) | `printf '1\nexit\n' \| soba -r` |
| `/session` статистика | `printf '/session\n/exit\n' \| soba -i` |

### Категория 5: Auto-compact (2 кейса) — CLI-флаги
**Файлы:** 02-cli-flags, 03-configuration

| Кейс | Автоматизация |
|------|--------------|
| `--no-auto-compact` | Уже CLI-флаг, можно проверить без TUI |
| `SOBA_AUTO_COMPACT=false` | Env-переменная, можно проверить без TUI |

---

## Анализ SKIP_MANUAL по категориям

### Категория 1: First-time wizard (4 кейса) — stdin-эмуляция
**Файлы:** 03-configuration

| Кейс | Автоматизация |
|------|--------------|
| Полный ввод | `printf 'https://api.example.com\nsk-test\ngpt-4o\n' \| soba` (с удалённым конфигом) |
| Отказ от ввода | `printf '\n\n\n' \| soba` |
| Ctrl+C | `timeout 2 bash -c 'soba'` |
| Без конфига | `mv ~/.soba/config.json ~/.soba/config.json.bak && ...` |

### Категория 2: Trust manager / dangerous команды (3 кейса) — pre-configuration
**Файлы:** 11-agent-tools, 25-trust-manager

| Кейс | Автоматизация |
|------|--------------|
| `rm -rf` | Создать `~/.soba/trust.json` с pre-approved доменами |
| `git push` | Аналогично |
| Dangerous команды | Pre-configure trust → проверка без интерактива |

### Категория 3: Offline режим (2 кейса) — mock network
**Файлы:** 01-installation-build

| Кейс | Автоматизация |
|------|--------------|
| `bun install` офлайн | Mock DNS или отключение сети в тесте |
| Изменённый package.json | Временная модификация package.json |

### Категория 4: Отсутствующая директория (1 кейс) — temporary move
**Файлы:** 03-configuration

| Кейс | Автоматизация |
|------|--------------|
| `~/.soba/` отсутствует | `mv ~/.soba ~/.soba.bak && soba && mv ~/.soba.bak ~/.soba` |

---

## План реализации

### Фаза 1: Mock API серверы (1-2 задачи)
**Цель:** автоматизировать rate limiting, timeout, content filter

```
tests/mocks/
├── api-server.ts          # Базовый mock API
├── rate-limit-server.ts   # 429 Too Many Requests
├── slow-server.ts         # Timeout simulation
├── error-server.ts        # 500/503 errors
└── content-filter.ts      # Content filter response
```

**Сокращение:** ~5 SKIP_MANUAL → PASS

### Фаза 2: stdin-эмуляция для TUI (2-3 задачи)
**Цель:** автоматизировать slash-команды, REPL, wizard

- Обновить SKILL.md: добавить шаблоны stdin-эмуляции
- Создать helper-скрипт `tests/helpers/tui-stdin.ts`
- Обновить кейсы 05-10, 16, 17, 30

**Сокращение:** ~19 SKIP_TUI → PASS

### Фаза 3: Trust manager pre-configuration (1 задача)
**Цель:** автоматизировать dangerous команды

- Создать `tests/helpers/trust-setup.ts` — временный trust.json
- Обновить кейсы 11, 25

**Сокращение:** ~3 SKIP_MANUAL → PASS

### Фаза 4: expect/pty для сложных сценариев (1-2 задачи)
**Цель:** автоматизировать историю промптов, визуальные проверки

- Создать `tests/helpers/pty-expect.ts`
- Обновить кейсы с стрелками, визуальными темами

**Сокращение:** ~5 SKIP_TUI → PASS

### Фаза 5: Ink testing для TUI компонентов (2-3 задачи)
**Цель:** unit-тесты для TUI без запуска CLI

- `tests/widgets/tui/` — тесты компонентов через ink-testing-library
- Покрытие: header, footer, session list, trust dialog

**Сокращение:** ~6 SKIP_TUI → PASS

---

## Ожидаемый результат

| Статус | Было | Станет |
|--------|------|--------|
| PASS | 150 | ~200 |
| FAIL | 17 | ~17 |
| SKIP_TUI | 33 | ~3 |
| SKIP_MANUAL | 10 | ~3 |
| **Итого** | **250** | **~223** |

**Покрытие:** с 60% до ~90%.
