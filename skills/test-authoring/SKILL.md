---
name: test-authoring
description: Add focused tests from use cases, regressions, or behavior contracts.
soba:
  version: 1
  triggers:
    - write tests
    - add coverage
    - regression test
  memory-policy: read
---

# Test Authoring

## Purpose

Create tests that prove behavior through realistic inputs, clear assertions, and project-native tooling.

## Triggers

Use this skill when the user asks to add tests, improve coverage, capture a regression, or turn use cases into automated checks.

## Inputs To Inspect

- Project instructions for test framework and runtime.
- Use cases, bug reports, or acceptance criteria.
- Existing tests near the target module.
- Public APIs and fixtures already used by the project.
- Commands for targeted and full verification.

## Procedure

1. Read project instructions and nearby test style.
2. Map each requested behavior or edge case to a test case.
3. Prefer integration-style tests with real files or processes when the project pattern supports it.
4. Keep mocks minimal and explicit.
5. Make the test fail for the intended reason when practical, then implement or adjust code only if the user requested a fix too.
6. Run the targeted test file, then broader checks when production code changed.

## Verification Contract

New or updated tests must pass with the project test command. If production code changed, verification must include tests that exercise the changed behavior.

## Failure Recovery

If the test is flaky or over-specified, reduce the assertion to the behavior contract. If setup is too expensive, reuse existing fixtures or build a smaller deterministic fixture.

## Memory Policy

Read memory for known test conventions. Write memory only for stable, verified test patterns that recur across the project.

## Stop Conditions

Stop when the requested tests pass and accurately cover the behavior, or when missing requirements prevent a meaningful assertion.

## Anti-Patterns

- Do not assert implementation details unless they are the contract.
- Do not add tests that only duplicate type checks.
- Do not hide failures by weakening assertions unrelated to the requested behavior.
