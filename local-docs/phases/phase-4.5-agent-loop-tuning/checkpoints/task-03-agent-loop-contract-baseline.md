# Checkpoint — Task 03 Agent Loop contract baseline

## Completed

- Task 01 added deterministic mocked Agent Loop eval cases for UC-AL-01, UC-AL-03, UC-AL-05, UC-AL-10 and UC-AL-13.
- Task 02 aligned `SYSTEM.md` and runtime prompt with the mandatory Agent Loop Contract:
  understand, inspect, plan, act, verify, reflect, finish.
- Task 03 added typed `working_narration` events with these event kinds:
  `acknowledgement`, `context_scan`, `observation`, `plan`, `edit_intent`, `verification`, `recovery`, `blocked`,
  `completion`.
- Working Narration is visible in the TUI message stream and transcript.
- Narration messages are sanitized for hidden chain-of-thought, private prompt text, secrets and fabricated tool-result
  claims.

## Verified

- `bun test tests/core/loop tests/evals/agent-loop`
- `bun test tests/widgets/tui/tui-store.test.ts`
- `bunx tsc --noEmit`
- `bun test`
- `bun run lint`
- `bun run build`
- `bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts` (`dead: 0`)


## Runtime contract

- Non-trivial prompts emit observable narration around context scan, observation, plan, first mutation intent,
  verification and completion/blocker boundaries.
- Working Narration may reference evidence ids, but it is not verification evidence.
- Completion evidence still comes from runtime/tool state only.
- Project instructions and prompt parity remain the canonical behavior baseline.

## Follow-up tasks

- Task 04 should introduce Evidence Ledger and make tool reads, mutations, diagnostics and verification evidence explicit.
- Task 05 should replace the current loose read/bash verification heuristic with strict task-kind verification policy.
- Task 06 should align finish schema with completion rejection details and evidence ids.

## Do not carry forward

- Do not treat the current `read`/`bash` verification heuristic as final policy.
- Do not store hidden reasoning in narration, session debug entries or checkpoint notes.
- Do not count narration events as completion evidence.
