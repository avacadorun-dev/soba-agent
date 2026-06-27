# Checkpoint — Task 04 MCP protocol baseline

Date: 2026-06-19

## Decision

v0.4.0 MCP work uses a dual-era baseline:

- required released compatibility: `2025-11-25`;
- preferred architecture target: latest local draft/next shape, currently represented by draft examples for `2026-07-28`;
- release rule: no draft-only behavior may be required unless there is a released-version fallback.

## Why

The local MCP draft removes the mandatory session `initialize` model, adds `server/discover`, and moves protocol
version/client identity/client capabilities into per-request `_meta`. Building v0.4.0 around legacy-only lifecycle would
create immediate migration debt.

At the same time, the draft is not a versioned release in `schema/<YYYY-MM-DD>/`, so it cannot be the only release gate.

## Task-card changes

- Task 11 now targets `server/discover` first with legacy `initialize` fallback.
- Task 12 mock fixture now includes modern discovery and legacy fallback scenarios.

## Scope unchanged

Still out of scope:

- OAuth;
- remote Streamable HTTP;
- deprecated HTTP + SSE;
- marketplace/registry;
- SOBA-as-MCP-server/export;
- trust decisions based on MCP annotations or server-provided metadata.
