# 03 — Working Narration contract

**ID:** 0.4-AL-01A  
**Priority:** P0  
**Estimate:** S  
**Depends on:** 0.4-AL-00, 0.4-AL-01  
**Block:** Contract baseline

## Goal

Добавить typed user-visible Working Narration events: context scan, observation, plan, edit intent, verification, recovery,
blocked, completion.

## Local context

Working Narration объясняет observable work, но не раскрывает hidden chain-of-thought и не считается verification evidence.

## Suggested files

- `src/core/loop/narration.ts`
- `src/core/loop/agent-loop.ts`
- `src/widgets/tui/`
- `tests/core/loop/`
- `tests/evals/agent-loop/`

## Requirements

- Non-trivial tasks emit narration before significant context gathering, before first mutation and after verification.
- Narration events are visible in TUI/print transcript.
- Narration can reference evidence ids but cannot satisfy verification requirements.
- Safety filters prevent hidden chain-of-thought, private prompt text, secrets and fabricated tool results.
- Weak profile receives stricter narration prompts.

## Tests

- docs/roadmap task emits `context_scan`, `observation`, `plan`, `verification` or `completion`;
- narration is not counted as verification evidence;
- hidden CoT-like content is rejected or sanitized;
- missing narration fails UC-AL-13 eval.

## Verification

```bash
bun test tests/core/loop
bun test tests/evals/agent-loop
bun test
bun run lint
bunx tsc --noEmit
```

## Mandatory checkpoint after this task

Create checkpoint: **Agent Loop contract baseline**.

Include:

- prompt/runtime parity status;
- narration event kinds;
- eval cases covered;
- known gaps before Evidence Ledger.
