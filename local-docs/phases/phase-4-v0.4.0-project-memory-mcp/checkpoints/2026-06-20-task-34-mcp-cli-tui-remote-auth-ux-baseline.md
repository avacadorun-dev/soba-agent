# Checkpoint: task 34 — MCP CLI/TUI remote auth UX baseline

## Scope

- `/mcp status` now includes transport and auth state for each server.
- Remote auth state reports OAuth-required and static-env missing/configured cases with a concrete next action.
- `/mcp auth status <server>`, `/mcp auth login <server>` and `/mcp auth logout <server>` are available through the CLI command handler.
- MCP manager exposes an auth controller contract so OAuth login/logout UX can start an external flow without coupling CLI code to browser/callback internals.
- Compact auth command output keeps the first notification line short while placing long URLs/details in the command output body.
- ru/en/zh locale keys exist for the new MCP auth command strings.

## Verification

- `bun test`
- `bun run lint`
- `bunx tsc --noEmit`
- `bun run build`
- `bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts`

## Next

- Task 35 can wire the auth controller to the OAuth discovery/token lifecycle if the phase plan keeps OAuth backend integration separate from CLI UX.
