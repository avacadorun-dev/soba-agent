---
name: pr-description
description: Generate structured pull request descriptions from branch changes.
soba:
  version: 1
  triggers:
    - pull request description
    - pr body
    - merge request summary
  memory-policy: none
---

# Pull Request Description

## Purpose

Create a reviewer-ready pull request description from branch commits, diffs, and project-specific requirements.

## Triggers

Use this skill when the user asks for a PR description, merge request body, release-oriented change summary, or reviewer checklist.

## Inputs To Inspect

- Project instructions for PR format.
- Current branch name.
- Comparison base requested by the user or the repository default.
- Commit log for the branch.
- Changed files, diff stat, and relevant detailed diffs.
- Test or verification evidence from the current task when available.

## Procedure

1. Determine the base branch or comparison range.
2. Inspect branch commits and changed file statistics.
3. Read detailed diffs for files that define the main behavior change.
4. Group changes by purpose and user impact.
5. List verification that actually ran, preserving command names.
6. Call out breaking changes, migrations, risks, or follow-up work only when supported by evidence.
7. Format the PR body using project instructions or a compact default structure: Summary, Changes, Verification, Risk.

## Verification Contract

The PR description must match the inspected branch diff and must not claim tests, screenshots, migrations, issues, or breaking changes that were not observed.

## Failure Recovery

If the base branch cannot be determined, inspect local branches and ask for the intended base only if the ambiguity changes the result. If the branch has many unrelated changes, group by directory and make the scope visible.

## Memory Policy

Do not write project memory. Read memory only if it was already injected and contains a PR template or reviewer convention.

## Stop Conditions

Stop after producing the requested PR description or after identifying that a missing comparison base prevents a correct description.

## Anti-Patterns

- Do not invent verification results.
- Do not include boilerplate checklists unless the project expects them.
- Do not hide unreviewed or high-risk areas.
