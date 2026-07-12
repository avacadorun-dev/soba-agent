---
name: lint-fix
description: Resolve formatting, linting, or static-style failures with the project's own configured workflow and a scoped diff. Use when a style gate fails or the user asks to make existing code-quality checks pass.
soba:
  version: 1
  triggers:
    - fix lint failure
    - fix formatting check
    - resolve style diagnostics
  memory-policy: read
---

# Lint Fix

## Purpose

Restore the project's existing code-quality gates without imposing a language, formatter, linter, or style not chosen by the project.

## Triggers

Apply this workflow to diagnostics from configured formatting, linting, or style validation, or to an explicit request to run and repair those checks.

## Inputs To Inspect

- Project and directory-specific instructions.
- Configured task definitions, manifests, hooks, and tool configuration.
- The exact failing operation and diagnostics.
- Nearby source context and task-related workspace changes.
- Relevant behavioral checks when a proposed cleanup can alter semantics.

## Procedure

1. Discover the authoritative project command and configuration from repository evidence.
2. Reproduce the narrowest relevant diagnostic before editing when practical.
3. Classify each issue as safely mechanical, context-dependent, behavioral, generated, or configuration-related.
4. Apply configured automatic fixes only to a controlled scope and only when their diff can be reviewed.
5. Repair remaining diagnostics with the smallest semantics-preserving edits.
6. Investigate the underlying design when a rule exposes a real correctness or maintainability problem; do not suppress it reflexively.
7. Rerun the original check, then run behavioral or contract verification if semantics may have changed.
8. Review the final diff and separate incidental formatter churn from the requested work.

## Verification Contract

Require the original project check to pass and the resulting diff to remain scoped. If satisfying a diagnostic changes behavior, require the relevant behavioral verification as well.

## Failure Recovery

If no canonical command is documented, infer it from checked-in configuration and automation rather than installing a preferred tool. If automatic fixes expand scope, narrow their target or retain only task-related edits without overwriting user changes.

## Memory Policy

Read memory as a hint for project-specific conventions and verify it against current configuration. Write only a stable recurring recovery rule confirmed by successful checks.

## Stop Conditions

Stop when the requested style gate passes with a reviewed scoped diff, or when missing dependencies, contradictory configuration, or inaccessible generated inputs prevent a correct repair.

## Anti-Patterns

- Do not introduce or replace tooling merely to solve a local diagnostic.
- Do not disable rules, add blanket ignores, or reclassify errors without a supported reason.
- Do not format unrelated files indiscriminately.
- Do not report success without rerunning the failing project check.
