# MCP protocol baseline for v0.4.0

Date: 2026-06-19

## Release rule

SOBA v0.4.0 is an MCP client release. The release must be compatible with the latest released MCP specification in the
local checkout and must be architected for the latest draft/next protocol shape without making draft-only behavior a
release gate.

Source of truth for implementation work:

- local checkout: `/Users/avacado/Projects/ai-projects/modelcontextprotocol/`;
- released schema baseline: `/Users/avacado/Projects/ai-projects/modelcontextprotocol/schema/2025-11-25/`;
- draft/next reference: `/Users/avacado/Projects/ai-projects/modelcontextprotocol/schema/draft/` and
  `/Users/avacado/Projects/ai-projects/modelcontextprotocol/docs/specification/draft/`.

## Protocol version baseline

| Role                         | Version / source | v0.4.0 decision                                                                                  |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| Required compatibility       | `2025-11-25`     | Must work as the latest released, versioned MCP baseline.                                        |
| Preferred architecture       | draft/next       | Must shape code around modern/stateless protocol concepts where possible.                        |
| Draft example version        | `2026-07-28`     | Treat as a moving draft reference, not as a mandatory release gate until it is versioned/released. |
| Older released compatibility | `2025-06-18`, `2025-03-26`, `2024-11-05` | Supported through legacy `initialize` fallback for local stdio fixtures and older MCP servers. |

The draft/next protocol shape is materially different from `2025-11-25`: it removes the mandatory session
`initialize` flow, moves protocol version/client identity/client capabilities into per-request `_meta`, and adds
`server/discover` for up-front version and capability discovery.

Therefore v0.4.0 implementation must be dual-era-ready:

1. Prefer modern stdio probing with `server/discover`.
2. If the server is modern, choose a mutually supported protocol version and send per-request MCP `_meta`.
3. If the probe produces a legacy/non-modern response or times out, fall back to legacy `initialize`; accept `2025-11-25`, `2025-06-18`, `2025-03-26`, or `2024-11-05`.
4. If neither era is compatible, surface a controlled incompatible-protocol error.

## Transport scope

| Transport             | Status       | Notes                                                                                     |
| --------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| stdio subprocess      | Supported    | Foundation transport for v0.4.0. Must isolate `stderr` from protocol `stdout`.            |
| Streamable HTTP       | In scope     | Added to v0.4.0 through tasks 22–36; must support JSON and SSE response paths.            |
| Deprecated HTTP + SSE | Out of scope | Do not implement or document as supported.                                                |
| Custom transports     | Out of scope | Unix socket/TCP framing may be compatible in theory, but no implementation in v0.4.0.     |
| OAuth / authorization | In scope     | HTTP-based MCP authorization: discovery, PKCE, browser callback, token lifecycle.          |

## Capability matrix

| Area                                  | v0.4.0 status         | Implementation rule                                                                                         |
| ------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| JSON-RPC 2.0 envelopes                | Supported             | Request/response/notification parsing, ids, errors, timeouts, and cancellation are required.                 |
| `server/discover`                     | Supported             | Preferred modern probe and capability/version discovery path.                                                |
| Legacy `initialize`                   | Supported fallback    | Required fallback for `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` servers and legacy stdio servers. |
| `tools/list`                          | Supported             | Pagination required; deterministic server order should be preserved.                                         |
| `tools/call`                          | Supported             | Timeout, cancellation, normalized result handling, and truncation metadata required.                         |
| Tool result metadata                  | Supported             | Preserve modern fields such as `resultType`, `structuredContent`, `ttlMs`, `cacheScope`, and `isError`.      |
| `notifications/tools/list_changed`    | Supported/degraded    | Handle where available; absence must not break tool execution.                                               |
| `subscriptions/listen`                | Graceful degradation  | Can be treated as diagnostics/cache invalidation later; not required for first successful tool-call path.    |
| `resources/list` / `resources/read`   | Graceful degradation  | Allowed as read-only metadata/discovery surface; not a user-facing v0.4.0 release goal.                      |
| `prompts`                             | Graceful degradation  | Do not expose as model tools in v0.4.0; mark unsupported and keep the server usable for tools.               |
| MRTR `input_required`                 | Graceful degradation  | Surface typed needs-input/unsupported result; do not answer on behalf of the user or model.                  |
| `sampling`                            | Out of scope          | Do not execute client-side model calls requested by MCP servers.                                             |
| `elicitation`                         | Out of scope          | Do not collect user input through MCP server-initiated requests in v0.4.0.                                   |
| `roots`                               | Out of scope          | Do not expose project roots as an MCP client capability in v0.4.0.                                           |
| `tasks` / task extension              | Out of scope          | Do not implement async task extension in v0.4.0.                                                            |
| `completions`, `experimental`         | Out of scope          | Preserve diagnostics where useful, but do not expose to the model or execution path.                        |
| Server instructions                   | Graceful degradation  | May be stored as diagnostics; must not override SOBA prompts, trust policy, or user intent.                  |
| Tool annotations/descriptions         | Non-authoritative     | May improve UI text, but must never grant trust or reduce confirmation/security requirements.                |

## Trust and security boundary

MCP trust decisions come only from local SOBA config and existing trust policy. The following MCP-provided fields are
non-authoritative for security:

- tool annotations;
- tool descriptions;
- server instructions;
- capability declarations;
- prompt/resource metadata;
- `_meta` supplied by the server.

MCP output must be normalized before it enters the model/session path. Large outputs must be bounded and marked with a
truncation marker. MCP subprocesses must not leave orphan processes.

## Explicitly out of scope for v0.4.0

- SOBA-as-MCP-server.
- MCP server/export mode.
- Marketplace, registry, package discovery, or auto-discovery from external catalogs.
- Deprecated HTTP + SSE transport.
- Draft-only behavior without released-version fallback.
- Security decisions based on MCP annotations, descriptions, or server instructions.

## Validation against remaining task cards

Task 22 amended the v0.4.0 boundary: Streamable HTTP and OAuth are now in scope through tasks 22–36. Marketplace and
SOBA-as-MCP-server remain out of scope.

Two lifecycle task cards were tightened to avoid legacy-only wording:

- Task 11 now targets modern `server/discover` first and legacy `initialize` as fallback.
- Task 12 mock server fixture now needs dual-era scenarios instead of only `initialize`.
