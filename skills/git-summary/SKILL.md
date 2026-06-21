---
name: git-summary
description: Generate structured summaries of git branches, commits, or date ranges.
soba:
  version: 1
  triggers:
    - git summary
    - branch summary
    - commit summary
  memory-policy: none
---

# Git Summary

## Purpose

Create evidence-based summaries of git activity for branches, commits, or date ranges.

## Triggers

Use this skill when the user asks what changed, asks for a branch summary, asks for a status report based on git history, or requests a commit-level explanation.

## Inputs To Inspect

- Project instructions for reporting style.
- Current branch name.
- Relevant `git log` output.
- Relevant `git diff --stat` or `git diff --name-status`.
- Specific commit hashes or date ranges provided by the user.

## Procedure

1. Determine the requested comparison base, commit range, or time window.
2. Inspect commits without merge noise unless merge commits are explicitly relevant.
3. Inspect changed files and line statistics.
4. Group changes by user-visible purpose: features, fixes, tests, docs, refactors, config, or maintenance.
5. Call out breaking changes, migrations, risk, and follow-up items only when the evidence supports them.
6. Keep the summary proportional to the amount of change.

## Verification Contract

Every claim in the summary must be traceable to inspected git output. File lists, commit counts, and branch names must match the commands that were run.

## Failure Recovery

If the requested base branch or commit is missing, inspect available branches or ask for the intended base. If the history is too large, summarize by directory and commit clusters, then note the range inspected.

## Memory Policy

Do not write project memory. Read memory only if it was already injected and contains a reporting convention relevant to the requested summary.

## Stop Conditions

Stop after delivering the requested summary with enough evidence for the user to review or after identifying a missing git range that blocks a correct answer.

## Anti-Patterns

- Do not infer product intent that is not visible in commit messages or diffs.
- Do not include uncommitted work unless the user asks for it.
- Do not hide uncertainty about the comparison base.
