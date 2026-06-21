---
name: version-bump
description: Bump project version files and prepare the matching release commit.
soba:
  version: 1
  triggers:
    - version bump
    - release version
    - bump package
  memory-policy: read
---

# Version Bump

## Purpose

Update project version references consistently and verify the release-ready change.

## Triggers

Use this skill when the user asks to bump a version, prepare a release version, or update version references before a release commit.

## Inputs To Inspect

- Project instructions for release workflow.
- Version fields in package manifests.
- CLI or source constants that print the version.
- Tests that assert the version string.
- Recent commits or the exact version requested by the user.

## Procedure

1. Prefer the exact version or bump type specified by the user.
2. If the user did not specify a bump, inspect recent commits and choose patch unless features or breaking changes clearly require minor or major.
3. Locate every authoritative version reference used by runtime code and tests.
4. Update only those version references and any directly required snapshots or tests.
5. Run the project-required verification commands for version changes.
6. Prepare a release commit only when the user asked for a commit and verification passes.

## Verification Contract

The manifest version, runtime version output, and version assertions must agree. Required tests, linting, type checks, and build commands for the project must pass before reporting completion.

## Failure Recovery

If version references disagree before the change, report the mismatch and update the authoritative set consistently. If verification fails after the bump, fix version-related failures first and avoid unrelated refactors.

## Memory Policy

Read project memory for known release conventions if available. Write memory only after a verified, repeated release convention is discovered and it contains no secrets.

## Stop Conditions

Stop when all version references are updated and verification passes, or when the requested target version conflicts with project constraints.

## Anti-Patterns

- Do not bump versions opportunistically during unrelated work.
- Do not create tags or publish packages unless explicitly requested.
- Do not infer a major release without concrete breaking-change evidence.
