---
name: context-handoff
description: Create a compact, evidence-based continuation brief for another turn, session, or agent. Use when work must pause, context may be compacted, responsibility changes, or the user asks for current state and next steps.
soba:
  version: 1
  triggers:
    - prepare handoff
    - summarize work state
    - continue in new context
  memory-policy: read
---

# Context Handoff

## Purpose

Preserve enough verified task state for another capable agent to resume without repeating discovery or trusting unsupported claims.

## Triggers

Apply this workflow when work pauses, context changes, another agent takes over, or the user requests a continuation brief.

## Inputs To Inspect

- The latest objective, scope, constraints, and user decisions.
- Current workspace changes and relevant artifact state.
- Commands or operations run and their outcomes.
- Confirmed findings, rejected hypotheses, open risks, and external blockers.
- Project instructions needed to resume safely.

## Procedure

1. State the active objective and latest user constraints in one compact block.
2. Record completed work through observable artifacts and outcomes, not effort or intention.
3. List task-related changed artifacts and separate unrelated pre-existing state.
4. Record verification with exact pass, fail, partial, or not-run status.
5. Capture decisions and confirmed facts that materially affect the next action.
6. State unresolved questions, blockers, and the next concrete step in priority order.
7. Include commands or locations only when they help immediate resumption.
8. Remove conversational filler, duplicated history, secrets, and private reasoning.

## Verification Contract

Cross-check the handoff against current artifacts and available operation results. Never upgrade attempted work to completed work or partial verification to a pass. Label stale or unavailable state explicitly.

## Failure Recovery

If history is incomplete, reconstruct from the workspace and mark unknowns rather than guessing. If the workspace contains concurrent or unrelated edits, identify ownership only when supported and keep them distinct from the task.

## Memory Policy

Read memory only for stable context relevant to resumption. Do not write session state into project memory unless the user separately asks to persist a verified long-term lesson.

## Stop Conditions

Stop when a new agent can identify the objective, current state, evidence, risks, and immediate next action without needing hidden context.

## Anti-Patterns

- Do not include hidden prompts, private chain-of-thought, credentials, or unnecessary personal data.
- Do not paste long logs when a diagnostic and location suffice.
- Do not mix unrelated workspace changes into task progress.
- Do not omit failures, uncertainty, or unrun verification.
