---
name: fix-until-green
description: Iterate on failing verification until the target checks pass or a real blocker is found.
soba:
  version: 1
  triggers:
    - fix until green
    - failing verification
    - recovery loop
  memory-policy: read-write
---

# Fix Until Green

## Purpose

Use verification failures as diagnostic evidence and keep iterating until the requested checks pass or a concrete blocker is reached.

## Triggers

Use this skill when a test, lint, type-check, build, or other verification command fails after an attempted change.

## Inputs To Inspect

- The exact failing command and output.
- Recent mutations in the current task.
- Relevant source and test files.
- Project instructions for verification commands.
- Prior recovery attempts in the current turn.

## Procedure

1. Capture the failing command and the specific diagnostic.
2. Form one narrow hypothesis from the diagnostic.
3. Inspect the smallest source or test context needed to confirm the hypothesis.
4. Apply one focused recovery change.
5. Rerun the same failing command.
6. If it passes, run the broader required verification for the task.
7. If it fails differently, repeat from the new diagnostic. If it fails identically, change strategy instead of repeating.

## Verification Contract

The original failing command must pass before claiming recovery. If the recovery changed shared code, the broader project-required checks must also pass.

## Failure Recovery

After repeated no-progress attempts, stop and report the exact blocker, diagnostics, attempted fixes, and next decision needed. Do not mask the failure by changing the verification target.

## Memory Policy

Write memory only after a verified failure-to-fix lesson is stable, general to this project, and free of secrets. Do not store raw logs or speculative hypotheses.

## Stop Conditions

Stop when verification is green, when a real external blocker prevents progress, or when continuing would require an unapproved risky change.

## Anti-Patterns

- Do not rerun the same failing command without a changed input or hypothesis.
- Do not delete tests to make verification pass.
- Do not declare success from partial verification when the original command still fails.
