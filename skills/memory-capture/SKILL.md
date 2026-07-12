---
name: memory-capture
description: Persist a concise project-specific lesson only when it is verified, reusable, non-sensitive, and not already recorded. Use when the user asks Soba to remember something or successful work reveals a stable convention worth future retrieval.
soba:
  version: 1
  triggers:
    - remember project convention
    - capture verified lesson
    - persist project knowledge
  memory-policy: read-write
---

# Memory Capture

## Purpose

Convert durable project knowledge into safe, searchable memory without storing transient task state or unsupported conclusions.

## Triggers

Apply this workflow to explicit remember requests and to verified recurring project lessons that would materially improve later work.

## Inputs To Inspect

- The candidate lesson and its intended future use.
- Current source, tests, documentation, configuration, or successful verification supporting it.
- Existing memory entries and their provenance.
- Scope, expiry conditions, and potential sensitive content.

## Procedure

1. State the candidate lesson as a project-specific rule, fact, or recovery pattern.
2. Confirm that it is stable beyond the current incident and likely to change future decisions.
3. Tie it to observable project evidence and distinguish direct fact from a supported inference.
4. Search existing memory for duplicates, contradictions, or a more current entry.
5. Remove credentials, tokens, personal data, machine-specific paths, raw logs, and unnecessary proprietary content.
6. Record the smallest self-contained entry with scope, rule, rationale when useful, evidence, and invalidation conditions.
7. Use concise retrieval terms or tags supported by the project's memory mechanism.
8. Report whether the entry was stored, updated, deduplicated, or rejected and why.

## Verification Contract

Store only claims supported by inspectable project evidence or an explicit user instruction to remember a preference. Preserve provenance without embedding sensitive payloads. Reject speculation and one-off observations.

## Failure Recovery

If evidence is weak, keep the candidate in the current handoff rather than durable memory. If entries conflict, prefer current authoritative project artifacts and mark or replace stale memory only when the memory mechanism supports it safely.

## Memory Policy

Write only through the product's project-memory mechanism. Keep user preferences distinct from project facts and never broaden one user's local preference into a repository convention without evidence.

## Stop Conditions

Stop after safely storing or updating one durable lesson, identifying an existing equivalent, or explaining why the candidate is transient, duplicate, sensitive, or unverified.

## Anti-Patterns

- Do not store secrets, personal data, raw diagnostics, or full conversation history.
- Do not preserve plans, current progress, or unresolved hypotheses as durable truth.
- Do not create memory merely because an operation failed once.
- Do not omit evidence or the conditions under which a lesson stops applying.
