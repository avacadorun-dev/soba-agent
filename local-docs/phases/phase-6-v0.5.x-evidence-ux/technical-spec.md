# Phase 6 Technical Spec — Evidence UX + Diff Review

This document defines the target architecture for Evidence Bundle v1, Diff Review UX and the first Flight Recorder foundation.

## Evidence Bundle Model

Evidence Bundle is a protocol-neutral turn artifact. It is built from trusted runtime sources:

- Evidence Ledger;
- tool execution outcomes;
- verification controller results;
- permission decisions;
- git/worktree diff state;
- runtime completion status.

It must not be assembled from assistant prose.

Conceptual shape:

```ts
interface EvidenceBundle {
  version: 1;
  sessionId: string;
  turnId: string;
  status: "verified" | "partially_verified" | "unverified" | "blocked";
  summary: string;
  changedFiles: EvidenceChangedFile[];
  commands: EvidenceCommandRun[];
  checks: EvidenceCheck[];
  approvals: EvidenceApproval[];
  risks: EvidenceRisk[];
  diff?: EvidenceDiffSummary;
  createdAt: string;
}
```

Adapters may render less detail, but they must preserve the status and risk semantics.

## Changed Files

Changed file records should include:

- path;
- operation: created, modified, deleted, renamed;
- source: tool write/edit, delegated editor write, shell mutation, unknown;
- insertion/deletion counts when available;
- whether the file remains changed at handoff time.

The builder should prefer structured file mutation evidence, then fall back to `git diff --stat` and status where needed.

## Commands And Checks

Command records should include:

- command string;
- working directory;
- started/ended timestamps or duration;
- exit status;
- stdout/stderr preview with redaction;
- verification kind when known: test, lint, typecheck, build, run, diff inspection, manual inspection.

Checks are user-facing interpretations over commands and inspection events:

- passed;
- failed;
- skipped;
- not run;
- not required.

## Diff Review

Diff Review is a controlled mutation review layer over current turn changes.

Required capabilities:

- file summary;
- inline diff text;
- accept/reject file;
- accept/reject hunk where supported;
- rollback current turn.

The review state must be separate from completion state. A rejected hunk or file is a new mutation event and must be recorded in the evidence bundle.

## Flight Recorder Foundation

Flight Recorder stores a replayable, redacted turn record:

- user prompt snapshot;
- assistant text deltas;
- runtime events;
- tool calls and results;
- permission requests/decisions;
- evidence bundle;
- diff summary;
- completion decision.

Hidden chain-of-thought is never recorded. Provider reasoning summaries may be recorded only when they are already user-visible or explicitly safe to persist.

## Rendering Requirements

CLI, TUI and ACP consume the same evidence bundle.

- CLI can render compact Markdown/plain text.
- TUI can render collapsible sections and diff review controls.
- ACP can map evidence to tool updates, assistant text and future protocol-native structures where available.

The final user handoff must show:

1. changed files;
2. commands/checks;
3. verification status;
4. known risks or missing checks.

## Security

- Redact secrets from command output, paths where needed and environment-derived values.
- Do not persist full raw outputs by default if they exceed configured limits.
- Do not include API keys, OAuth tokens or MCP authorization headers.
- Treat MCP tool output as untrusted content in recorder artifacts.
