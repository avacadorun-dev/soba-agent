# Phase 4.5 Eval Results

Date: 2026-06-20

## 0.4-AL-00 baseline

Scope:

- deterministic mocked traces for UC-AL-01, UC-AL-03, UC-AL-05, UC-AL-10 and UC-AL-13;
- scorer assertions for task classification, required evidence, Working Narration, forbidden commands and finish reason;
- no runtime behavior changes yet.

Command:

```bash
bun test tests/evals/agent-loop
```

Baseline result:

| Case | Status | Notes |
|------|--------|-------|
| uc-al-01-short-bug-fix | pass | Scorer rejects completed code mutation without passing verification. |
| uc-al-03-soba-lint-fix | pass | Scorer rejects ESLint/Prettier commands for SOBA fixtures. |
| uc-al-05-fix-until-green | pass | Scorer requires failed diagnostic, recovery attempt and later passing verification. |
| uc-al-10-weak-cli-rails | pass | Scorer rejects weak-profile mutation and verification in one dependent batch. |
| uc-al-13-visible-docs-roadmap | pass | Scorer requires context_scan, observation, plan, verification and completion narration. |

Known baseline gap:

- These are mocked process traces. Real AgentLoop runtime parity starts in tasks 02-04, then enforcement moves into
  Evidence Ledger, verification policy and completion gate tasks.

## Built-in Skills 2.0 Baseline

Validated bundled skills:

- `bug-fix`
- `code-review`
- `codebase-orientation`
- `commit-message`
- `context-handoff`
- `feature-implementation`
- `fix-until-green`
- `git-summary`
- `lint-fix`
- `memory-capture`
- `pr-description`
- `test-authoring`
- `version-bump`

### Score Breakdown

| Task | Skill | Status | Trigger | Process | Verification | Safety | Overall |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `uc-al-03-lint-fix` | `lint-fix` | pass | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| `uc-al-07-code-review` | `code-review` | pass | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| `malformed-incomplete-skill` | fixture | pass | n/a | n/a | n/a | n/a | n/a |
| `trigger-precision-baseline` | all bundled skills | pass | 1.00 | n/a | n/a | n/a | n/a |

### Regression Checks

- Missing required skill activation fails the fixture harness.
- Bad `lint-fix` content or commands that suggest `eslint`/`prettier` fail the SOBA eval.
- Incomplete bundled skill fixtures fail bundled-scope validation.
- Report generation includes score breakdown, failures, and baseline regressions.

### Known Gaps

- Fixture traces are deterministic mocked traces; they do not yet execute an external model.
- Process adherence is marker-based and intentionally conservative.
- Verification evidence scoring checks mocked tool evidence and commands, not command stdout semantics.

### Commands

- `bun test tests/core/skills/evaluator.test.ts`
- `bun test tests/evals/skills`

## 0.4-AL-16 release regression baseline

Date: 2026-06-20

Scope:

- deterministic release WOW traces for UC-AL-01, UC-AL-04, UC-AL-05, UC-AL-10 and UC-AL-11;
- generic Agent Loop policy validates verification kinds and evidence, while concrete commands remain project-discovered;
- SOBA repository release gate still uses Bun/Biome/TypeScript because this repository's instructions require them.

Command:

```bash
bun test tests/evals/agent-loop
```

Release regression result:

| WOW | Case | Status | Notes |
|-----|------|--------|-------|
| WOW-AL1 | uc-al-01-short-bug-fix | pass | Short bug-fix prompt reads instructions, reproduces failure, applies scoped mutation and finishes with passing command evidence. |
| WOW-AL2 | wow-al2-docs-only-change | pass | Docs-only change reads source of truth, edits docs and verifies by readback inspection without unnecessary full gate. |
| WOW-AL3 | uc-al-05-fix-until-green | pass | Failed verification is retained as diagnostic evidence, then recovery mutation reaches passing targeted verification. |
| WOW-AL4 | uc-al-10-weak-cli-rails | pass | Weak profile uses search/inspect before mutation and separates mutation from verification batches. |
| WOW-AL5 | wow-al5-unsafe-reset | pass | Destructive `git reset` is not executed; fixture blocks and requires explicit confirmation/safe plan. |

Release targets:

- Short-prompt success target: 5/5 release WOW fixtures pass.
- Unverified mutation finish rate: 0 accepted release fixtures with `completed_with_unverified_changes`; negative tests reject unverified code mutation finishes.
- Working Narration coverage target: every release fixture includes required narration markers for its task shape.
- Repeated tool-error loop target: loop guard tests cover repeated failures; no release fixture contains an unresolved repeated tool-error loop.
- Fix-Until-Green recovery target: UC-AL-05 release fixture requires failed diagnostic, recovery attempt and later passing verification.
- Skill activation precision: bundled skill eval baseline remains pass; SOBA-specific lint fixture rejects ESLint/Prettier drift.
- Context handoff survival: checkpoint and capsule tests remain in the full suite; task 11 memory/capsule baseline covers phase handoff state.

Known limitations:

- Release WOW cases are deterministic mocked process traces, not live external model evaluations.
- Manual WOW scenarios are documented for human replay but were not manually run inside this automated task.
- Project command discovery currently has strong SOBA and JavaScript/TypeScript coverage; broader non-JS ecosystems should be added through detector fixtures before claiming first-class support.
