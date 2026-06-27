# 36 — Remote MCP release DoD

**ID:** 0.4-REL-36  
**Priority:** P0  
**Estimate:** L  
**Depends on:** 0.4-MCP-13 through 0.4-MCP-26  
**Block:** Remote MCP release gate

## Goal

Проверить, что v0.4.0 remote MCP support готов к релизу: stdio не регресснул, Streamable HTTP работает, OAuth UX
понятен, trust/security boundary выдержан, docs соответствуют реализации.

## Local context

Это release gate. Если тест падает, фикс делается в соответствующей feature task, а не прячется в DoD.

## Required WOW tests

### WOW-R1: stdio compatibility survived

1. Настроить существующий stdio MCP fixture.
2. Запустить `/mcp start <stdio-server>`.
3. Вызвать tool через модель/agent loop.
4. Ожидаемо: поведение совпадает с baseline tasks 11–21.

### WOW-R2: remote no-auth tool call

1. Настроить mock Streamable HTTP server без auth.
2. Запустить `/mcp start <remote-server>`.
3. Вызвать remote tool.
4. Ожидаемо: same ToolRegistry path, safe function name, normalized output.

### WOW-R3: remote OAuth login

1. Настроить protected mock Streamable HTTP server.
2. Запустить `/mcp auth login <server>`.
3. Пройти browser/local callback flow.
4. Вызвать tool.
5. Ожидаемо: token stored redacted, request succeeds, `/mcp status` shows authenticated.

### WOW-R4: expired token refresh

1. Поместить expired access token и valid refresh token.
2. Вызвать remote tool.
3. Ожидаемо: refresh happens once, tool call succeeds, token values are not logged.

### WOW-R5: auth failure is recoverable

1. Поместить invalid refresh token.
2. Вызвать remote tool.
3. Ожидаемо: state becomes `auth_required`, no infinite retry, user gets `/mcp auth login <server>` next action.

## Full release gate

```bash
bun test
bun run lint
bunx tsc --noEmit
bun run build
bun run .soba/skills/ts-morph-analyzer/scripts/dead-code.ts
```

If docs-site changed:

```bash
cd docs-site && bun run check
```

## DoD checklist

- Existing stdio MCP servers still work.
- Remote Streamable HTTP `application/json` response path works.
- Remote Streamable HTTP `text/event-stream` response path works.
- Optional GET listen stream works or degrades clearly when server returns 405.
- `MCP-Session-Id` is captured, sent, redacted, expired, and cleaned up correctly.
- Static auth works through env placeholders without leaking secrets.
- OAuth discovery supports protected resource metadata, authorization server metadata, and OIDC fallback.
- OAuth browser callback works with PKCE and state validation.
- Token refresh/logout/revoke paths work.
- `/mcp status` and `/mcp auth ...` commands are clear and localized.
- Remote trust decisions are local-config-only.
- Remote tool outputs are normalized/truncated before model/session use.
- Auth/network/protocol errors are typed and actionable.
- Docs and examples match implementation.
- Full gate passes.

## Mandatory checkpoint after this task

Create checkpoint: **v0.4.0 remote MCP release candidate baseline**.

Include:

- full gate results;
- remote manual test results;
- security review summary;
- known limitations;
- release notes pointer.
