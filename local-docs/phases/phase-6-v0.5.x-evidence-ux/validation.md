# Phase 6 Validation — Evidence UX + Diff Review

## Evidence Bundle Validation

- Every completed code task shows changed files.
- Every completed code task shows command/check status.
- Failed and skipped checks remain visible.
- Docs-only tasks show inspection evidence or an explicit "command verification not required" note.
- Unverified completion is labeled differently from verified completion.
- Evidence is derived from runtime state, not assistant prose.

## Diff Review Validation

- Created, modified, deleted and renamed files appear in diff summary.
- Large diffs are truncated with a visible marker.
- Accept/reject file works.
- Accept/reject hunk works where the active surface supports hunk application.
- Rollback current turn works.
- Review actions are recorded as evidence instead of erasing history.

## Flight Recorder Validation

- Recorder artifact contains prompt snapshot, runtime events, tool calls, approvals, diff summary, evidence bundle and completion decision.
- Recorder artifact does not contain API keys, OAuth tokens or authorization headers.
- Hidden chain-of-thought is not persisted.
- Large outputs are truncated or summarized according to configured limits.

## First-Run Validation

- `soba init` can configure a provider path.
- First useful task can start without reading internal documentation.
- Existing configured projects are not overwritten silently.
- Setup errors are actionable and do not leak secrets.

## ACP/Zed Validation

- ACP final handoff includes changed files, command/check status and risk notes.
- Tool calls continue to include raw input/output, file locations and command metadata.
- Slash commands remain advertised through ACP session metadata.
- ACP adapter consumes the shared evidence bundle and does not make verification policy decisions.

## Release Gate

```bash
bun test
bun run lint
bunx tsc --noEmit
bun run build
```

Manual:

- CLI one-shot evidence smoke;
- TUI evidence and diff review smoke;
- ACP/Zed evidence smoke when Zed is available;
- first-run smoke on a clean temp project.
