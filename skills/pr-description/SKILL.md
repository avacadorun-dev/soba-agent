---
name: pr-description
description: Draft an evidence-based pull request or merge request description from a resolved change set and project template. Use for reviewer summaries, change-request bodies, risk notes, or verification sections without publishing anything.
soba:
  version: 1
  triggers:
    - draft pull request description
    - write merge request body
    - summarize change for review
  memory-policy: none
---

# Pull Request Description

## Purpose

Give reviewers the context, behavioral summary, evidence, and risk needed to evaluate a proposed change efficiently.

## Triggers

Apply this workflow when the user asks for text describing a pull request, merge request, or equivalent review proposal.

## Inputs To Inspect

- The requested source and target refs or supplied change set.
- Project contribution instructions and change-request template.
- Commits, changed paths, and representative detailed diffs.
- Requirements, issue references, migrations, screenshots, and verification evidence actually available.
- Known limitations and follow-up work within the selected scope.

## Procedure

1. Resolve and state the exact comparison boundary.
2. Read the changes that define behavior, not only commit subjects or statistics.
3. Explain why the change exists only when the motivation is supported by the request or project evidence.
4. Group implementation details by outcome and reviewer concern.
5. Record verification that actually ran, preserving meaningful command or operation names and results.
6. Surface compatibility, migration, security, data, rollout, and operational risk when the change implicates them.
7. Follow the repository template; otherwise use a compact structure suited to the change, such as Summary, Changes, Verification, and Risk.
8. Keep absent sections out rather than filling them with boilerplate.

## Verification Contract

Ensure every statement matches the resolved change set or explicit user-provided context. Do not claim passing checks, screenshots, issue closure, compatibility, or deployment state without evidence.

## Failure Recovery

If the comparison base is ambiguous, inspect repository defaults and ask only when plausible bases materially differ. If the range mixes unrelated work, make the mixed scope visible and organize it into coherent reviewer units.

## Memory Policy

Do not write memory. Use current project templates and instructions as the authority for format.

## Stop Conditions

Stop after producing copy-ready description text, or after identifying the unavailable comparison boundary that prevents an accurate description.

## Anti-Patterns

- Do not publish, open, update, or submit a change request unless explicitly asked.
- Do not invent tests, links, screenshots, migrations, or risk assessments.
- Do not paste a file list in place of explaining behavior.
- Do not include empty boilerplate checklists the project does not require.
