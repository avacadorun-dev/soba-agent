# Phase 6 Implementation Plan — Evidence UX + Diff Review

## Release Boundary

Phase 6 is the Evidence UX phase after `v0.5.0` Clean Architecture + ACP.

It should close the public `v0.5` promise:

1. clear verification summary;
2. diff review before handoff;
3. smoother first run.

It may ship as one or more `0.5.x` releases.

## Task Sequence

### 00. Current State Audit

Status: completed on 27 June 2026. See [Current State Audit](./current-state-audit.md).

- Audit Evidence Ledger fields.
- Audit runtime events emitted by CLI/TUI/ACP paths.
- Audit git/diff helpers currently available.
- Identify which mutation types cannot yet be tied to a changed file.

Exit:

- gap list for Evidence Bundle v1;
- no product behavior changes.

### 01. Evidence Bundle Schema And Builder

Status: completed on 27 June 2026.

Create a protocol-neutral bundle builder over:

- Evidence Ledger summary;
- tool execution outcomes;
- verification controller state;
- current git status/diff;
- completion request/decision.

Exit:

- focused unit tests for verified, partially verified, unverified and blocked outcomes;
- no adapter-specific formatting inside the builder.

Delivered:

- `src/core/evidence/evidence-bundle.ts`
- `src/core/evidence/index.ts`
- `tests/core/evidence/evidence-bundle.test.ts`
- Pure builder over `EvidenceLedgerSummary` plus optional changed-file, command and approval snapshots.
- Bundle statuses: verified, partially verified, unverified and blocked.
- User-facing changed files, commands, checks and risks.

### 02. Command And Check Classification

Status: completed on 27 June 2026.

Normalize command outcomes into user-facing checks:

- test;
- lint;
- typecheck;
- build;
- run;
- diff inspection;
- manual inspection;
- skipped/not required.

Exit:

- skipped checks have explicit reasons;
- failed checks remain visible in final evidence.

Delivered:

- Ledger verification/inspection entries are normalized into `EvidenceCheck` records.
- Optional command snapshots with `verificationKind` are classified into checks even without ledger entries.
- Failed, skipped, running and unknown command outcomes map to explicit check statuses and risk records.

### 03. Final Handoff Rendering

Status: completed on 27 June 2026.

Render the evidence bundle in the final response path:

- changed files;
- commands/checks;
- pass/fail/skipped/not-run status;
- risk notes.

Exit:

- verified and unverified completion are visually/textually distinct;
- docs-only tasks do not pretend command verification ran.

Delivered:

- Compact evidence handoff renderer for `EvidenceBundle`.
- Explicit `finish` final answers append evidence status, changed files, checks and risks.
- Unverified/partially verified outcomes now carry visible risk text in the final assistant message.
- Text-only final answers without the `finish` tool remain unchanged until they can supply a validated completion status.

### 04. Diff Summary Builder

Status: completed on 27 June 2026.

Add a diff summary abstraction:

- file status;
- insertion/deletion counts;
- compact inline diff;
- current-turn mutation association where available.

Exit:

- tests cover created, modified, deleted and renamed files;
- large diffs are truncated with a visible marker.

Delivered:

- `src/core/evidence/diff-summary.ts`
- Pure diff summary builder for created, modified, deleted, renamed and unknown file operations.
- Inline text diff generation from supplied `oldText`/`newText`.
- Added/removed totals and per-file mutation ID association.
- Truncation marker for large inline diffs.

### 05. Diff Review Controls

Implement the first review actions:

- accept file;
- reject file;
- accept hunk where supported;
- reject hunk where supported;
- rollback current turn.

Exit:

- review actions record mutation/evidence events;
- rollback leaves an audit trail.

Status: completed.

Delivered:

- `src/core/evidence/diff-review.ts`
- Pure diff review state over a turn diff.
- File-level accept/reject actions with audit records.
- Hunk-level accept/reject actions when explicit hunk metadata is available.
- Rollback action that rejects all current turn changes and records a rollback mutation plan.
- Evidence bundle support for review action records.

### 06. TUI Evidence Surface

Add a focused TUI surface for:

- evidence bundle;
- check list;
- diff summary;
- review actions.

Exit:

- no nested card UI;
- long paths and command text wrap safely;
- keyboard navigation works for review actions.

Status: completed.

Delivered:

- TUI evidence parser for the shared handoff block.
- Dedicated evidence message type and TUI block renderer.
- Evidence block sections for status, changed files, diff summary, checks, risks and review actions.
- Evidence blocks participate in the existing focused-block keyboard navigation and expand/collapse flow.

### 07. ACP Evidence Mapping

Expose evidence through ACP without inventing a parallel model:

- assistant final text;
- tool call/update metadata where applicable;
- file locations;
- command raw input/output;
- risk notes.

Exit:

- Zed users can see what changed, what ran and what passed/failed;
- ACP remains an adapter over the shared evidence bundle.

Status: completed.

Delivered:

- Shared application parser for the evidence handoff block.
- ACP assistant update metadata under `_meta.soba.evidence`.
- ACP tool lifecycle evidence metadata for start/result/end updates.
- Existing ACP raw input/output, locations and diff content remain intact.

### 08. Flight Recorder V1 Storage

Persist redacted turn artifacts:

- prompt snapshot;
- runtime events;
- tool calls/results;
- approvals;
- diff summary;
- evidence bundle;
- completion decision.

Exit:

- recorder artifacts can be inspected manually;
- replay UI can be deferred.

Status: completed.

Delivered:

- Session JSONL sidecar `flight_record` entries.
- Redaction/truncation helper for persisted artifacts.
- Prompt snapshot, runtime event, tool call/result, approval, evidence bundle and completion decision records.
- Flight records are inspectable through `SessionManager.getFlightRecords()` and excluded from the conversation tree.

### 08a. MCP Hotreload Command

Status: completed on 27 June 2026.

Implement explicit MCP config hotreload:

- `/mcp reload` rereads `.soba/mcp.json`;
- removed servers are stopped;
- current MCP tools are resynchronized without restarting Soba/Zed;
- invalid new config keeps the previous manager and tool registry intact.

Exit:

- Zed users can reload MCP config through the same command path as `/mcp status`;
- no implicit filesystem watcher mutates tools during an active turn.

Delivered:

- Application-level `McpRuntimeController`.
- Runtime command `/mcp reload` across print/TUI/ACP surfaces.
- Localized reload summaries and updated MCP secret guidance.
- Focused tests for command output and controller reload/failure behavior.

### 09. First-Run Experience

Status: completed on 27 June 2026.

Implement `soba init`:

- provider setup;
- project trust setup;
- optional MCP detection prompt;
- first task suggestion.

Exit:

- new user can reach first useful run in under 30 seconds on a normal project.

Delivered:

- Top-level `soba init` route that exits before AgentLoop/runtime startup.
- `--check`, `--yes`, `--skip-provider`, `--skip-trust` and `--skip-mcp` flags.
- Provider readiness check and fallback to the existing first-time provider wizard when interactive setup is needed.
- Project trust approval/update path over the existing `ProjectTrustStore` and skill fingerprint.
- MCP detection for canonical `.soba/mcp.json` plus optional copy from common non-canonical MCP config locations.
- First useful task suggestion after setup.

### 10. Sessions Management

Status: completed on 27 June 2026.

Add `/sessions` management:

- list;
- load/resume;
- close/delete;
- evidence summary per session where available.

Exit:

- session operations use existing lifecycle service;
- no direct adapter access to persistence internals.

Delivered:

- Runtime command metadata for `/sessions` on print/TUI/ACP surfaces.
- `/sessions list` with active marker, entry count and flight-recorder evidence summary where available.
- `/sessions resume|load <id>` activates the selected `SessionManager` through the lifecycle boundary.
- `/sessions close [id]` and `/sessions delete <id>` route through `SessionLifecycleService`.
- Active-session delete is blocked to avoid recreating headerless JSONL files on the next append.

### 11. Eval And Terminal-Bench Smoke

Status: completed on 27 June 2026.

Add diagnostic harnesses:

- public eval suite seed tasks;
- Harbor + Terminal-Bench smoke profile;
- Linux x64 one-shot binary path or Bun fallback.

Exit:

- repeatable smoke runs are documented;
- no public benchmark claim unless results are stable.

Delivered:

- `scripts/smoke-diagnostics.ts` with local and Terminal-Bench profiles.
- Package shortcuts `smoke:diagnostics` and `smoke:terminal-bench`.
- Local seed eval smoke over `tests/evals/agent-loop` and `tests/evals/skills`.
- Terminal-Bench profile that resolves Linux x64 binary, built Bun entrypoint or source fallback.
- Optional Harbor workload execution gated behind `--run-external` and `--require-external`.
- Repeatable smoke documentation in [Smoke Diagnostics](./smoke-diagnostics.md).

## Mandatory Gates

For code tasks:

```bash
bun test
bun run lint
bunx tsc --noEmit
bun run build
```

For Evidence UX changes:

```bash
bun test tests/core/loop tests/core/verification tests/core/tools tests/application tests/adapters/acp
```

Manual:

- run a code mutation task and inspect evidence bundle;
- run a docs-only task and inspect inspection evidence;
- reject a file or hunk and confirm the audit trail remains visible;
- run a Zed ACP smoke when Zed is available.
