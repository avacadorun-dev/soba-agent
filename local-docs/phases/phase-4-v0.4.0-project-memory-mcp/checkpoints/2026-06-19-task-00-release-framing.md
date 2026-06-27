# Checkpoint — Task 00 release framing

Date: 2026-06-19

## Decision

v0.4.0 MCP implementation must be modern-first and dual-era-ready.

The local Model Context Protocol checkout has released schema versions through `2025-11-25` and an in-progress `draft`
spec with the next-era protocol shape: stateless requests, `server/discover`, per-request
`_meta.io.modelcontextprotocol/*`, and no mandatory `initialize` session handshake.

SOBA should not build the MCP client around legacy sessionful assumptions. The preferred path is the latest draft/next
shape when available; the required compatibility fallback remains the latest released stable version, currently
`2025-11-25`, until a newer version appears under `schema/<YYYY-MM-DD>/`.

## Difference from roadmap

The roadmap says draft-only protocol behavior is not a release gate. That remains true. The refinement is that draft/next
changes are now an architectural constraint:

- protocol constants and request metadata must be isolated;
- stdio lifecycle must start with a modern `server/discover` probe where possible;
- legacy `initialize` support is a fallback, not the primary design center;
- unreleased draft behavior must not be the only path required for release.

## Impact on upcoming tasks

- Task 04 owns MCP protocol era types, version constants, modern request metadata, and legacy fallback rules.
- Task 05 must keep config independent from protocol era so server config does not change when the preferred MCP version
  changes.
- Tasks 11–16 must preserve normalized result fields from modern tool responses, including `resultType`, cache hints,
  structured content, and truncation metadata.
