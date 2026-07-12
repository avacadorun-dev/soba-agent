---
name: feature-implementation
description: Implement a requested capability within an existing project, from acceptance criteria through proportionate verification. Use when asked to add or extend user-visible behavior, interfaces, workflows, or integrations.
soba:
  version: 1
  triggers:
    - implement feature
    - add capability
    - extend behavior
  memory-policy: read
---

# Feature Implementation

## Purpose

Deliver the requested behavior through the project's existing architecture with explicit scope and evidence.

## Triggers

Apply this workflow when the user requests new behavior or an extension to an existing interface, workflow, integration, or user experience.

## Inputs To Inspect

- User constraints, acceptance criteria, and non-goals.
- Project and directory-specific instructions.
- The modules, contracts, and data owners responsible for the behavior.
- Similar implementations and project-native abstractions.
- Relevant tests, fixtures, task definitions, and release constraints.

## Procedure

1. Restate the requested outcome as observable behavior and identify material ambiguities from available context.
2. Locate the smallest existing ownership boundary that can implement the behavior coherently.
3. Inspect analogous paths and their tests before introducing new structure.
4. Plan the change when it crosses multiple contracts, persists data, changes compatibility, or carries notable risk.
5. Implement the smallest complete vertical slice, preserving project conventions and avoiding speculative flexibility.
6. Add or update tests at the lowest level that proves the contract without coupling to internals.
7. Exercise error, boundary, and compatibility paths in proportion to risk.
8. Run targeted verification, then project-required broader checks, and review the final diff.

## Verification Contract

Map each acceptance criterion to a passing automated check or a named observable demonstration. Include contract checks, static analysis, packaging, or integration verification only when relevant to the project and change.

## Failure Recovery

Treat failed checks as design evidence. Narrow the failure, revisit the owning boundary, and prefer correcting the implementation over weakening the contract. Surface a requirements conflict only after inspecting the relevant project evidence and viable compatible paths.

## Memory Policy

Read memory as a hint for project conventions and verify it locally. Write only a stable, repeated convention that was confirmed during successful implementation and would prevent future mistakes.

## Stop Conditions

Stop when the requested behavior and relevant failure paths are implemented and verified, or when a missing product decision or unavailable external dependency prevents a correct implementation.

## Anti-Patterns

- Do not invent requirements, options, or extension points.
- Do not replace an established architecture without evidence that it cannot support the request.
- Do not leave partially connected layers while claiming a complete feature.
- Do not skip verification for user-visible or contract-level behavior.
