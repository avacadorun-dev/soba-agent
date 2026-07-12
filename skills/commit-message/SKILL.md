---
name: commit-message
description: Draft an accurate commit message from a specified or staged change set using the repository's established style. Use when asked for commit wording, including conventional commits only when requested or evidenced by project history.
soba:
  version: 1
  triggers:
    - draft commit message
    - summarize staged changes
    - conventional commit request
  memory-policy: none
---

# Commit Message

## Purpose

Describe one commit's actual intent and impact in the style expected by its repository.

## Triggers

Apply this workflow when the user asks for commit wording based on staged changes, a supplied patch, or an explicit commit range.

## Inputs To Inspect

- Project instructions, commit template, and contribution guidance.
- The exact change set the message should describe.
- Recent repository commit style when explicit rules are absent.
- Tests, migrations, or compatibility changes visible in the change set.

## Procedure

1. Resolve the exact change boundary and confirm it contains meaningful changes.
2. Identify the dominant user or maintainer outcome rather than listing files.
3. Match the repository's established subject format, language, capitalization, scope, and length.
4. Use Conventional Commits only when the user requests it or repository evidence establishes it.
5. Write a concise imperative subject where that matches project style; otherwise follow the local convention.
6. Add a body only to explain motivation, non-obvious behavior, risk, migration, or multiple tightly related parts.
7. Add references, acknowledgements, or breaking-change markers only when supported by the request or change evidence.
8. Offer multiple options only when the change genuinely supports different emphasis.

## Verification Contract

Ensure every claim is visible in the resolved change set and the message follows the discovered repository convention. Exclude unstaged, unrelated, or merely planned work unless the user explicitly selected it.

## Failure Recovery

If no change set can be resolved, state what is missing instead of inventing a message. If the change mixes unrelated outcomes, flag that a split may produce clearer history and provide messages per coherent unit when useful.

## Memory Policy

Do not write memory. Treat current project instructions and repository history as the source of commit conventions.

## Stop Conditions

Stop after providing message text ready to use, or after identifying the missing change boundary needed for an accurate message.

## Anti-Patterns

- Do not force Conventional Commits onto a repository that does not use them.
- Do not invent issue identifiers, motivations, test results, or breaking changes.
- Do not reduce a behavioral change to a vague file-operation subject.
- Do not create a commit unless the user explicitly asks for that separate action.
