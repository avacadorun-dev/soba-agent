# 16 — Purpose-built search/inspect tools

**ID:** 0.4-AL-14  
**Priority:** P1  
**Estimate:** M  
**Depends on:** 0.4-AL-13  
**Block:** Agent-computer interface

## Goal

Добавить или улучшить search/inspect tools, чтобы слабые модели не hand-roll небезопасные shell patterns.

## Local context

Внутри разработки мы предпочитаем `rg`. Tool должен быть bounded, predictable and easier than raw bash for common inspect.

## Suggested files

- `src/core/tools/`
- `src/cli.ts`
- `tests/core/tools/`
- `tests/evals/agent-loop/`

## Requirements

- Add `search_files` wrapper around `rg` or improve existing search ergonomics.
- Add bounded `inspect_file` behavior or improve `read` for common line-range/file-summary use.
- Tool outputs are compact and evidence-friendly.
- Prompt/tool docs tell weak profile to use search/inspect before mutation.
- Dangerous shell patterns are unnecessary for common localization tasks.

## Tests

- search returns bounded matches with file/line metadata;
- inspect reads stable ranges and handles missing files actionably;
- weak-model eval uses search/inspect before edit;
- large output is truncated with marker;
- no regression in existing read/bash tools.

## Verification

```bash
bun test tests/core/tools
bun test tests/evals/agent-loop
bun test
bun run lint
bunx tsc --noEmit
```

## Checkpoint

No checkpoint required.
