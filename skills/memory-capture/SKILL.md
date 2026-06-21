---
name: memory-capture
description: Capture stable project lessons only after verification and filtering.
soba:
  version: 1
  triggers:
    - capture memory
    - project lesson
    - remember convention
  memory-policy: write
---

# Memory Capture

## Purpose

Persist only stable, useful, verified project lessons that will reduce future mistakes.

## Triggers

Use this skill when the user asks to remember a convention, when a repeated recovery pattern has been verified, or when a stable project-specific lesson should be captured.

## Inputs To Inspect

- The verified behavior or convention.
- Evidence that the lesson is stable across the project.
- The command or test that proved it.
- Existing memory entries to avoid duplicates.
- Potential secrets or one-off data that must be excluded.

## Procedure

1. Confirm the lesson is project-specific, stable, and useful for future work.
2. Confirm it is supported by source, tests, docs, or successful verification.
3. Check existing memory for duplicates.
4. Filter out secrets, tokens, personal data, raw logs, speculative causes, and one-off incidents.
5. Store the lesson with problem, cause, fix or convention, and verification evidence.
6. Keep the entry concise and searchable with tags.

## Verification Contract

A memory entry may be captured only when the lesson has observable evidence and no secret-like content. Duplicate or speculative lessons must be skipped with a clear reason.

## Failure Recovery

If evidence is missing, do not store the lesson. If the lesson contains sensitive data, rewrite it as a generic pattern or skip it. If a duplicate exists, reference the existing lesson instead of creating another entry.

## Memory Policy

Write memory only through the project memory mechanism. Never store credentials, private user data, raw stack traces with tokens, or unverified guesses.

## Stop Conditions

Stop after storing a verified filtered lesson, skipping a duplicate, or explaining why the candidate is unsafe or unstable.

## Anti-Patterns

- Do not store secrets or environment values.
- Do not store preferences that apply only to the current user unless explicitly requested.
- Do not store a lesson just because a command failed once.
