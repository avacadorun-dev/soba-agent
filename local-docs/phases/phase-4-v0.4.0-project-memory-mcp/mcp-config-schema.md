# MCP config schema for v0.4.0

Date: 2026-06-19

## Location

Project-local config only:

```text
.soba/mcp.json
```

Global/user MCP config is out of scope for v0.4.0.

## Shape

Canonical stdio shape:

```json
{
  "version": 1,
  "servers": [
    {
      "id": "filesystem",
      "name": "Filesystem",
      "transport": "stdio",
      "command": "bun",
      "args": ["run", "mcp-filesystem.ts"],
      "cwd": ".",
      "env": {
        "GITHUB_TOKEN": "${ENV:GITHUB_TOKEN}"
      },
      "timeoutMs": 30000,
      "maxOutputBytes": 1048576,
      "trustMode": "normal",
      "enabled": true
    }
  ]
}
```

Canonical Streamable HTTP shape:

```json
{
  "version": 1,
  "servers": {
    "context7": {
      "transport": "streamableHttp",
      "url": "https://example.com/mcp",
      "auth": {
        "type": "oauth"
      },
      "timeoutMs": 30000,
      "maxOutputBytes": 1048576,
      "trustMode": "normal",
      "enabled": true
    }
  }
}
```

`servers` may also be an object-map for hand-written configs:

```json
{
  "version": 1,
  "servers": {
    "filesystem": {
      "command": "bun",
      "args": ["run", "mcp-filesystem.ts"]
    }
  }
}
```

Object-map keys become server ids when `id` is omitted.

If `transport` is omitted and `command` is present, the config is treated as stdio for backward compatibility.

## Defaults

| Field            | Default       |
| ---------------- | ------------- |
| `version`        | `1`           |
| `name`           | server `id`   |
| `args`           | `[]`          |
| `env`            | `{}`          |
| `cwd`            | project root  |
| `timeoutMs`      | `30000`       |
| `maxOutputBytes` | `1048576`     |
| `trustMode`      | `"normal"`    |
| `enabled`        | `true`        |

## Transport-specific fields

| Transport | Required fields | Optional fields |
| --------- | --------------- | --------------- |
| `stdio` | `command` | `args`, `cwd`, `env` |
| `streamableHttp` | `url` | `headers`, `auth`, `timeoutMs`, `maxOutputBytes` |

Remote URL rules:

- `https://` is required by default.
- `http://127.0.0.1` and `http://localhost` are allowed for local development.
- Non-local `http://` is rejected unless a later explicit insecure development override is added.
- URLs with embedded username/password are rejected.

Remote auth modes:

- `{"type": "none"}`
- `{"type": "bearerEnv", "env": "MCP_TOKEN"}`
- `{"type": "apiKeyEnv", "header": "X-API-Key", "env": "MCP_API_KEY"}`
- `{"type": "oauth"}`

## Security rules

- `cwd` must resolve inside the current project root.
- Env placeholders use `${ENV:NAME}` and resolve at runtime.
- Missing env vars produce structured validation errors.
- Env values and resolved secrets must not appear in validation error text.
- Trust mode is local-config-only. MCP tool annotations, descriptions, server instructions, and `_meta` cannot raise or
  lower trust.
- Remote auth headers, OAuth tokens, authorization codes and `MCP-Session-Id` values must be redacted from diagnostics.

## Trust modes

`trustMode` is intentionally aligned with SOBA's existing trust levels:

- `safe`
- `normal`
- `dangerous`

Task 17 owns the final integration with trust prompts/policy.
