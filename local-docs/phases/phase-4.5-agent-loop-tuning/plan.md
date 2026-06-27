# Implementation Plan

## Release Boundary

Phase 4.5 ships inside v0.4.0 as the enforceable engineering loop layer. It does not need to finish every future skill
or every possible verification parser, but it must prevent the worst failure mode: short prompt -> unverified confident
answer.

## Global Invariants

- Runtime: Bun only.
- Lint/format: Biome only.
- New files: kebab-case.
- AgentLoop changes are split into bounded tasks.
- No hidden chain-of-thought storage; store observable plans, evidence and concise reflections.
- Non-trivial tasks produce concise user-visible working narration: context scan, observation, plan and verification/result.
- Project instructions override generic skills.
- Docs-only tasks may use docs-specific verification; code mutations require command evidence.

## Block 0 — Baseline And Evals

### AL-00: Baseline weak-model eval suite

**Depends on:** none

**Files:**

- `tests/evals/agent-loop/`
- `tests/evals/fixtures/`
- `docs/phases/phase-4.5-agent-loop-tuning/eval-results.md`

**Work:**

1. Create 10-15 fixture tasks based on `use-cases.md`.
2. Add transcript/event assertions for task kind, working narration, mutation, verification and finish reason.
3. Add command to run evals against mocked model traces first.
4. Document baseline failures.

**DoD:**

- Eval runner can fail on unverified code mutation.
- At least UC-AL-01, UC-AL-03, UC-AL-05, UC-AL-10 and UC-AL-13 are represented.

### AL-01: Prompt parity gate

**Depends on:** AL-00

**Files:**

- `SYSTEM.md`
- `src/core/prompt/system-prompt.ts`
- `tests/core/prompt/`

**Work:**

1. Add explicit Agent Loop Contract to runtime prompt.
2. Add snapshot/parity tests for mandatory sections.
3. Ensure prompt only references registered tools.

**DoD:**

- Changing/removing mandatory loop rules fails tests.

### AL-01A: Working narration contract

**Depends on:** AL-00, AL-01

**Files:**

- `src/core/loop/narration.ts`
- `src/core/loop/agent-loop.ts`
- `src/widgets/tui/`
- `tests/core/loop/`
- `tests/evals/agent-loop/`

**Work:**

1. Add typed narration events for acknowledgement, context scan, observation, plan, edit intent, verification, recovery,
   blocked and completion.
2. Emit concise user-facing updates before significant context gathering, after meaningful observations, before mutation
   and after verification.
3. Keep narration out of Completion Gate evidence while allowing evidence ids to be referenced.
4. Add safety filters for hidden chain-of-thought, secrets, private prompt text and fabricated tool results.
5. Add eval assertions for UC-AL-13.

**DoD:**

- Non-trivial docs/code tasks produce observable narration without exposing hidden reasoning.
- Weak-model evals fail when the task jumps from prompt to mutation/final answer without context/observation/plan events.
- Narration is short and visible in TUI/print transcript without being counted as verification evidence.

## Block 1 — Evidence And Completion

### AL-02: Evidence Ledger core

**Depends on:** AL-00

**Files:**

- `src/core/loop/evidence-ledger.ts`
- `src/core/loop/evidence-ledger.test.ts`
- `src/core/loop/agent-loop.ts`

**Work:**

1. Implement evidence entries, mutation entries and active errors.
2. Record file reads, searches, mutations, tool diagnostics and verification commands.
3. Expose ledger summary to Completion Gate.

**DoD:**

- Every successful `write/edit` creates unverified mutation evidence.
- Tool errors become active diagnostics until resolved by relevant success.

### AL-03: Strict verification policy

**Depends on:** AL-02

**Files:**

- `src/core/loop/verification-policy.ts`
- `src/core/loop/completion-gate.ts`
- `tests/core/loop/`

**Work:**

1. Classify verification requirements by task kind.
2. Stop treating `read` as code verification.
3. Accept docs-only inspection for docs tasks.
4. Reject `completed` finish with unverified code mutations.

**DoD:**

- UC-AL-01 fails without command verification.
- UC-AL-04 passes with docs inspection.

### AL-04: Finish schema alignment

**Depends on:** AL-03

**Files:**

- `src/core/loop/agent-loop.ts`
- `src/core/loop/completion-gate.ts`
- `src/core/loop/types.ts`

**Work:**

1. Add `summary`, `status` and optional `evidenceIds` to finish input.
2. Update rejection messages to match schema.
3. Add explicit `completed_with_unverified_changes` path.

**DoD:**

- No finish rejection references fields absent from schema.

## Block 2 — Auto Verification And Recovery

### AL-05: Project command detector

**Depends on:** AL-03

**Files:**

- `src/core/verification/project-command-detector.ts`
- `tests/core/verification/`

**Work:**

1. Detect commands from AGENTS/project instructions, `package.json`, `biome.json`, `tsconfig.json`.
2. Enforce Bun/Biome policy for SOBA.
3. Return typed command set.

**DoD:**

- SOBA fixture selects Bun/Biome commands and rejects ESLint/Prettier suggestions.

### AL-06: Auto-Verifier runner

**Depends on:** AL-05

**Files:**

- `src/core/verification/auto-verifier.ts`
- `src/core/loop/agent-loop.ts`
- `tests/core/verification/`

**Work:**

1. Select targeted/full verification commands.
2. Run bounded commands through existing tool execution path or a safe internal runner.
3. Write verification evidence to ledger.

**DoD:**

- Code mutation can trigger verification even when model forgets.

### AL-07: Fix-Until-Green MVP

**Depends on:** AL-06

**Files:**

- `src/core/fix-until-green/`
- `tests/core/fix-until-green/`

**Work:**

1. Implement diagnostic parser interface.
2. Add parsers for Bun test, Biome, TypeScript and build failures.
3. Implement bounded retry loop.
4. Connect failed verification to recovery state.

**DoD:**

- UC-AL-05 passes.
- UC-AL-06 stops with typed blocker.

## Block 3 — Checkpoint, Context And Memory

### AL-08: Checkpoint event wiring

**Depends on:** AL-02

**Files:**

- `src/core/tools/checkpoint.ts`
- `src/core/loop/agent-loop.ts`
- `src/core/compaction/context-manager.ts`
- `tests/core/loop/`

**Work:**

1. Extract checkpoint events after tool batch.
2. Append checkpoint evidence.
3. Notify ContextManager for milestone/plan_pivot.

**DoD:**

- UC-AL-09 preserves checkpoint state through capsule.

### AL-09: Reflection memory policy

**Depends on:** AL-07, AL-08

**Files:**

- `src/core/memory/`
- `src/core/loop/agent-loop.ts`
- `tests/core/memory/`

**Work:**

1. Add policy for reading relevant memory at task start.
2. Add write-after-success policy for recovery lessons.
3. Add dedupe/secret checks for reflection notes.

**DoD:**

- UC-AL-08 uses memory as hypothesis and still verifies current state.

## Block 4 — Built-in Skills 2.0

### AL-10: Skill protocol hardening

**Depends on:** AL-01

**Files:**

- `src/core/skills/`
- `tests/core/skills/`
- `skills/`

**Work:**

1. Extend skill metadata parser for optional `soba` fields.
2. Validate required sections for bundled skills.
3. Add project-instructions-first rule to skill injection.

**DoD:**

- Malformed bundled skill fails validation.

### AL-11: Rewrite core bundled skills

**Depends on:** AL-10

**Files:**

- `skills/codebase-orientation/SKILL.md`
- `skills/bug-fix/SKILL.md`
- `skills/feature-implementation/SKILL.md`
- `skills/test-authoring/SKILL.md`
- `skills/fix-until-green/SKILL.md`
- `skills/code-review/SKILL.md`
- `skills/context-handoff/SKILL.md`
- `skills/memory-capture/SKILL.md`
- existing bundled skills

**Work:**

1. Add core engineering skills.
2. Rewrite `lint-fix` as project-instructions-first and Bun/Biome-safe for SOBA.
3. Keep operational skills but add verification and stop conditions.

**DoD:**

- UC-AL-03 and UC-AL-07 pass skill evals.

### AL-12: Real skill eval harness

**Depends on:** AL-11

**Files:**

- `src/core/skills/evaluator.ts`
- `tests/core/skills/evaluator.test.ts`
- `tests/evals/skills/`

**Work:**

1. Replace simulation-only evaluator with fixture-based execution.
2. Score trigger precision, process adherence and verification evidence.
3. Add regression reports.

**DoD:**

- A bad `lint-fix` example that suggests ESLint in SOBA fails eval.

## Block 5 — Agent-Computer Interface

### AL-13: Helpful tool errors

**Depends on:** AL-02

**Files:**

- `src/core/tools/`
- `tests/core/tools/`

**Work:**

1. Add machine-readable error codes.
2. Add `nextAction` hints.
3. Teach loop guard to recognize repeated same error.

**DoD:**

- Repeated exact edit failure triggers a better recovery prompt.

### AL-14: Purpose-built search/inspect tools

**Depends on:** AL-13

**Files:**

- `src/core/tools/`
- `src/cli.ts`
- `tests/core/tools/`

**Work:**

1. Add `search_files` wrapper around `rg`.
2. Add bounded `inspect_file` or improve `read` ergonomics.
3. Update prompt/tool docs.

**DoD:**

- Weak-model eval uses search/inspect without unsafe shell patterns.

### AL-15: Mutating batch guard

**Depends on:** AL-03

**Files:**

- `src/core/loop/agent-loop.ts`
- `tests/core/loop/`

**Work:**

1. Detect dependent mutating tool batches.
2. Execute safe independent reads/searches together, but gate edit/write before verify.
3. Optionally disable provider parallel tool calls for weak profile.

**DoD:**

- UC-AL-10 cannot run edit and dependent verification in the same unobserved model response.

## Block 6 — Release Gate

### AL-16: End-to-end Agent Loop tuning regression

**Depends on:** AL-00..AL-15

**Files:**

- `docs/phases/phase-4.5-agent-loop-tuning/eval-results.md`
- `docs/testing/regression-cases/`

**Work:**

1. Run full eval suite on weak and normal profiles.
2. Add regression cases for core workflows.
3. Document known limits and release criteria.

**DoD:**

- Unverified mutation finish rate is 0.
- Working narration coverage meets the target for non-trivial eval tasks.
- Short-prompt success target is met or blockers are documented with task ids.

## Mandatory Checks

For implementation tasks:

```bash
bun test
bun run lint
bunx tsc --noEmit
bun run build
bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts
```

For docs-only tasks:

```bash
find docs/phases/phase-4.5-agent-loop-tuning -maxdepth 1 -type f | sort
rg "phase-4\\.5-agent-loop-tuning" docs/README.md
```

Markdown сейчас не обрабатывается Biome в проектном конфиге, поэтому docs-only gate должен проверять наличие
артефактов, ссылки и содержательные инварианты. Если позже markdown будет включён в Biome, добавить `bun run lint` или
targeted `biome check` для docs.

Before release candidate, run the full implementation gate.
