# Task 06 checkpoint — Evidence + completion gate baseline

## Scope

Checkpoint after tasks 04-06. Runtime now has an Evidence Ledger, task-kind verification policy, and aligned `finish`
schema.

## Ledger fields

- Tool outcomes record inspect/search/mutation/diagnostic/verification/finish evidence.
- Mutations keep file paths when tool args expose them.
- Summary exposes successful tool calls, command verification calls, inspection evidence calls, verification kinds,
  unverified mutation IDs, unverified code/docs mutation IDs, active diagnostics, and all evidence entries.
- Completion state receives public Evidence Ledger IDs for `criteria[].evidenceIds` validation.

## Verification policy matrix

- `read_only_question`: no verification.
- `docs_change`, `review`: inspection evidence.
- `lint_failure`: lint command evidence.
- `test_failure`: test command evidence.
- `bug_fix`, `code_change`: test/run/lint/typecheck command evidence.
- `feature`, `refactor`: test/lint/typecheck/build command evidence.
- `release_task`: full gate evidence.
- `unknown`: conservative command verification.

## Finish schema

Public `finish` input:

```ts
{
  summary: string;
  status: "completed" | "blocked" | "completed_with_unverified_changes";
  criteria: Array<{
    criterion: string;
    evidenceIds?: string[];
  }>;
}
```

Notes:

- `message` is no longer a public field.
- `completed_with_unverified_changes` is accepted only when explicitly allowed by user wording or when a future runtime
  policy marks verification impossible.
- Rejection messages reference public fields only: `summary`, `status`, `criteria`, `criteria[].evidenceIds`.

## Regression cases

Failing cases:

- `completed` after code mutation without command verification.
- read/inspection evidence used as proof for code mutation.
- `completed_with_unverified_changes` without explicit permission.
- unknown `criteria[].evidenceIds`.
- legacy `message` without `summary`.

Passing cases:

- docs-only mutation with inspection evidence.
- feature/refactor/code mutation with accepted command evidence.
- review with inspection and no mutation verification.
- blocked finish with concrete blocker.
- explicitly permitted `completed_with_unverified_changes`, visibly marked in final answer.
