# Checkpoint: Built-in Skills 2.0 baseline

Date: 2026-06-20

## Validated Skill List

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

All bundled skills validate under bundled-scope protocol 2.0 requirements: `soba` metadata plus Purpose, Triggers, Inputs To Inspect, Procedure, Verification Contract, Failure Recovery, Memory Policy, Stop Conditions, and Anti-Patterns.

## Eval Coverage

- `UC-AL-03`: `lint-fix` activation, project-tooling-first process, verification evidence, and forbidden formatter drift checks.
- `UC-AL-07`: `code-review` activation and no-mutation review behavior.
- Malformed or incomplete bundled skill fixture rejection.
- Trigger precision baseline across all bundled skills.
- Core fixture harness unit coverage for good trace, missing activation, bad lint-fix, and markdown report regressions.

## Known Skill Gaps

- Fixture execution uses mocked traces, so it is deterministic and CI-safe but not a live model eval.
- Process adherence scoring is marker-based.
- Verification evidence scoring validates trace metadata and command intent, not command output semantics.

## Regression Report

Regression report path: `docs/phases/phase-4.5-agent-loop-tuning/eval-results.md`
