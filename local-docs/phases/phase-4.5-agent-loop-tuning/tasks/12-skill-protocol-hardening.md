# 12 — Skill protocol hardening

**ID:** 0.4-AL-10  
**Priority:** P1  
**Estimate:** M  
**Depends on:** 0.4-AL-01  
**Block:** Built-in Skills 2.0

## Goal

Валидировать built-in skills как исполнимые playbooks с metadata, triggers, procedure, verification, recovery и memory policy.

## Local context

Skills не должны быть просто советами. Project instructions override generic examples.

## Suggested files

- `src/core/skills/`
- `tests/core/skills/`
- `skills/`

## Requirements

- Parser supports optional `soba` metadata fields.
- Bundled skills require sections: Purpose, Triggers, Inputs To Inspect, Procedure, Verification Contract, Failure Recovery,
  Memory Policy, Stop Conditions, Anti-Patterns.
- Malformed bundled skill fails validation.
- Skill injection is just-in-time and minimal.
- Project instructions first rule is enforced.

## Tests

- valid skill passes validation;
- missing required section fails validation;
- malformed `soba` metadata fails clearly;
- project instructions are injected before generic skill examples;
- deactivated skill is not injected.

## Verification

```bash
bun test tests/core/skills
bun test
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional here, mandatory after task 14.
