# Phase 6 Task 00 — Current State Audit

**Status:** completed  
**Completed:** 27 June 2026  
**Scope:** audit only; no product behavior changes.

## Sources Reviewed

- `src/core/loop/evidence-ledger.ts`
- `src/core/loop/types.ts`
- `src/application/types.ts`
- `src/core/loop/agent-loop.ts`
- `src/core/tool-execution/tool-call-executor.ts`
- `src/core/verification/verification-controller.ts`
- `src/core/loop/verification-policy.ts`
- `src/core/tools/write.ts`
- `src/core/tools/edit.ts`
- `src/core/tools/bash.ts`
- `src/application/tool-delegation.ts`
- `src/core/mcp/tool-proxy.ts`
- `src/ui/terminal/interactive/lib/project-info.ts`
- `src/adapters/acp/dispatcher.ts`

## Current Evidence Ledger

`EvidenceLedger` already records the right high-level categories:

- inspect/search;
- mutation;
- diagnostic;
- verification;
- checkpoint;
- reflection;
- recovery attempt;
- finish attempt.

The summary already exposes:

- successful tool call IDs;
- verification evidence call IDs;
- inspection evidence call IDs;
- verification kinds;
- mutation flags;
- unverified mutation IDs;
- active diagnostic IDs;
- all ledger entries.

This is enough to decide whether completion is allowed, but it is not enough to render a trustworthy user-facing Evidence
Bundle without more normalization.

### Ledger Limitations

- `EvidenceToolOutcome` only receives `toolCallId`, `toolName`, raw arguments, `isError`, text output and iteration.
- It does not receive `ToolResult.details`, duration, cwd, exit code, timeout state, truncation state or permission decision.
- File mutation detection is name-based: only `write` and `edit` are treated as mutation tools.
- Mutation entries do not know operation type: created, modified, deleted or renamed.
- File paths come from tool arguments and can be absolute, relative or missing depending on the tool path.
- Successful command verification marks all currently unverified mutations as success, but the bundle still needs a
  user-facing check list and not just mutation IDs.
- Skipped auto-verifier commands are stored as `verification` entries with `rejected` status, which is useful internally
  but not yet a clean user-facing "skipped check" model.

## Runtime Events

`RuntimeEvent` is currently an alias for `AgentEvent`.

Useful event coverage exists:

- turn start/end/error;
- assistant deltas;
- tool call start/result/end;
- dangerous confirmation;
- budget updates;
- context errors;
- working narration;
- skill activation/deactivation.

The tool result event carries full `ToolResult`, so adapters can see `details`. ACP already uses this for richer tool
updates.

### Runtime Event Gaps

- There is no `evidence_bundle_created` or equivalent protocol-neutral final evidence event.
- There is no typed completion handoff event containing changed files, checks and risks.
- There is no runtime event for review actions such as accept/reject file, accept/reject hunk or rollback.
- Direct shell commands emit tool events, but they are not recorded into the turn ledger unless they run inside an agent
  turn.

## Tool Detail Inventory

### `write`

The built-in `write` tool returns:

- absolute path;
- bytes and lines;
- old text or `null`;
- new text.

This is enough to infer created vs modified and to build a file diff, but that detail is not passed into
`EvidenceLedger`.

### `edit`

The built-in `edit` tool returns:

- absolute path;
- edit count;
- full old text;
- full new text;
- textual summary.

This is enough to build file-level diff summaries, but it is currently only consumed by UI/protocol adapters.

### Delegated write

ACP/editor-delegated write returns:

- path;
- bytes;
- lines;
- delegated flag.

It does not include old text, so diff/review must fall back to git diff for delegated writes.

### `bash`

The bash tool returns:

- command;
- exit code;
- signal code;
- timeout/abort flags;
- truncation flag;
- timeout limits;
- temp output path.

This is enough for command/check classification, but the ledger only receives command text and output.

### Delegated terminal

ACP/editor-delegated terminal returns:

- command;
- terminal ID;
- exit code;
- signal code;
- timeout flag;
- delegated flag.

As with local bash, this is not normalized into an evidence command record yet.

### MCP tools

MCP tool proxy results include MCP metadata and structured content, but there is no generic side-effect/mutation
classification. Any MCP tool that changes files currently needs git diff/status fallback.

## Existing Git/Diff Helpers

There is a TUI-only helper in `src/ui/terminal/interactive/lib/project-info.ts`:

- `git diff --numstat` for tracked changes;
- `git status --porcelain` for untracked files.

This helper is not in `src/core` or `src/application`, so Evidence Bundle cannot depend on it without violating the
architecture direction. There is no protocol-neutral git status/diff service yet.

Missing core capabilities:

- porcelain status parser;
- numstat parser;
- diff text/hunk parser;
- safe truncation for large diffs;
- mapping current git state back to current-turn mutation evidence;
- file operation detection for created, modified, deleted and renamed files.

## ACP/Zed State

ACP already has the best current visibility surface:

- tool call start/update/end;
- command titles;
- raw input/output;
- file locations;
- diff-like content for tools with `oldText`/`newText`;
- slash command advertisement.

This should stay adapter-only. Phase 6 should move the evidence model underneath it, not create an ACP-specific evidence
path.

## Mutation Types Not Reliably Tied To Files

The following mutation paths cannot currently be tied to changed files through ledger data alone:

1. Bash commands that create, edit, delete or rename files.
2. ACP/editor-delegated terminal commands that mutate files.
3. MCP tools with filesystem side effects.
4. External/editor changes that happen while a turn is running.
5. Deletes and renames from shell commands.
6. Delegated writes where old content is not returned.
7. Project memory writes and other non-`write`/`edit` tools that persist data.
8. Generated artifacts produced by verification/build commands.

The Evidence Bundle builder must therefore combine structured mutation evidence with git status/diff fallback.

## Task 01 Requirements From This Audit

Task 01 should start with a protocol-neutral Evidence Bundle schema and builder that accepts existing runtime state without
rewiring the loop yet.

Minimum required inputs:

- session ID;
- turn ID or turn index;
- completion status;
- completion summary;
- `EvidenceLedgerSummary`;
- optional command/tool detail records from runtime events;
- optional git changed-file snapshot.

Minimum required outputs:

- bundle status: verified, partially verified, unverified or blocked;
- changed files;
- commands;
- checks;
- risks;
- stable version field;
- no adapter-specific formatting.

## Recommended First Cut

1. Add `src/core/evidence/` or `src/core/evidence-bundle/` as a core model/builder.
2. Keep the builder pure: no shelling out to git in Task 01.
3. Feed it `EvidenceLedgerSummary` plus optional precomputed changed files and command records.
4. Add unit tests for:
   - verified code mutation;
   - unverified code mutation;
   - docs-only inspection;
   - failed verification;
   - skipped verification;
   - blocked turn.
5. Add a separate later task for git status/diff collection after the model is stable.

## Gate

Task 00 is docs-only, but the full project gate is still required before Task 01:

```bash
bun test
bun run lint
bunx tsc --noEmit
bun run build
```
