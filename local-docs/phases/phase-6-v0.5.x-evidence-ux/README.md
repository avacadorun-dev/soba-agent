# Phase 6 — v0.5.x Evidence UX + Diff Review

**Target version:** SOBA 0.5.x  
**Status:** planned  
**Previous phase:** [Phase 5 — v0.5.0 Clean Architecture + ACP](../phase-5-v0.5.0-clean-architecture-acp/)  
**Primary goal:** make every completed task leave a clear, user-visible proof bundle: what changed, what ran, what passed, and what still carries risk.

## Artifacts

- [Current State Audit](./current-state-audit.md)
- [Technical Spec](./technical-spec.md)
- [Implementation Plan](./implementation-plan.md)
- [Validation](./validation.md)

## Why this phase exists

Phase 5 made the runtime extensible and connected SOBA to Zed through ACP. It also created the protocol-neutral event surface needed for a better evidence experience.

The public `v0.5` promise is still broader than the current product:

- "Сводка проверок"
- "Разбор diff перед сдачей"
- "Более гладкий первый запуск"

Phase 6 turns the existing Evidence Ledger, verification policy, runtime events and ACP tool metadata into a product surface the user can inspect before trusting the result.

## Release thesis

SOBA should not end a task with a generic "done". It should end with a compact proof:

> Here is what changed, here is what I ran, here is what passed, and here is what I did not prove.

## Scope

### P0

1. Evidence Bundle v1:
   - changed files;
   - commands run;
   - check status: pass, fail, skipped, not run;
   - final summary;
   - risk/unverified notes.
2. Diff Review UX:
   - show file-level diff summary before handoff;
   - support accept/reject file;
   - support accept/reject hunk where the surface can render it;
   - support rollback of the current turn.
3. Protocol-neutral evidence model:
   - shared builder over Evidence Ledger, runtime events and git/worktree state;
   - no TUI-only or ACP-only evidence path.
4. Completion handoff:
   - final response includes evidence status;
   - failures and skipped checks are explicit;
   - unverified completion cannot look identical to verified completion.

### P1

1. Agent Flight Recorder foundation:
   - prompt snapshot;
   - tool calls;
   - approvals;
   - diffs;
   - runtime events;
   - replay-oriented storage format.
2. First-run experience:
   - `soba init`;
   - provider setup;
   - first task suggestion;
   - target: first useful result under 30 seconds.
3. `/sessions` management:
   - list;
   - load/resume;
   - delete/close;
   - evidence-aware session summary.

### P2

1. Public eval suite with 20-50 real tasks on small repositories.
2. Harbor + Terminal-Bench 2.0 adapter:
   - Linux x64 one-shot binary;
   - Docker/uv/Harbor config;
   - API env passthrough;
   - smoke profile before benchmark claims.

## Out of Scope

- ACP v2 support.
- Background delegation and git worktrees.
- Memory Doctor and memory update loop.
- Public benchmark claims before the smoke/eval harness is repeatable.
- A full graphical merge tool; the first Diff Review UX can be a focused inline review.

## Non-Negotiable Invariants

- Evidence must be derived from runtime/tool/git state, not model claims.
- Verification/completion gates remain in core policy, not in UI adapters.
- CLI, TUI and ACP must consume the same evidence model.
- Secret values must not be written into evidence bundles, flight recorder artifacts or diff summaries.
- Failed, skipped and missing checks must be visible as such.
- Rollback/reject actions must never hide the fact that a mutation happened.

## Exit Criteria

- A completed code task produces an evidence bundle with changed files, commands and pass/fail status.
- A docs-only task produces inspection evidence or an explicit "no command verification required" note.
- Diff Review UX can accept/reject file changes and at least represent hunk-level decisions in supported surfaces.
- The final handoff distinguishes verified, partially verified and unverified outcomes.
- Flight Recorder v1 stores enough structured data to replay or inspect a task later, even if replay UI remains basic.
- `soba init` guides a new user to a configured first run without reading internal docs.
- Release gate passes: `bun test`, `bun run lint`, `bunx tsc --noEmit`, `bun run build`.
