# Checkpoint — Task 05 MCP config validation

Date: 2026-06-19

## Decision

MCP config is project-local and loaded from `.soba/mcp.json`.

The normalized runtime shape is:

- `version: 1`;
- `servers: McpServerConfig[]`;
- server fields: `id`, `name`, `command`, `args`, `env`, `cwd`, `timeoutMs`, `maxOutputBytes`, `trustMode`, `enabled`.

Hand-written config may use either `servers: [...]` or `servers: { "<id>": { ... } }`. Object-map keys become server ids
when `id` is omitted.

## Security notes

- Validation must pass before any subprocess can start.
- `cwd` must stay inside the project root.
- `${ENV:NAME}` placeholders resolve at runtime.
- Missing env vars produce structured, i18n-ready errors.
- Resolved secret values are not included in errors.
- `trustMode` uses existing SOBA trust levels: `safe`, `normal`, `dangerous`.
- MCP-provided annotations/descriptions remain non-authoritative for trust.

## Follow-up impact

- Task 11 client lifecycle can assume validated, normalized server configs.
- Task 17 trust integration should consume `trustMode` from local config only.
- Task 19 docs should reuse `mcp-config-schema.md` rather than inventing examples.
