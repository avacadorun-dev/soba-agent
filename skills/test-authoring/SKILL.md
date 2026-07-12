---
name: test-authoring
description: Design and add focused tests for a behavior contract, regression, edge case, or coverage gap using project-native test practices. Use when asked to create or improve automated tests in any language or runtime.
soba:
  version: 1
  triggers:
    - add automated tests
    - capture regression test
    - cover behavior contract
  memory-policy: read
---

# Test Authoring

## Purpose

Create maintainable tests that fail for a meaningful contract violation and give useful diagnostic evidence.

## Triggers

Apply this workflow when the user asks to add tests, preserve a regression, cover acceptance criteria, or strengthen weak behavioral coverage.

## Inputs To Inspect

- The behavior contract, bug report, use case, or acceptance criteria.
- Project instructions and nearby tests at the relevant boundary.
- Public interfaces, fixtures, helpers, and existing test commands.
- Sources of nondeterminism, external dependencies, and cleanup requirements.
- Production changes only when the request also authorizes implementation.

## Procedure

1. Translate each requested behavior into setup, action, observable outcome, and failure meaning.
2. Select the narrowest test level that proves the contract with realistic collaboration between components.
3. Reuse project-native structure, fixtures, assertions, and naming without assuming a framework or language.
4. Cover the primary behavior first, then boundaries and failures justified by risk or the reported regression.
5. Keep doubles minimal and place them at true external or expensive boundaries; make assumptions explicit.
6. Confirm a regression test detects the pre-fix defect when practical and safe.
7. Change production code only when the user's scope includes that work.
8. Run the targeted test, check for deterministic cleanup, then run broader verification when production or shared test infrastructure changed.

## Verification Contract

Require the new tests to pass through the project's canonical workflow and to fail for the intended contract violation when that can be demonstrated safely. Ensure assertions observe outcomes rather than incidental implementation details.

## Failure Recovery

If a test is flaky, isolate time, randomness, concurrency, ordering, shared state, or external I/O rather than adding retries blindly. If setup dominates the behavior, move to a more appropriate boundary or reuse an established fixture.

## Memory Policy

Read memory as a hint for project test conventions and verify it nearby. Write only a stable, recurring test pattern confirmed by the project and successful verification.

## Stop Conditions

Stop when the requested behavior is covered by passing, deterministic tests, or when missing requirements make a meaningful oracle impossible.

## Anti-Patterns

- Do not assert private implementation details unless they are the explicit contract.
- Do not duplicate static checks with tests that cannot fail meaningfully.
- Do not over-mock the behavior under test or mock the assertion itself.
- Do not weaken unrelated assertions or change production code outside the requested scope.
