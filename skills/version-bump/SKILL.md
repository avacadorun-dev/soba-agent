---
name: version-bump
description: Update a project's authoritative version references consistently according to its release policy and verify the resulting artifact identity. Use for explicit release versions or supported bump requests across any ecosystem.
soba:
  version: 1
  triggers:
    - bump project version
    - prepare release version
    - synchronize version references
  memory-policy: read
---

# Version Bump

## Purpose

Change version identity consistently without assuming a version scheme, package format, release tool, or publishing workflow.

## Triggers

Apply this workflow when the user requests a target version, a release bump, or synchronization of inconsistent project version references.

## Inputs To Inspect

- The exact requested version or bump intent.
- Project release instructions, versioning policy, and automation.
- Authoritative manifests, generated metadata, runtime output, lock data, tests, and documentation that consume the version.
- Current release state and compatibility constraints relevant to the project.

## Procedure

1. Determine the version scheme and authoritative source from project evidence.
2. Use the exact target when provided. When only a bump intent is given, apply the project's documented policy; ask rather than inventing a policy when different choices have material release impact.
3. Find derived references by tracing consumers of the authoritative version instead of replacing matching strings globally.
4. Update authoritative and required derived artifacts through the project's established workflow when one exists.
5. Exclude historical examples, dependency versions, fixtures, and unrelated documentation unless the release contract requires them.
6. Verify that manifests, runtime or artifact identity, tests, and generated outputs agree where applicable.
7. Review the diff for accidental version changes and summarize any intentionally deferred release artifacts.
8. Commit, tag, publish, or deploy only when the user explicitly requests those separate actions.

## Verification Contract

Require every authoritative version source and relevant consumer to agree under the project's canonical checks. State the target, files or artifacts updated, and exact verification evidence.

## Failure Recovery

If existing references disagree, identify the authority before editing and report stale derived values. If generation requires unavailable tooling or external state, update only what can be verified safely and mark the remaining release step explicitly.

## Memory Policy

Read memory as a hint for release conventions and verify it against current automation. Write only a repeated, stable release rule confirmed by project evidence and successful verification.

## Stop Conditions

Stop when the requested version is consistent and verified, or when an unresolved version-policy decision or unavailable authoritative generator prevents a correct bump.

## Anti-Patterns

- Do not assume semantic versioning or choose a bump level from commit labels alone.
- Do not replace every occurrence of the old version indiscriminately.
- Do not change dependency versions as though they were the project version.
- Do not create commits, tags, releases, or publications without explicit authorization.
