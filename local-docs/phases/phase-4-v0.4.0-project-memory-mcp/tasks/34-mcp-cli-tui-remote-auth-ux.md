# 34 — CLI/TUI remote auth UX

**ID:** 0.4-MCP-25  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-22, 0.4-MCP-24  
**Block:** Remote MCP UX

## Goal

Добавить понятный CLI/TUI UX для remote MCP lifecycle и OAuth: status, login, logout, auth-required state, concise
notifications.

## Local context

Пользователь должен понимать, что именно нужно сделать: настроить env, залогиниться, повторить команду, или проверить
сеть. Нельзя показывать длинные команды/URL как toast-notification на весь экран.

## Suggested files

- `src/tui/**`
- `src/core/mcp/client-manager.ts`
- `locales/en.json`
- `locales/ru.json`
- `locales/zh.json`
- `tests/tui/**`
- `tests/core/mcp/client-manager.test.ts`

## Requirements

- `/mcp status` shows transport, lifecycle, protocol, auth state, last error.
- Add `/mcp auth status <server>`.
- Add `/mcp auth login <server>`.
- Add `/mcp auth logout <server>`.
- Auth-required server shows clear next action, not a generic crash.
- TUI notification is short; detailed URL/command appears in command output pane or copyable block.
- OAuth callback success/failure updates status immediately.
- i18n strings are present for ru/en/zh.

## Tests

- status displays remote server auth state;
- login command starts OAuth flow;
- logout clears token and updates state;
- auth-required error includes next action;
- notification text is bounded;
- long auth URL is not placed into compact toast;
- ru/en/zh locale keys exist.

## Verification

```bash
bun test tests/core/mcp/client-manager.test.ts tests/tui
bun run lint
bunx tsc --noEmit
```

## Checkpoint

Optional. Required if command syntax changes.
