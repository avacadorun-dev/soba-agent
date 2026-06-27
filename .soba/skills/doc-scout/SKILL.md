---
name: doc-scout
description: Валидирует документацию (user-guides) на соответствие реальному коду. На вход получает путь к .md файлу, проверяет все утверждения о CLI-флагах, env-переменных, slash-командах, конфиг-ключах, subcommand'ах, permission-модах — и выдаёт отчёт о расхождениях.
---

# Doc Scout — Валидатор документации по коду

Принимает файл документации (из `docs-site/content/docs/`) и сверяет каждое техническое утверждение с реальной кодовой базой (`src/`). Выдаёт structured diff: что в доке есть, но в коде нет (выдумка), и что в коде есть, но в доке не описано (пропущено).

## Когда использовать

- «Проверь docs-site/content/docs/security.ru.mdx на соответствие коду»
- «doc-scout —file docs-site/content/docs/themes.ru.mdx»
- «Просканируй всю документацию на выдумки»
- Перед релизом — валидация всех user-guides

## Что проверяет

| Категория | Как ищет в доке | Как сверяет с кодом |
|-----------|----------------|---------------------|
| CLI-флаги | `--flag`, `--flag=value` | Парсит `src/cli.ts` (yargs/parseArgs) |
| Env-переменные | `SOBA_VAR`, `export SOBA_VAR` | `grep` по `src/` |
| Slash-команды | `/command`, `/command sub` | `grep` по `src/widgets/tui/commands/` |
| Subcommand'ы | `` `soba provider add` `` | Проверяет регистрацию в `src/cli/` |
| Конфиг-ключи | `config.json`, `providers.id.apiKey` | Сверяет с `src/core/config/config-loader.ts` и `types.ts` |
| Permission-моды | `accept-edits`, `plan`, `bypass` | Сверяет с `PermissionMode` в `src/core/trust/` |
| Trust-уровни | `safe`, `normal`, `dangerous` | Сверяет с `TrustLevel` в `trust-manager.ts` |
| TUI-хоткеи | `Ctrl+X`, `Ctrl+Shift+X` | `grep` по `src/widgets/tui/hooks/use-tui-keys.ts` |

## Запуск

```bash
# Один файл
bun run .soba/skills/doc-scout/scripts/validate.ts --file docs-site/content/docs/security.ru.mdx

# Вся директория
bun run .soba/skills/doc-scout/scripts/validate.ts --dir docs-site/content/docs/

# Только один язык docs-site
bun run .soba/skills/doc-scout/scripts/validate.ts --dir docs-site/content/docs/ --lang ru

# JSON-вывод
bun run .soba/skills/doc-scout/scripts/validate.ts --file docs-site/content/docs/security.ru.mdx --json
```

## Формат вывода

```
╔══════════════════════════════════════╗
║     Doc Scout — docs-site/content/docs/security.ru.mdx  ║
╚══════════════════════════════════════╝

❌ CLAIMS NOT IN CODE (выдумка):
  --trust CLI-флаг            → не найден в src/cli.ts
  SOBA_TRUST_LEVEL env        → не найден в src/
  /perm slash-команда         → не зарегистрирована в commands/
  accept-edits permission mode → PermissionMode: только "ask" | "repo"

⚠️  MISSING FROM DOCS (не описано):
  repo permission mode        → есть в trust-manager.ts, нет в доке
  /project-trust slash-команда → есть в коде, не описана в security.md

📊 Всего проверено утверждений: 34
   ✅ Подтверждено: 19
   ❌ Выдумка: 8
   ⚠️  Пропущено в доке: 7
```

## Структура скилла

```
.soba/skills/doc-scout/
├── SKILL.md                      # этот файл
├── scripts/
│   └── validate.ts               # основной скрипт валидации
└── output/
    └── <doc-name>-report.json    # JSON-отчёт
```

## Актуальные заметки

- `--lang ru|en|zh` фильтрует docs-site файлы по suffix `.ru.mdx`, `.en.mdx`, `.zh.mdx`.
- Директории обходятся рекурсивно.
- Для v0.5.x скрипт знает runtime slash-команды, TUI fallback-команды (`/model`, `/sidebar`, `/keys`), `soba init`,
  `/sessions`, `/mcp reload`, текущие permission modes и актуальную карту hotkeys.
