# MCP servers

SOBA v0.4.0 works as an MCP client. It can start local stdio MCP servers and connect to remote Streamable HTTP MCP endpoints, discover `tools/list`, and expose ready tools through the regular `ToolRegistry`.

Out of scope for v0.4.0: SOBA-as-MCP-server export, marketplace discovery, signed servers, deprecated HTTP+SSE as a first-class transport, and policy decisions based on server-provided tool annotations.

## Supported Transports

| Transport | Status | Notes |
|---|---|---|
| `stdio` | Supported | Local child process transport. If `transport` is omitted and `command` exists, SOBA treats the server as stdio for compatibility. |
| `streamableHttp` | Supported | Remote MCP endpoint over HTTPS. Local development may use `http://127.0.0.1` or `http://localhost`. |
| Deprecated HTTP+SSE (2024-11-05) | Unsupported as a SOBA transport | The old transport used separate SSE and message endpoints. Configure the current single Streamable HTTP MCP endpoint instead. SSE event streams are still valid responses inside Streamable HTTP. |

## Configuration

Create a project-local file at `.soba/mcp.json`.

`servers` can be an object map or an array with explicit `id` values. Object-map keys become stable server IDs. SOBA also accepts `mcpServers` as an alias for compatibility with common MCP examples; use only one of these keys in a single config file.

### Local stdio

```json
{
  "version": 1,
  "servers": {
    "github": {
      "name": "GitHub MCP",
      "transport": "stdio",
      "command": "bunx",
      "args": ["some-github-mcp-server"],
      "cwd": ".",
      "env": {
        "GITHUB_TOKEN": "${ENV:GITHUB_TOKEN}"
      },
      "timeoutMs": 30000,
      "maxOutputBytes": 1048576,
      "trustMode": "normal",
      "enabled": true
    }
  }
}
```

### Remote Streamable HTTP

```json
{
  "version": 1,
  "servers": {
    "hosted-docs": {
      "name": "Hosted docs MCP",
      "transport": "streamableHttp",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "X-Workspace": "${ENV:MCP_WORKSPACE_ID}"
      },
      "auth": {
        "type": "none"
      },
      "timeoutMs": 30000,
      "maxOutputBytes": 1048576,
      "trustMode": "normal",
      "enabled": true
    }
  }
}
```

Hosted documentation services such as Context7-style MCP providers are expected to expose a single Streamable HTTP MCP endpoint for the workspace or project you configure. Use the endpoint URL from that provider's dashboard or docs; SOBA docs do not prescribe a provider-specific URL.

## Fields

| Field | Required | Default | Notes |
|---|---:|---|---|
| `version` | no | `1` | Only schema version `1` is accepted. |
| `servers` / `mcpServers` | yes | - | Object map or array of server configs. |
| `id` | array only | object key | Letters, numbers, `.`, `_`, `-`; max 64 chars. |
| `name` | no | `id` | Display name in `/mcp status`. |
| `transport` | no | `stdio` | `stdio` or `streamableHttp`. |
| `command` | stdio | - | Executable to spawn. |
| `args` | no | `[]` | String arguments passed to `command`. |
| `cwd` | stdio only | project root | Must resolve inside the project root. |
| `env` | stdio only | `{}` | String values. Supports `${ENV:NAME}` placeholders. |
| `url` | remote | - | Absolute URL. HTTPS required except localhost development URLs. |
| `headers` | remote only | `{}` | Static headers. Values support `${ENV:NAME}` placeholders. `MCP-Session-Id` is transport-controlled and cannot be configured. |
| `auth` | remote only | `{ "type": "none" }` | Remote auth mode. |
| `timeoutMs` | no | `30000` | Positive integer; used for requests and shutdown. |
| `maxOutputBytes` | no | `1048576` | Positive integer; MCP tool output is truncated above this limit. |
| `trustMode` | no | `normal` | `safe`, `normal`, or `dangerous`. |
| `enabled` | no | `true` | Disabled servers remain configured but cannot be started. |

## Remote Auth

Remote auth modes:

```json
{ "type": "none" }
```

```json
{ "type": "bearerEnv", "env": "REMOTE_MCP_BEARER_TOKEN" }
```

```json
{ "type": "apiKeyEnv", "header": "X-API-Key", "env": "REMOTE_MCP_API_KEY" }
```

```json
{ "type": "oauth" }
```

Some remote MCP providers put credentials in the Streamable HTTP endpoint itself, for example as an API-key query parameter. For that shape, keep `auth` as `none` and put the env placeholder in `url`; token-like query parameters are redacted from diagnostics:

```json
{
  "url": "https://mcp.example.com/mcp?apiKey=${ENV:REMOTE_MCP_API_KEY}",
  "auth": {
    "type": "none"
  }
}
```

For `bearerEnv` and `apiKeyEnv`, `auth.env` is the environment variable name. It is not written as `${ENV:...}`. Header values and stdio `env` values also support `${ENV:...}` placeholders:

```json
{
  "headers": {
    "X-Workspace": "${ENV:MCP_WORKSPACE_ID}"
  },
  "auth": {
    "type": "apiKeyEnv",
    "header": "X-API-Key",
    "env": "REMOTE_MCP_API_KEY"
  }
}
```

OAuth servers use the interactive commands:

```text
/mcp auth status <server>
/mcp auth login <server>
/mcp auth logout <server>
```

If a remote server returns auth-required, `/mcp status` and `/mcp auth status <server>` show the next action, usually `Run /mcp auth login <server>`.

SOBA covers OAuth discovery, PKCE browser flow, callback handling, token storage, refresh, logout, and the
`/mcp auth ...` UX. Auth commands delegate provider-specific wiring through an auth controller. If the current CLI build
has no controller configured for a concrete remote provider, `/mcp auth login <server>` reports that the login flow is
unavailable.

For a first production connection, `bearerEnv` or `apiKeyEnv` is still the simplest path. Use OAuth for provider
integrations where the controller wires both the login flow and applying stored bearer credentials to remote requests.

## Trust and Security Boundary

Trust is local-config-only. The effective trust level of every `mcp_<server>_<tool>` proxy comes from the server's `trustMode` in `.soba/mcp.json`.

Server-provided descriptions, schemas, annotations, metadata, and tool hints are untrusted data. They can describe a tool to the model, but they cannot lower confirmation requirements or reclassify a tool as safe.

Recommended defaults:

- `safe` for read-only, deterministic local tools.
- `normal` for ordinary development tools where SOBA should apply the normal permission flow.
- `dangerous` for servers that can write files, access credentials, call external APIs, or mutate remote state.

Remote auth headers, OAuth tokens, authorization codes, and `MCP-Session-Id` values are redacted from diagnostics and must not be stored in docs or committed config.

## Tool Names and Lifecycle

MCP tools are registered with this name format:

```text
mcp_<server-id>_<tool-name>
```

Server and tool IDs are sanitized to match OpenAI-compatible function-name rules.
Example: server `mock-modern` with tool `echo` becomes `mcp_mock_modern_echo`.

Only servers in `ready` state contribute tools to the registry. `/mcp start` and `/mcp restart` resync MCP tools after the lifecycle operation. If a server is stopped, crashed, disabled, or restart-exhausted, its tools are not exposed.

Supported protocol versions:

- modern/draft `2026-07-28` via `server/discover`;
- released `2025-11-25` via `server/discover` or legacy `initialize`;
- legacy `2025-06-18`, `2025-03-26`, and `2024-11-05` via legacy `initialize`.

## Slash Commands

Run these commands inside the interactive SOBA session:

| Command | Effect |
|---|---|
| `/mcp` | Same as `/mcp status`. |
| `/mcp status` | Show configured servers, transport, started flag, state, lifecycle, protocol version, auth state, restart count, and last error. |
| `/mcp start <server>` | Start one configured server and register its ready tools. |
| `/mcp stop <server>` | Stop one server and remove its tools on the next registry sync. |
| `/mcp restart <server>` | Stop and start one server, reset crash-restart counters, and resync tools. |
| `/mcp auth status <server>` | Show remote auth state and next action. |
| `/mcp auth login <server>` | Start the OAuth login flow for an OAuth remote server. |
| `/mcp auth logout <server>` | Clear stored OAuth credentials for an OAuth remote server. |

## Examples

Step-by-step remote setup:

- [docs/remote-mcp-step-by-step.md](./remote-mcp-step-by-step.md)

Verified local examples:

- [docs/examples/mcp/mock-modern.json](./examples/mcp/mock-modern.json)
- [docs/examples/mcp/mock-legacy-paginated.json](./examples/mcp/mock-legacy-paginated.json)

Remote templates:

- [docs/examples/mcp/remote-streamable-http.template.json](./examples/mcp/remote-streamable-http.template.json)
- [docs/examples/mcp/remote-bearer-env.template.json](./examples/mcp/remote-bearer-env.template.json)
- [docs/examples/mcp/remote-api-key-env.template.json](./examples/mcp/remote-api-key-env.template.json)
- [docs/examples/mcp/remote-query-env.template.json](./examples/mcp/remote-query-env.template.json)
- [docs/examples/mcp/remote-oauth.template.json](./examples/mcp/remote-oauth.template.json)

Templates are disabled by default and use `https://mcp.example.com/mcp`; replace the URL, export required env vars, review `trustMode`, then set `enabled` to `true`.

Optional external stdio template:

- [docs/examples/mcp/filesystem-stdio.template.json](./examples/mcp/filesystem-stdio.template.json)

This template depends on an npm package in the user's environment and is disabled by default.

## Troubleshooting

| Symptom | Likely cause | What to check |
|---|---|---|
| `/mcp status` says no servers configured | `.soba/mcp.json` is absent or invalid | Create `.soba/mcp.json`; run config tests if needed. |
| Config validation fails with `Required environment variable NAME is not set.` | `${ENV:NAME}` placeholder cannot be resolved | Export the variable before starting SOBA. |
| `/mcp start <server>` returns unknown server | The ID does not match the object-map key or array `id` | Check `.soba/mcp.json` server IDs. |
| Spawn failure | `command` is not installed or `cwd`/`args` are wrong | Run the command manually from the project root. |
| HTTP 401 | Missing, expired, or rejected credentials | Check `/mcp auth status <server>`, env vars, or run `/mcp auth login <server>` when OAuth is wired for that provider. |
| HTTP 403 | Credentials work but are not authorized for the requested resource | Check provider permissions, workspace/project selection, and scopes. |
| HTTP 404 | Wrong endpoint URL or provider does not expose MCP at that path | Verify the exact Streamable HTTP endpoint in provider docs/dashboard. |
| Session expired | Remote server ended the MCP HTTP session | Restart the MCP server entry with `/mcp restart <server>`; login again if auth is required. |
| HTTP 429 | Remote provider rate limit | Wait, reduce requests, or adjust provider plan/limits. |
| Timeout | Server call exceeded `timeoutMs` | Increase `timeoutMs` only after checking server health and network latency. |
| Malformed SSE | Remote endpoint returned invalid Streamable HTTP event stream | Confirm the URL is the single Streamable HTTP MCP endpoint, not an old standalone `/sse` endpoint or a generic web URL. |
| Server starts then becomes `crashed` | Child process exited, remote request failed, or protocol data is invalid | Inspect the redacted last error in `/mcp status`; run the local server directly or test the remote URL. |
| Startup fails with missing tools capability | Server does not advertise MCP tools | Use a tools-capable MCP server; resources/prompts-only servers are not useful in v0.4.0. |
| Large response is truncated | Output exceeded `maxOutputBytes` | Increase `maxOutputBytes` only if the larger result is safe for context. |
| Tools are not visible after config edit | Current session loaded the old config | Run `/mcp reload`, then `/mcp start <server>` if the server was newly added. |

## Validation Commands

For MCP docs/examples work, run:

```bash
bun test tests/core/mcp/config.test.ts
bun run lint
bunx tsc --noEmit
bun run build
cd docs-site && bun run check
```

Before committing a full phase task, also run the project dead-code scan:

```bash
bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts
```
