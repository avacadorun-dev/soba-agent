---
name: lint-fix
description: Fix linting and formatting failures using the project's existing tooling.
soba:
  version: 1
  triggers:
    - lint failure
    - format failure
    - style check
  memory-policy: read
---

# Lint Fix

## Purpose

Resolve linting and formatting failures with the tools already configured by the project.

## Triggers

Use this skill when the user asks to fix lint errors, format code, make style checks pass, or recover from a failed lint command.

## Inputs To Inspect

- Project instructions and package manager requirements.
- `package.json` scripts.
- Formatter or linter config files already present in the repository.
- Runtime, formatter, and linter configuration when the project identifies them as canonical.
- The failing command output.
- The files changed in the current task.

## Procedure

1. Read project instructions first and treat them as authoritative.
2. Identify the existing lint and format commands from scripts or config.
3. Run the narrowest relevant check first when a failing command is already known.
4. Apply automatic fixes only through the project's configured command.
5. Manually fix remaining diagnostics by editing the smallest affected code paths.
6. Rerun the same check that failed, then run the broader project verification if the change can affect shared behavior.
7. Review the diff to ensure automatic fixes did not touch unrelated files.

## Verification Contract

The original failing lint or format command must pass after the fix. If code behavior changed to satisfy linting, run the relevant tests or type checks as required by the project.

## Failure Recovery

If the configured command is missing, inspect project scripts and config before choosing a fallback. If an automatic fix changes unrelated files, separate those changes from the task or report them clearly. If a diagnostic reveals a design issue, fix the underlying code rather than suppressing the rule.

## Memory Policy

Read project memory for known lint conventions if it is already available. Write memory only after a repeated project-specific lint recovery pattern is verified and does not contain secrets.

## Stop Conditions

Stop when the failing lint or format command passes and the diff is scoped, or when a missing dependency, missing script, or conflicting project instruction blocks a correct fix.

## Anti-Patterns

- Do not introduce a new linting or formatting tool.
- Do not disable rules just to silence diagnostics.
- Do not run broad automatic formatting before understanding the configured workflow.
- Do not report success without rerunning the failing command.
