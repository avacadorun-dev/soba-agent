---
name: bug-fix
description: Investigate reported defects and, when a fix is requested, make the smallest verified correction. Use for regressions, runtime failures, incorrect behavior, or failing checks with an unknown cause.
soba:
  version: 1
  triggers:
    - diagnose defect
    - fix bug
    - investigate regression
  memory-policy: read-write
---

# Bug Fix

## Purpose

Turn a reported symptom into a supported cause, then correct it only when the user's request includes implementation.

## Triggers

Apply this workflow to incorrect behavior, regressions, runtime failures, or failing checks whose cause is not yet established.

## Inputs To Inspect

- Project instructions and expected behavior.
- Reproduction steps, diagnostics, logs, and environment details relevant to the failure.
- The smallest responsible implementation path and nearby tests.
- Recent related changes when history is available.
- Project memory as a lead, never as proof.

## Procedure

1. Separate the expected behavior, observed behavior, and conditions that trigger the difference.
2. Reproduce the failure with the narrowest practical check; if reproduction is unsafe or unavailable, inspect the strongest existing evidence.
3. Trace evidence from the symptom toward a causal boundary and test competing hypotheses before editing.
4. If the user requested diagnosis only, report the supported cause and stop without mutation.
5. If a fix is requested, state the intended behavior change and apply the smallest change that addresses the cause.
6. Add or strengthen a regression check when the project has an appropriate verification pattern.
7. Rerun the failing scenario, then expand verification according to the change's blast radius.
8. Review the final diff for accidental scope growth.

## Verification Contract

Demonstrate that the original failing scenario now succeeds and that the relevant surrounding behavior still holds. Name the exact check or observable evidence. Report unverified changes explicitly; never substitute confidence for evidence.

## Failure Recovery

Use each new diagnostic to revise the hypothesis. If reproduction remains unavailable, triangulate from source, contracts, and related tests and label the remaining uncertainty. Distinguish product defects from environment, dependency, fixture, or requirement problems before changing production code.

## Memory Policy

Read memory only as context. Write a lesson only after a verified fail-to-fix sequence reveals a stable project-specific rule; exclude secrets, raw logs, and speculative causes.

## Stop Conditions

Stop when the requested diagnosis is supported, or when the requested fix passes proportionate verification. Stop as blocked only when missing external state or a material product decision prevents further safe progress.

## Anti-Patterns

- Do not patch before establishing a plausible causal link.
- Do not broaden a defect fix into unrelated cleanup.
- Do not weaken tests or checks to make the symptom disappear.
- Do not claim a fix when the original scenario was not exercised or clearly marked unverified.
