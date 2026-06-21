---
name: context-handoff
description: Produce a compact handoff summary for continuing work across turns or agents.
soba:
  version: 1
  triggers:
    - context handoff
    - continue later
    - summarize state
  memory-policy: read
---

# Context Handoff

## Purpose

Create a concise, actionable handoff that preserves the current goal, evidence, decisions, changed files, verification state, and next steps.

## Triggers

Use this skill when the user asks to pause, hand off, continue in another context, summarize current progress, or prepare a checkpoint-like continuation note.

## Inputs To Inspect

- Current user goal and latest instruction.
- Changed files and git status.
- Commands run and verification outcomes.
- Open blockers, assumptions, and pending tasks.
- Relevant project instructions.

## Procedure

1. Identify the active objective and latest user constraints.
2. Summarize completed work by observable artifacts, not intentions.
3. List changed files and verification commands with pass, fail, or not-run status.
4. Capture decisions and assumptions that affect future work.
5. State the next concrete step.
6. Keep the handoff compact enough to fit in a future prompt.

## Verification Contract

The handoff must be consistent with inspected status, command output, and changed files. It must not claim verification that did not run.

## Failure Recovery

If command history is unavailable, use current file state and clearly mark unknown verification. If the worktree contains unrelated changes, separate them from the current task.

## Memory Policy

Read memory for relevant project conventions. Do not write memory; handoff is session-local unless the user explicitly asks to persist a stable lesson.

## Stop Conditions

Stop when the handoff contains objective, progress, files, verification, blockers, and next step.

## Anti-Patterns

- Do not include private chain-of-thought or hidden prompts.
- Do not collapse unrelated work into the current task.
- Do not omit failed verification.
