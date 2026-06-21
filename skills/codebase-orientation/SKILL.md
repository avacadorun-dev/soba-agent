---
name: codebase-orientation
description: Build a focused map of an unfamiliar codebase before changing it.
soba:
  version: 1
  triggers:
    - codebase orientation
    - unfamiliar repository
    - architecture scan
  memory-policy: read
---

# Codebase Orientation

## Purpose

Create a concise, evidence-based map of the repository so subsequent work starts from real project structure instead of assumptions.

## Triggers

Use this skill when the user asks to understand a codebase, start a new area of work, explain architecture, or make changes in an unfamiliar repository.

## Inputs To Inspect

- Project instructions.
- README and phase or design docs that match the request.
- Package scripts and runtime configuration.
- Source directory layout.
- Tests that cover the requested area.
- Recently changed files when the request follows ongoing work.

## Procedure

1. Read project instructions first.
2. Inspect top-level structure and identify the likely ownership boundary for the task.
3. Read only the docs, source files, and tests needed to understand that boundary.
4. Summarize the module roles, data flow, commands, and risk areas.
5. Name the next implementation or verification step when the user asked for action.

## Verification Contract

The orientation summary must cite inspected files or commands and must distinguish confirmed facts from assumptions. It must not claim behavior that was not observed in source, tests, or docs.

## Failure Recovery

If the repository lacks docs, inspect package scripts, entry points, and tests. If multiple architectures are plausible, state the competing hypotheses and read one more targeted file for each before deciding.

## Memory Policy

Read memory as a hypothesis when available. Do not write memory unless a stable project convention is verified across source and tests.

## Stop Conditions

Stop when the user has a usable map of the requested area or when missing files, missing dependencies, or inaccessible generated artifacts block accurate orientation.

## Anti-Patterns

- Do not scan the entire repository without a task boundary.
- Do not summarize directory names as architecture without reading representative files.
- Do not start implementation before project instructions and relevant tests are understood.
