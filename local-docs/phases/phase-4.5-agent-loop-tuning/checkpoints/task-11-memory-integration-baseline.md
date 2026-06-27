# Checkpoint: memory integration baseline

## Scope

Task 11 wires reflection memory as a post-recovery learning path. Project Memory is allowed to help planning as a hypothesis, but it does not replace current repository inspection or verification evidence.

## Checkpoint Event Behavior

- `checkpoint` remains a control signal for Agent Loop, Evidence Ledger and compaction policy.
- `milestone` can schedule a background capsule candidate after the tool batch.
- `plan_pivot` records `reason`, `nextDirection`, `completed` and `pending` in the turn checkpoint state.
- Checkpoint evidence is stored in the Evidence Ledger and can be represented in capsule artifacts.

## Capsule Artifacts

- Deterministic capsules extract checkpoint completed/pending/next direction from structured `checkpoint` tool arguments.
- Capsule artifacts include checkpoint summaries alongside modified files, read files and verification commands.
- Active skills are stored as `ActivatedSkillRef` values.
- Project memory context is injected as bounded knowledge/capsule refs, not as a raw prompt dump.

## Reflection Memory Filters

- Recovery lessons are written only after observable passing verification.
- Lessons include concise `Problem`, `Cause`, `Fix` and `Verification` fields.
- Secret-like values, bearer tokens, API keys and `${ENV:...}` placeholders are rejected before memory write.
- Duplicate lessons are skipped through a stable fingerprint tag.
- Incomplete lessons without a fix or verification are skipped.

## Known Memory Non-Goals

- Memory is not authoritative proof that current code still has the same shape.
- Memory does not satisfy completion gates by itself.
- Memory does not replace `read`, `bash` verification or other current-turn evidence.
- Failed or blocked recovery attempts do not create success lessons.
