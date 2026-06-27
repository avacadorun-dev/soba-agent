# Portable Capsules

Portable capsule — это переносимый `.capsule.md` файл для передачи рабочего контекста между сессиями, агентами или
проектами. В отличие от внутреннего `ContextCapsuleEntry` в JSONL-сессии, portable capsule является отдельным
самодостаточным Markdown-файлом и не содержит native continuation провайдера.

## Когда использовать

Используйте portable capsules, когда нужно:

- передать текущий контекст другой сессии SOBA;
- сохранить handoff перед длинным рефакторингом;
- передать решения, blockers, изменённые файлы и проверки другому агенту;
- загрузить контекст из внешнего `.capsule.md` безопасно, без автоматического исполнения команд.

Для обычного продолжения текущей сессии используйте `soba -c` или session rewind. Portable capsules нужны именно для
переноса знаний через границу сессии/проекта.

## Команды

### Список внутренних checkpoints

```text
/capsule
```

Показывает внутренние context capsules текущей сессии. Это старое поведение команды; оно сохранено.

### Просмотр внутреннего checkpoint

```text
/capsule <checkpoint-id>
```

Показывает стратегию, качество, trigger, token metrics и portable state внутреннего checkpoint.

### Создание portable capsule

```text
/capsule create "Передать auth decisions"
```

SOBA берёт последний context checkpoint текущей сессии, строит Quick/Handoff capsule, санитизирует данные,
валидирует результат и пишет файл в:

```text
.soba/capsules/*.capsule.md
```

Файл создаётся эксклюзивно: существующий файл не перезаписывается.

### Экспорт конкретного checkpoint

```text
/capsule export ck_abc ./handoff.capsule.md
```

`ck_abc` может быть полным checkpoint ID или однозначным prefix. Если prefix неоднозначен или destination уже
существует, команда завершится ошибкой без записи файла.

Destination должен заканчиваться на `.capsule.md`.

### Загрузка portable capsule

```text
/capsule load ./handoff.capsule.md
```

Loader:

1. проверяет размер файла;
2. парсит Markdown;
3. валидирует schema/version;
4. проверяет checksums verbatim payloads;
5. возвращает capsule как untrusted prompt для следующего turn.

Важно: `/capsule load` не исполняет команды из файла, не применяет patches и не меняет session tree. Любые действия,
описанные внутри capsule, проходят обычный workflow разрешений.

## Что хранится в `.capsule.md`

Файл содержит:

- scalar frontmatter для быстрого просмотра;
- человекочитаемый briefing;
- fenced block `soba-capsule-json` с полным machine payload.

Portable schema v1 включает:

- `objective`, `intendedReceiver`, `tier`, `category`, `archetype`;
- `dispatchSummary` и `coreContent`;
- decisions/patterns, assumptions, signals;
- `artifacts`: read/modified files, verification commands, verification status;
- `integrationPlan` для Standard/Deep capsules;
- `verbatimPayloads` с SHA-256 checksum;
- `sanitation` report;
- `provenance`.

## Безопасность

Экспорт всегда проходит sanitization. SOBA редактирует:

- API keys и token/secret/password assignments;
- bearer tokens;
- private keys;
- credential URLs;
- absolute home paths;
- session/provider identifiers.

Sanitation report хранит категории и количество redactions, но не исходные секреты.

Импортируемая capsule считается недоверенной. Текст из файла не становится system instruction.

## Проверка вручную

Минимальный ручной прогон:

1. Запустите интерактивную сессию:

   ```bash
   bun run dev -i
   ```

2. Создайте checkpoint через обычную работу или `/compact`.
3. Выполните:

   ```text
   /capsule
   /capsule create "handoff current work"
   ```

4. Убедитесь, что появился файл `.soba/capsules/*.capsule.md`.
5. Экспортируйте конкретный checkpoint:

   ```text
   /capsule export ck_abc ./handoff.capsule.md
   ```

6. Загрузите файл:

   ```text
   /capsule load ./handoff.capsule.md
   ```

7. Следующий turn должен получить контекст как untrusted briefing.

## Troubleshooting

| Симптом | Причина | Что делать |
| --- | --- | --- |
| `Checkpoint not found` | Нет matching internal context capsule | Выполнить `/capsule` и взять существующий ID |
| `Checkpoint prefix is ambiguous` | Prefix совпадает с несколькими checkpoints | Использовать более длинный ID |
| `destination already exists` | Экспорт не перезаписывает файлы | Выбрать новый path |
| `destination must end with .capsule.md` | Неверное расширение | Использовать `*.capsule.md` |
| `validation failed` | Schema/checksum/sanitization не прошли | Проверить файл, не редактировался ли `soba-capsule-json` |
| `corrupted capsule` | Нет machine payload или JSON повреждён | Пересоздать/переэкспортировать capsule |

## Automated checks

Relevant regression commands:

```bash
bun test tests/commands.test.ts tests/core/capsules/portable-capsule.test.ts tests/core/capsules/portable-capsule-service.test.ts tests/core/capsules/portable-capsule-quality.test.ts
bunx tsc --noEmit
bun run lint
bun run build
```
