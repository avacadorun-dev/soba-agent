---
name: feature-implementation
description: Implement a requested feature through scoped design, code, and verification.
soba:
  version: 1
  triggers:
    - feature implementation
    - add capability
    - implement request
  memory-policy: read
---

# Feature Implementation

## Purpose

Deliver a requested feature in the existing architecture with clear scope, maintainable code, and verification evidence.

## Triggers

Use this skill when the user asks to add behavior, expose a capability, extend a workflow, or implement a planned task.

## Inputs To Inspect

- Project instructions and phase docs.
- Existing modules that own the behavior.
- Similar features and local helper APIs.
- Tests and use cases for the requested behavior.
- Build, lint, and type-check scripts.

## Procedure

1. Read project instructions first.
2. Identify the smallest existing module boundary that owns the requested behavior.
3. Inspect similar code paths before designing new abstractions.
4. Make a concise implementation plan when the change spans multiple files or contracts.
5. Implement in small steps, preserving existing style and naming.
6. Add focused tests that map to the relevant use case or behavior contract.
7. Run targeted tests, then broader checks required by the project.

## Verification Contract

The feature must have passing automated verification appropriate to its risk: tests for behavior, type checks for contracts, lint for style, and build for packaged output when relevant.

## Failure Recovery

If tests or type checks fail, treat the failure as feedback on the design and fix the root cause. If requirements conflict with existing architecture, report the conflict and choose the smallest compatible path.

## Memory Policy

Read memory for stable project conventions. Write memory only when a repeated implementation convention is verified and would reduce future mistakes.

## Stop Conditions

Stop when the feature is implemented, verified, and summarized with changed files and commands, or when a missing requirement or external dependency blocks correct implementation.

## Anti-Patterns

- Do not invent a new architecture when an existing pattern fits.
- Do not add speculative options or unused extension points.
- Do not skip tests for user-visible behavior.
