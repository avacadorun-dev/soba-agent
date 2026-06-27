# 10 — Memory Injector

**ID:** 0.4-MEM-05  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MEM-01, 0.4-MEM-02  
**Block:** Aggregation

## Goal

Добавить бюджетированную инжекцию `<project_knowledge>` и `<project_memory>` в system prompt.

## Local context

Это единственная memory-задача, которая меняет system prompt builder. Не добавлять ToolRegistry/AgentLoop изменения здесь.

## Suggested files

- `src/core/memory/memory-injector.ts`
- `src/core/prompt/system-prompt.ts`
- `tests/memory/memory-injector.test.ts`

## Requirements

- `buildProjectMemorySection(memory, budget)` формирует две секции:
  - `<project_knowledge>` for markdown knowledge;
  - `<project_memory>` for selected capsules.
- Empty memory returns empty string or minimal no-op section according to prompt style.
- Respects token budget; uses estimates from stores.
- Critical/high priority capsules preferred.
- Output is deterministic for tests.
- Does not leak redacted secret placeholders.

## Tests

- full memory formats expected XML-like sections;
- empty memory behavior;
- budget excludes low-priority capsules first;
- critical capsule retained when possible;
- system prompt includes memory once;
- no duplicate memory injection across calls.

## Verification

```bash
bun test tests/memory/memory-injector.test.ts
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Сделать checkpoint, если меняется system prompt contract или token budget policy.
