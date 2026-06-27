# Phase 5 Retrospective — v0.5.0 Clean Architecture + ACP

**Status:** completed  
**Completed:** 27 June 2026

## What Shipped

Phase 5 changed the shape of SOBA more than the visible product surface:

- the runtime now has a protocol-neutral application boundary;
- CLI and ACP use the same runtime contract instead of parallel orchestration paths;
- core workflow policy is protected from app/protocol dependencies by architecture tests;
- ACP support is implemented as an adapter over runtime events, permission ports and session lifecycle services;
- Zed can receive assistant text, tool call metadata, raw input/output, file locations, permission requests and slash-command metadata.

The important product result is not only that Zed can run SOBA. The important result is that new surfaces no longer need to splice behavior into `AgentLoop` or duplicate trust, verification, memory and recovery policy.

## What Went Well

- The architecture cleanup exposed where app entrypoints, runtime composition and core workflow boundaries should live.
- ACP work forced the runtime event stream to become more explicit.
- Tool visibility improved beyond ACP: command details, file paths, read ranges and delegated shell metadata are now carried through structured tool details.
- Slash commands are no longer TUI-only behavior; ACP can advertise and execute the same command catalog.
- The release gate stayed broad: typecheck, lint, build and full test suite were run before closing the phase.

## What Was Deferred

- Evidence Bundle v1 is still not a first-class user-facing artifact.
- Diff Review UX does not yet support accept/reject at file or hunk level.
- Agent Flight Recorder does not yet persist a replayable session artifact.
- `soba init` and first-run provider setup still need a dedicated product pass.
- Public eval and Terminal-Bench/Harbor work remain diagnostic backlog, not a release claim.

## Follow-Up

The next phase should focus on Evidence UX:

1. build an evidence bundle from existing ledger/runtime events;
2. render changed files, command results, pass/fail and risks before final handoff;
3. add diff review controls;
4. persist enough structured turn history for a future Flight Recorder;
5. keep all of it protocol-neutral so CLI, TUI and ACP get the same proof surface.
