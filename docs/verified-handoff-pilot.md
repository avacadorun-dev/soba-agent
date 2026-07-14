# Verified Handoff: six-week adoption pilot

This pilot tests whether SOBA's evidence report changes real review decisions. It does not test demand for a standalone
proof platform, and it does not add product telemetry.

## Scope

- Duration: six weeks.
- Cohort: 10 external repositories with tests and real, non-trivial coding tasks.
- User: an individual developer or small team using SOBA locally.
- Data collection: manual, opt-in, and agreed with each participant before the first task.
- Artifact under test: the built-in `soba prove --format markdown` Verified Handoff.

SOBA remains the producer of Proof Bundle v1. CI remains the independent merge authority. Do not ask participants to
replace repository CI with receipt validation.

## Per-task interview log

Record only the participant's answers and repository identifier agreed for the pilot:

- Did the participant open the evidence report?
- Did it affect a decision to accept, revise, or re-check the result?
- Did it reveal a stale or missing check, scope creep, or an unsupported narrative claim?
- Was the Markdown copied into a pull request or review thread?
- Did another person use the report during review?
- Did the participant ask to read receipts from another tool or produce receipts outside SOBA?

Do not collect command output, source code, receipt contents, repository secrets, or personal data unless the participant
separately and explicitly asks to share a concrete artifact for debugging.

## Weekly cohort check

For each repository, record `used this week: yes/no` and a short participant-provided reason. At week four, explicitly
ask whether Verified Handoff is still enabled and whether the participant wants to keep the completion gate.

Track these aggregate counts:

| Signal | Count |
| --- | ---: |
| Repositories using handoff weekly | 0–10 |
| Users explicitly asking to keep the gate | 0–10 |
| Teams regularly moving Markdown into review | 0–10 |
| Independent receipt consumers or producers requested | 0+ |
| External CI gates depending on the JSON contract | 0+ |

## Decision rules after six weeks

- Continue Verified Handoff as an embedded differentiation when at least 5 repositories use it weekly and at least 3
  users explicitly want to keep the gate.
- Build a focused PR integration when at least 3 teams regularly move the report into their review workflow.
- Extract `@soba/proof` only when there are at least 2 independent consumers or producers and at least 1 external CI
  gate depends on the JSON contract.
- If retained usage is below 3 repositories, keep evidence only as an internal completion-safety mechanism and move the
  product focus to agent quality.

These thresholds are decided before the pilot to avoid turning weak curiosity into a platform roadmap. Requests for a
policy DSL, remote storage, SARIF, key management, or a universal producer SDK are recorded as qualitative input but do
not enter the implementation backlog without the independent-consumer threshold above.

## Final report

Publish aggregate counts, the decision reached by the rules above, representative anonymized decision changes, and the
largest sources of false confidence. Explicitly separate observed usage from participant requests and maintainer
interpretation.
