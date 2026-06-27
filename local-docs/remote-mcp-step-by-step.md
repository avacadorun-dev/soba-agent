# Remote MCP step by step

This guide connects SOBA v0.4.0 to a hosted MCP server over the current Streamable HTTP transport.

Use this for providers that expose one MCP endpoint, for example `https://mcp.example.com/mcp`. Do not configure the deprecated HTTP+SSE transport that used separate SSE and message endpoints. Streamable HTTP can still return an SSE event stream as a response format.

## 1. Get the provider endpoint

Open the provider dashboard or docs and copy the Streamable HTTP MCP URL for your workspace or project.

Good shape:

```text
https://mcp.example.com/mcp
```

Wrong shape for SOBA v0.4.0:

```text
https://mcp.example.com/sse
https://mcp.example.com/messages
```

## 2. Choose auth

For a first production connection, use one of the static env-backed modes:

- `bearerEnv` when the provider gives you a bearer token.
- `apiKeyEnv` when the provider expects a named API-key header.
- `none` only for local mocks or providers that explicitly do not require auth.

SOBA includes OAuth discovery, PKCE browser flow, callback handling, token storage, refresh, logout, and
`/mcp auth ...` commands. Auth commands delegate provider-specific wiring through an auth controller. If the current CLI
build has no controller configured for a concrete remote provider, `/mcp auth login <server>` reports that the login flow
is unavailable.

For a first production connection, prefer `bearerEnv` or `apiKeyEnv`. Use OAuth for provider integrations where the
controller wires both the login flow and applying stored bearer credentials to remote requests.

## 3. Create `.soba/mcp.json`

Create the project-local MCP config:

```bash
mkdir -p .soba
```

Bearer-token example:

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
        "type": "bearerEnv",
        "env": "REMOTE_MCP_BEARER_TOKEN"
      },
      "timeoutMs": 30000,
      "maxOutputBytes": 1048576,
      "trustMode": "normal",
      "enabled": true
    }
  }
}
```

Important details:

- `auth.env` is the environment variable name, not `${ENV:...}`.
- `url` can use `${ENV:...}` placeholders for providers that require query-parameter auth.
- Static `headers` values can use `${ENV:...}` placeholders.
- Do not configure `MCP-Session-Id`; SOBA manages it from the Streamable HTTP transport.
- Keep remote templates disabled until the URL, auth, and `trustMode` are reviewed.

Query-parameter auth example for providers that implement auth in the MCP endpoint URL:

```json
{
  "version": 1,
  "servers": {
    "hosted-search": {
      "name": "Hosted search MCP",
      "transport": "streamableHttp",
      "url": "https://mcp.example.com/mcp?apiKey=${ENV:REMOTE_MCP_API_KEY}",
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

Use this only when the provider's docs explicitly show auth in the URL. If the provider expects an HTTP header, use `bearerEnv` or `apiKeyEnv` instead.

## 4. Export secrets

Use shell env vars instead of committed config secrets:

```bash
export MCP_WORKSPACE_ID="workspace_..."
export REMOTE_MCP_BEARER_TOKEN="..."
```

For API-key auth, use the header required by the provider:

```json
{
  "auth": {
    "type": "apiKeyEnv",
    "header": "X-API-Key",
    "env": "REMOTE_MCP_API_KEY"
  }
}
```

Then export:

```bash
export REMOTE_MCP_API_KEY="..."
```

## 5. Start SOBA and check status

Start an interactive SOBA session from the project root, then run:

```text
/mcp status
/mcp start hosted-docs
/mcp status
```

A ready server contributes tools to the model registry with this naming pattern:

```text
mcp_<server-id>_<tool-name>
```

Example:

```text
mcp_hosted_docs_search
```

## 6. Verify a real tool call

Ask SOBA to use the remote MCP source directly:

```text
Найди через MCP hosted-docs документацию по настройке rate limits и кратко перескажи.
```

If the server stays `ready` and the model calls `mcp_hosted_docs_*`, the remote connection is working.

## 7. Troubleshoot

| Symptom | What to check |
|---|---|
| HTTP 401 | Env vars are exported in the same shell that starts SOBA; token is not expired; OAuth is wired before using `/mcp auth login`. |
| HTTP 403 | Token works but lacks provider permissions, workspace access, or scopes. |
| HTTP 404 | URL is not the provider's Streamable HTTP MCP endpoint. |
| Malformed SSE | URL points to an old standalone `/sse` endpoint or the provider returns an invalid Streamable HTTP event stream. |
| Session expired | Run `/mcp restart hosted-docs`; refresh credentials if needed. |
| Tools are missing | Server is not `ready`, does not advertise `tools`, or SOBA was not restarted after config edits. |

## 8. Validate docs and examples

For MCP docs/example changes:

```bash
bun test tests/core/mcp/config.test.ts
bun run lint
bunx tsc --noEmit
bun run build
bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts
```
