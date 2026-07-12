---
name: codebase-orientation
description: Build an evidence-based map of an unfamiliar repository or subsystem before planning or changing it. Use for architecture questions, onboarding, ownership discovery, or the first task in an unfamiliar area.
soba:
  version: 1
  triggers:
    - orient in codebase
    - map architecture
    - find implementation boundary
  memory-policy: read
---

# Codebase Orientation

## Purpose

Discover only the architecture, workflows, and constraints needed to act confidently in the requested area.

## Triggers

Apply this workflow to architecture explanations, onboarding, ownership discovery, or implementation work in an unfamiliar repository or subsystem.

## Inputs To Inspect

- Project and directory-specific instructions.
- Top-level documentation, manifests, task definitions, and runtime configuration.
- Entry points and source layout near the requested behavior.
- Representative tests, fixtures, and public contracts.
- Relevant recent changes and project memory when available.

## Procedure

1. Translate the request into a bounded area, behavior, or data flow to understand.
2. Inspect the top-level structure and project-defined commands without assuming a language, build system, or repository shape.
3. Locate entry points, ownership boundaries, dependencies, state transitions, and external interfaces relevant to that boundary.
4. Read representative implementation and tests on both sides of important boundaries.
5. Trace one concrete path through the system to validate the emerging map.
6. Summarize confirmed module roles, data flow, extension points, verification commands, and risk areas.
7. Separate observed facts from assumptions and name the next useful action when the request includes implementation.

## Verification Contract

Support the map with inspected files, symbols, configuration, or command output. Do not infer architecture from directory names alone. Validate important relationships from both producer and consumer sides when practical.

## Failure Recovery

When documentation is absent or stale, work outward from executable entry points, task definitions, and tests. When multiple ownership hypotheses remain plausible, inspect one discriminating artifact for each before choosing.

## Memory Policy

Read memory as a navigation hint and confirm it against current artifacts. Write no memory unless the user asks or a stable convention is verified across multiple project sources.

## Stop Conditions

Stop when the user has a focused, actionable map of the requested area. Stop as blocked only when inaccessible generated code, dependencies, or external systems are essential to the map.

## Anti-Patterns

- Do not inventory the entire repository without a task boundary.
- Do not confuse file layout with runtime architecture.
- Do not present documentation claims as current behavior without corroboration.
- Do not start broad refactoring during orientation.
