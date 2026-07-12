---
name: fix-until-green
description: Iteratively diagnose and resolve failing project verification until the requested checks pass or a concrete external blocker remains. Use after tests, static checks, builds, packaging, or validation fail during authorized implementation work.
soba:
  version: 1
  triggers:
    - fix failing checks
    - recover verification
    - iterate until green
  memory-policy: read-write
---

# Fix Until Green

## Purpose

Use verification feedback to make bounded forward progress without hiding failures or expanding the task carelessly.

## Triggers

Apply this workflow after a relevant project check fails during work the user authorized the agent to change.

## Inputs To Inspect

- The exact command or operation, exit state, and smallest useful diagnostic.
- Recent task-related changes and the last known verification state.
- The implementation, configuration, fixtures, and environment implicated by the diagnostic.
- Project instructions and prior attempts in the current recovery loop.

## Procedure

1. Record the failing check and classify the failure as product, test, configuration, environment, dependency, or unknown.
2. Form one falsifiable hypothesis from the current evidence.
3. Inspect the smallest context that can confirm or reject it.
4. Apply one focused change only when it is inside the user's authorized scope.
5. Rerun the narrowest check that preserves the original failure signal.
6. On a new failure, update the classification and hypothesis; on an identical failure, change strategy before rerunning.
7. Once the target passes, run broader checks required by the change's blast radius.
8. Review all recovery edits and revert no user work; separate unrelated pre-existing failures in the report.

## Verification Contract

Require the original target check to pass without weakening its intended coverage. When recovery changes shared behavior, require proportionate surrounding verification. Preserve exact evidence for any remaining failure.

## Failure Recovery

Reduce noisy output to the first causal diagnostic, isolate nondeterminism, and compare against a clean or known-good path when safe. If failures are environmental or external, stop mutating product code unless evidence links it to the failure.

## Memory Policy

Read memory as a hypothesis. Write only a verified, reusable project-specific recovery lesson after the loop succeeds; exclude transient logs, machine state, secrets, and failed guesses.

## Stop Conditions

Stop when the requested checks pass with proportionate follow-up verification. Stop as blocked when progress requires unavailable external state, new authorization, or a product decision; otherwise continue with a changed hypothesis.

## Anti-Patterns

- Do not rerun unchanged failures without a new hypothesis or input.
- Do not delete, skip, quarantine, or weaken checks merely to obtain green output.
- Do not make unrelated refactors inside a recovery loop.
- Do not treat a partial pass as recovery of the original target.
