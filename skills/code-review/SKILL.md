---
name: code-review
description: Review code changes with findings first and no file mutation unless explicitly requested.
soba:
  version: 1
  triggers:
    - code review
    - review diff
    - inspect changes
  memory-policy: none
---

# Code Review

## Purpose

Find concrete bugs, regressions, missing tests, and maintainability risks in code changes.

## Triggers

Use this skill when the user asks for a review, asks to inspect a diff, or asks whether a change is ready.

## Inputs To Inspect

- Project instructions.
- The requested diff, files, branch, or commit range.
- Nearby tests and contracts for changed behavior.
- Build or verification output when provided.
- Public API or schema changes touched by the diff.

## Procedure

1. Read project instructions first.
2. Inspect the changed files and nearby tests before forming findings.
3. Prioritize defects that can affect users, data, security, compatibility, or CI.
4. Present findings first, ordered by severity, with file and line references.
5. Include open questions only when they materially affect correctness.
6. Add a short summary after findings, not before them.
7. Do not modify files unless the user explicitly asks for a patch.

## Verification Contract

Every finding must point to inspected code and explain the concrete failing scenario. If no issues are found, say that clearly and name residual test gaps or risk.

## Failure Recovery

If the diff is missing, inspect git status or ask for the target range. If line references are unstable, cite the smallest function or file context and explain the affected logic.

## Memory Policy

Memory capture is out of scope for review findings. Read memory only if it is already available and contains a known project review convention.

## Stop Conditions

Stop after delivering findings-first review output, or after identifying that the requested diff or files are unavailable.

## Anti-Patterns

- Do not lead with praise or a summary before findings.
- Do not nitpick style when correctness issues exist.
- Do not modify files during a review unless explicitly requested.
