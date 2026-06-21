---
name: bug-fix
description: Diagnose, patch, and verify a bug with minimal scoped changes.
soba:
  version: 1
  triggers:
    - bug fix
    - failing behavior
    - regression
  memory-policy: read-write
---

# Bug Fix

## Purpose

Fix a reported defect by reproducing or localizing the failure, applying the smallest correct change, and verifying the result.

## Triggers

Use this skill when the user reports broken behavior, failing tests, runtime errors, regressions, or asks to patch a defect.

## Inputs To Inspect

- Project instructions.
- The failing command, stack trace, log, or reproduction steps.
- Relevant source files and adjacent tests.
- Existing issue-specific docs or comments.
- Project memory only as a hypothesis, never as proof.

## Procedure

1. Read project instructions and identify the expected verification workflow.
2. Reproduce the failure when practical, or inspect the provided failure evidence.
3. Trace from symptom to the smallest responsible code path.
4. State the fix intent before changing files.
5. Apply a minimal patch that addresses the cause, not only the symptom.
6. Add or update a focused test when the defect is not already covered and the project has a test pattern.
7. Run the targeted verification first, then broader checks when the change touches shared behavior.

## Verification Contract

The failing scenario must pass after the fix, and the final response must name the command or evidence that verifies it. A code mutation cannot finish as complete without successful verification unless the user explicitly accepts unverified changes.

## Failure Recovery

If the first fix fails, use the new failure as diagnostic evidence, narrow the hypothesis, and avoid repeating the same command without a changed input or changed hypothesis. If the failure cannot be reproduced, state what evidence was inspected and what remains uncertain.

## Memory Policy

Write memory only after a verified fail-then-fix pattern reveals a stable project-specific lesson. Never store secrets, one-off stack traces, or speculative causes.

## Stop Conditions

Stop when the defect is fixed and verified, when the requested reproduction is impossible due to missing external state, or when the user decision is required.

## Anti-Patterns

- Do not broaden the patch into unrelated refactors.
- Do not mark completion from reasoning alone.
- Do not ignore a failing verification command after the change.
