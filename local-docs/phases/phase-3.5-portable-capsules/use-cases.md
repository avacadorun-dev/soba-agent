# Phase 3.5 — Portable Capsules: Use Cases

## UC-PC1: Compaction сохраняет активные skills и artifact ledger

1. В сессии активирован skill и изменён файл.
2. Выполняется compaction.
3. Capsule сохраняет точные skill refs.
4. Portable continuation содержит goal, progress, artifacts и verification status.
5. После продолжения active skill остаётся активным.

**Acceptance:** ни один active skill или failed verification не теряется.

## UC-PC2: Создание Quick handoff capsule

1. Пользователь выполняет `/capsule create "Передать auth decisions"`.
2. SOBA строит capsule из последнего context checkpoint или текущей ветки.
3. Capsule проходит sanitization и validation.
4. Markdown-файл сохраняется в `.soba/capsules/`.

**Acceptance:** файл самодостаточен, не содержит session IDs, credentials или native continuation.

## UC-PC3: Экспорт существующего checkpoint

1. Пользователь выполняет `/capsule export <checkpoint-id> <path>`.
2. SOBA находит checkpoint по полному ID или однозначному prefix.
3. Создаёт receiver-oriented capsule и записывает новый файл.

**Границы:** неизвестный/неоднозначный ID и существующий destination дают ошибку без изменения файлов.

## UC-PC4: Безопасная загрузка capsule

1. Пользователь выполняет `/capsule load <path>`.
2. Loader ограничивает размер, парсит schema, проверяет checksum и sanitization metadata.
3. SOBA показывает briefing и integration plan.
4. Содержимое возвращается как prompt для следующего turn с маркировкой untrusted context.

**Acceptance:** команды и инструкции из файла не исполняются во время load.

## UC-PC5: Standard capsule с integration plan

1. Capsule содержит prerequisites и пронумерованные steps.
2. Каждый step имеет mode `auto | manual`, action, verification и rollback.
3. Validator отклоняет Standard/Deep capsule без плана или rollback для auto-step.

## UC-PC6: Verbatim fidelity

1. В capsule вложен конфиг или schema как verbatim payload.
2. При экспорте вычисляется checksum.
3. Loader принимает неизменённый payload.
4. После изменения одного символа loader отклоняет capsule.

## UC-PC7: Sanitization

1. Source содержит API key, bearer token, private key, credential URL и абсолютный home path.
2. Экспорт заменяет секреты стабильными redaction markers.
3. Sanitation report содержит категории и количество замен, но не секреты.

## UC-PC8: Backward compatibility

1. Открывается существующая session v1/v2.
2. `buildInput`, rewind и proactive compaction работают как прежде.
3. Новые portable файлы не меняют session tree без явного user prompt.

## UC-PC9: Quality evaluation

Один и тот же directed task выполняется по full source и exported capsule. Automated checks проверяют сохранение
goal, decisions, blockers, artifacts и integration actions. Минимальный deterministic score — 0.9 для structured
fixtures и 0.8 для conversation fixtures.

