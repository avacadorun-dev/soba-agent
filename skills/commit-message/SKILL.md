---
name: commit-message
description: Generate conventional commit messages from staged changes.
soba:
  version: 1
  triggers:
    - commit message
    - staged changes
    - conventional commit
  memory-policy: none
---

# Commit Message

## Purpose

Generate concise, accurate conventional commit messages from the changes that are already staged.

## Triggers

Use this skill when the user asks for a commit message, wants conventional commit wording, or asks to summarize staged changes for a commit.

## Inputs To Inspect

- Project instructions for commit style.
- `git diff --cached --stat`.
- `git diff --cached`.
- Recent commit style when project instructions are silent.

## Procedure

1. Confirm that staged changes exist.
2. Inspect the staged diff and identify the dominant change type: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`, `build`, or `ci`.
3. Choose a scope only when the project has a clear module or package boundary.
4. Write a subject in imperative mood, without a trailing period.
5. Add a body only when the reason, risk, migration, or multi-part change would be unclear from the subject alone.
6. Include issue references or breaking-change footers only when present in the evidence.

## Verification Contract

The proposed message must match the staged diff, use a conventional commit type, and avoid mentioning unstaged or inferred work.

## Failure Recovery

If staged changes are absent, state that no commit message can be generated from staged changes and suggest staging files first. If the diff is too large or ambiguous, provide 2-3 options with the tradeoff for each.

## Memory Policy

Do not write project memory. Read memory only if the active task already surfaced a relevant project-specific commit convention.

## Stop Conditions

Stop after providing the requested commit message options or after identifying that there are no staged changes to summarize.

## Anti-Patterns

- Do not invent ticket numbers, breaking changes, or motivations.
- Do not describe unstaged files.
- Do not use vague subjects such as "update files" or "fix stuff".
