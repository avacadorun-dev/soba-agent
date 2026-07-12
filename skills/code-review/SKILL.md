---
name: code-review
description: Review a patch, change set, branch, commit, or selected files for concrete defects and risks without mutating them. Use when asked for review, readiness assessment, or findings on proposed code changes.
soba:
  version: 1
  triggers:
    - review changes
    - inspect patch
    - assess readiness
  memory-policy: none
---

# Code Review

## Purpose

Identify actionable correctness, security, compatibility, operability, and test risks in a specified change set.

## Triggers

Apply this workflow when the user requests review or a readiness assessment of code, configuration, tests, documentation that defines behavior, or a version-control change set.

## Inputs To Inspect

- Project instructions and the requested review boundary.
- The full relevant change set, including new and deleted files.
- Contracts, callers, consumers, and tests adjacent to changed behavior.
- Generated artifacts, schemas, migrations, or public interfaces affected by the change.
- Verification output when available.

## Procedure

1. Resolve the review scope and comparison basis from the request and workspace evidence.
2. Read the changed behavior in context rather than judging isolated lines.
3. Trace important inputs through success, failure, boundary, and cleanup paths.
4. Check assumptions about data, state, concurrency, permissions, compatibility, and error handling where relevant.
5. Inspect whether tests exercise the changed contract and meaningful failure modes.
6. Report findings first, ordered by impact; include a precise location, failing scenario, and why existing checks may miss it.
7. Add concise open questions only when the answer could change correctness.
8. If no findings remain, say so and name residual risks or verification gaps.

## Verification Contract

Ground every finding in inspected artifacts and a concrete failure mode. Prefer reproducing or checking a suspected issue when safe and read-only. Distinguish confirmed defects from conditional risks and questions.

## Failure Recovery

If the requested change set is unavailable or ambiguous, inspect available workspace state and resolve the smallest likely scope. Ask only when choosing the wrong boundary would materially change the review. If stable line references are unavailable, cite the narrowest symbol or section.

## Memory Policy

Do not write project memory from review findings. Read injected memory only for verified project conventions and confirm it against current artifacts.

## Stop Conditions

Stop after delivering findings-first review output for the resolved scope, or after explaining which unavailable artifact prevents a meaningful review.

## Anti-Patterns

- Do not modify files unless the user separately requests a patch.
- Do not report stylistic preferences as defects without a project rule or concrete cost.
- Do not infer a bug from unfamiliar code without tracing its contract.
- Do not bury high-impact findings under summaries or praise.
