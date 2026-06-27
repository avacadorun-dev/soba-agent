# Regression Runner — Скилл для разработчиков SOBA

Автоматический прогон регресс-тестов для SOBA Agent. Запускает unit-тесты, CLI-проверки и реальные API-вызовы, сохраняет результаты с датой.

> **Dev-only** — этот скилл только для разработки SOBA Agent. Не попадает в bundled скилы продукта.

## Расположение

- **Скилл**: `.soba/skills/regression-runner/SKILL.md`
- **Регресс-кейсы**: `docs/testing/regression-cases/`
- **Результаты**: `docs/testing/regression-cases/auto-result/YYYY-MM-DD/`

## Быстрый старт

Скажи агенту:

```
Прошей регресс
```

или

```
Run regression tests
```

Агент автоматически:
1. Прочтёт все кейсы из `docs/testing/regression-cases/`
2. Прогонет каждый кейс (unit-тесты, CLI, API)
3. Сохранит результаты в `auto-result/YYYY-MM-DD/`
4. Покажет статистику и список багов
5. Создаст SUMMARY.md со сводкой

## Что проверяется

| Тип | Как проверяется | Пример |
|-----|----------------|--------|
| **Unit-тесты** | `bun test tests/<file>.test.ts` | session-manager, checkpoint, trust-manager |
| **CLI-флаги** | `bun run soba <flags>` | --help, --version, --lang, --no-color |
| **API-вызовы** | `bun run soba "prompt" --no-session` | --model, --base-url, --max-tokens |
| **TUI** | PASS (unit-тесты: TuiStore/OpenTUI/CLI integration) / **SKIP_MANUAL** (реальный TTY: Ctrl+C, resize, key-коды). SKIP_TUI не используется. | Сначала проверить таблицу покрытия в SKILL.md |
| **Manual** | SKIP_MANUAL | Длительные сессии, моки, rate limit |

## Структура результатов

Каждый файл в `auto-result/YYYY-MM-DD/` содержит:

```
# Регресс-кейсы: <Название>

## Кейсы
**PASS** Кейс 01: ...
**FAIL** Кейс 02: ... — причина
**SKIP_TUI** Кейс 03: ...
**SKIP_MANUAL** Кейс 04: ...

---
## Пропущенные кейсы
- SKIP_TUI и SKIP_MANUAL

---
## FAIL — описание и баги
### Баг: Кейс 02: ...
**Статус:** Не исправлено
**Приоритет:** Средний
**Задача:** Что нужно исправить
```

После прогона всех файлов создаётся `SUMMARY.md` (см. формат в SKILL.md) — общая статистика, детализация по файлам, TUI-покрытие, список багов, методология.

## API-конфигурация

Для API-проверок используется конфиг из `~/.soba/config.json` или env-переменные:

```json
{
  "apiKey": "...",
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "model": "qwen3.6-plus"
}
```

## Когда запускать

- **После каждой фазы** — полный прогон
- **Перед релизом** — полный прогон + ручные тесты
- **После рефакторинга** — полный прогон
- **После small fix** — достаточно `bun test`

## Добавление новых кейсов

1. Создать файл в `docs/testing/regression-cases/NN-name.md`
2. Описать цель, окружение, кейсы
3. При следующем прогоне кейс будет автоматически включён
