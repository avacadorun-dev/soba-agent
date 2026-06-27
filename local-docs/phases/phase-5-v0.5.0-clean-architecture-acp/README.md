# Phase 5 — v0.5.0 Clean Architecture + ACP

**Version:** SOBA 0.5.0  
**Status:** completed  
**Completed:** 27 June 2026  
**Primary goal:** turn SOBA runtime into a clean, modular architecture that can support multiple app/protocol surfaces.  
**First external protocol:** full ACP v1 support for Zed editor.

## Why this phase exists

v0.4.x delivered the trust foundation: Project Memory, MCP, Verified Agent Loop, Evidence Ledger, Auto-Verifier,
checkpoint integration, skills and recovery rails.

The cost is architectural pressure:

- `AgentLoop` owns orchestration, provider streaming, tool execution, permissions, verification, context scheduling,
  checkpoint integration, completion and recovery.
- `cli.ts` owns both app entry and runtime composition.
- TUI/print behavior is mixed with runtime concerns.
- ACP would become risky if added as another condition path inside the current loop.

v0.5.0 is the architecture phase that makes SOBA easier to extend without weakening the v0.4.x guarantees.

## Completion summary

Phase 5 is closed as the architecture-and-ACP release.

Delivered:

1. Source tree split into explicit app, application, core and adapter layers.
2. Shared `SobaRuntime` contract used by CLI and ACP entrypoints.
3. Focused controllers/services for model turns, tool execution, permissions, completion, verification and context.
4. Pre-ACP and post-ACP architecture gates.
5. ACP stdio server and dispatcher for the current Zed-supported ACP v1 surface.
6. Rich ACP tool updates for shell, read, search, file inspection and delegated operations.
7. ACP slash-command advertisement and command execution through the shared command path.
8. Current architecture diagram in `ARCHITECTURE.md`.

Explicitly not closed by this phase:

- public `v0.5` Evidence UX promises such as evidence bundle, hunk-level diff review and first-run polish;
- ACP v2 support, because Zed currently targets ACP v1;
- background delegation and task worktrees.

Those items move to the next phase.

## Release thesis

SOBA 0.5.0 should make this true:

> The agent core is a protocol-independent runtime. CLI, TUI and ACP are adapters over the same runtime contract.

## Scope

### P0

1. Clean architecture boundaries:
   - app entrypoints;
   - application composition;
   - core workflow;
   - infrastructure adapters;
   - protocol adapters.
2. Shared `SobaRuntime` contract used by print CLI, TUI and ACP.
3. Runtime factory extracted from `src/cli.ts`.
4. `AgentLoop` decomposition into explicit services/controllers.
5. Protocol-neutral turn input and runtime event stream.
6. Mandatory architecture gate before ACP starts:
   - import-boundary tests are in place;
   - `src/core/**` has no app/TUI/protocol imports;
   - `AgentLoop` no longer owns provider, tool, permission, completion, verification and context policy directly;
   - adapters depend only on application/runtime contracts, not on `AgentLoop` internals.
7. ACP stdio server with full current ACP v1 agent coverage for Zed:
   - `initialize`;
   - `authenticate` and `logout` when auth is configured;
   - `session/new`;
   - `session/list`;
   - `session/load`;
   - `session/resume`;
   - `session/prompt`;
   - `session/cancel`;
   - `session/close`;
   - `session/delete`;
   - `session/set_config_option`;
   - `session/set_mode`;
   - `session/update`;
   - `session/request_permission` round trip;
   - text/resource/resource link content;
   - tool call status, raw input/output, locations and content updates;
   - usage/cost updates;
   - slash command advertisement through ACP session metadata;
   - client `fs/*` and `terminal/*` delegation when the client advertises those capabilities.
8. ACP conformance test matrix for every supported method and advertised capability.
9. Post-ACP architecture gate proving ACP did not introduce reverse dependencies or policy decisions in protocol code.
10. Characterization tests before each high-risk extraction.

### P1

1. Optional ACP auth provider integrations beyond local/API-key flows.
2. Rich terminal embedding UX beyond protocol correctness.
3. Advanced command forms that are not already represented by SOBA command metadata.
4. Additional architecture visualization/reporting, if needed.

### Out of scope

- Multi-agent delegation.
- SOBA as MCP server.
- Marketplace or remote skill registry.
- Rewrite of provider protocol.
- New TUI design work beyond adapter boundary changes.
- Docs-site v0.5.0 public content refresh, unless release docs are explicitly started.
- ACP extension proposals outside the current v1 protocol.

## Non-negotiable invariants

- Bun-only runtime.
- Biome-only lint/format.
- TypeScript erasable syntax only, no `enum`.
- `import type` for type-only imports.
- No regression of v0.4.x Verified Agent Loop guarantees:
  - code mutation cannot finish as `completed` without verification evidence;
  - completion gate uses runtime evidence, not model claims;
  - dangerous operations still require approval;
  - checkpoint/context/memory integration remains available;
  - Fix-Until-Green remains bounded;
  - Working Narration remains observable and does not expose hidden chain-of-thought.
- ACP mode must write only newline-delimited JSON-RPC messages to stdout.
- ACP must only advertise capabilities that are backed by implemented runtime behavior and tests.
- ACP implementation may not begin until the clean architecture pre-gate passes.
- ACP changes may not be accepted unless the post-ACP architecture gate still passes.

## Target directory shape

```text
src/apps/
  cli-print/
  tui/
  acp-server/

src/application/
  runtime-factory.ts
  session-lifecycle.ts
  command-service.ts

src/core/
  workflow/
  model-turn/
  tool-execution/
  permissions/
  completion/
  verification/
  context/

src/protocol-adapters/
  print/
  tui/
  acp/

src/infrastructure/
  providers/
  mcp/
  tools/
```

This is a migration target, not a requirement to move all files in one PR.

## First implementation cut

The first implementation cut should be deliberately small:

1. Add characterization tests around existing `AgentLoop` behavior.
2. Extract runtime composition from `src/cli.ts` into `src/application/runtime-factory.ts`.
3. Keep print CLI and TUI behavior unchanged.
4. Add the `SobaRuntime` interface but keep `AgentLoop` as the underlying implementation.

Only after this cut and the mandatory architecture pre-gate should ACP server work begin. For v0.5.0, the ACP work is
not an MVP: it is a conformance track for the current ACP v1 surface that SOBA advertises.
