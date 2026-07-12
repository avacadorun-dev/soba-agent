---
name: git-summary
description: Summarize a Git working tree, branch, commit range, or time window from repository evidence. Use for change reports, branch overviews, release notes input, or explanations of what changed in Git history.
soba:
  version: 1
  triggers:
    - summarize git changes
    - explain branch history
    - report commit range
  memory-policy: none
---

# Git Summary

## Purpose

Turn a precisely resolved Git comparison into a concise account of behavior, impact, and risk.

## Triggers

Apply this workflow when the user explicitly asks to summarize Git state or history. Do not activate it for ordinary code understanding that does not depend on Git evidence.

## Inputs To Inspect

- The requested working-tree state, refs, commit range, or time window.
- Project reporting conventions and repository default branch when relevant.
- Commit metadata, changed paths, diff statistics, and representative detailed diffs.
- Verification, migration, or release artifacts contained in the selected range.

## Procedure

1. Resolve the comparison endpoints and state whether working-tree changes are included.
2. Inspect commit topology and metadata at the granularity needed for the request.
3. Inspect path and line-level change statistics, then read representative diffs that define behavior.
4. Group related changes by outcome rather than repeating commit subjects or directory names.
5. Distinguish user-visible behavior, internal restructuring, tests, documentation, configuration, and generated artifacts.
6. Call out compatibility changes, migrations, notable risk, and verification only when supported by the range.
7. Keep commit hashes and file lists available for traceability without overwhelming the summary.

## Verification Contract

Make every factual claim traceable to the selected Git range and inspected diff. Report the actual endpoints and whether the working tree was included. Do not infer test execution merely because tests changed.

## Failure Recovery

If a ref is unavailable, inspect local repository evidence and ask only when alternative bases would materially change the result. For large histories, partition by subsystem or coherent commit clusters and state any sampling or exclusions.

## Memory Policy

Do not write memory. Confirm any injected reporting convention against current project instructions.

## Stop Conditions

Stop after delivering a proportionate summary for the resolved range, or after identifying the missing ref or repository state required for correctness.

## Anti-Patterns

- Do not silently choose a comparison base when multiple plausible bases produce different stories.
- Do not equate commit messages with verified implementation behavior.
- Do not include uncommitted changes unless the scope includes them.
- Do not invent product intent, verification, or release impact.
