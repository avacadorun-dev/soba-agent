# Phase 4.5 — checkpoint policy

Checkpoint notes сохраняются в `checkpoints/` после крупных baseline-задач. Они нужны, чтобы после compaction или паузы
агент мог продолжить фазу без повторного чтения всех task cards.

## When to create a checkpoint

Обязательные checkpoints:

- после task 03 — Agent Loop contract baseline;
- после task 06 — Evidence + completion gate baseline;
- после task 09 — Auto-Verifier + Fix-Until-Green baseline;
- после task 11 — checkpoint/memory integration baseline;
- после task 14 — Built-in Skills 2.0 baseline;
- после task 18 — v0.4.0 Agent Loop hardening release candidate baseline.

Создавать дополнительный checkpoint, если:

- меняется порядок задач;
- меняется public/runtime contract;
- меняется `SYSTEM.md` или prompt builder;
- AgentLoop behavior затрагивает completion, tool execution или session format;
- обнаружен release blocker.

## Checkpoint format

```markdown
# Checkpoint — Task NN short-name

## Completed

- Что реализовано.

## Verified

- Команды и результаты.

## Runtime contract

- Какие инварианты теперь считаются baseline.

## Follow-up tasks

- Что должна учесть следующая задача.

## Do not carry forward

- Какие детали не нужно держать в контексте дальше.
```

## Rules

- Не записывать hidden chain-of-thought.
- Не копировать большие diffs или полные логи.
- Ссылаться на файлы, тесты и evidence, а не пересказывать весь код.
- Отдельно фиксировать known limitations.
