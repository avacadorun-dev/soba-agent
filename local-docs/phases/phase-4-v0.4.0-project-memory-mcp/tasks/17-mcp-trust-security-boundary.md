# 17 — Trust и security boundary

**ID:** 0.4-MCP-09  
**Priority:** P0  
**Estimate:** M  
**Depends on:** 0.4-MCP-02, 0.4-MCP-08  
**Block:** Tool layer

## Goal

Зафиксировать и реализовать MCP trust/security boundary: per-server trust из локального config, annotations не участвуют в security decisions, лимиты output/timeout/env.

## Local context

Security boundary — release gate. Нельзя переносить MCP trust на post-release.

## Suggested files

- `src/core/mcp/security.ts` or trust adapter near existing trust layer;
- existing trust integration files;
- `tests/core/mcp/security.test.ts`.

## Requirements

- Per-server trust mode comes only from local config.
- MCP tool annotations/descriptions cannot escalate trust.
- Dangerous/normal/safe behavior integrated with existing trust dialog/policy.
- Env allowlist/explicit mapping only; no full environment pass-through by default.
- Per-server timeout and output byte limits enforced.
- Redaction for env values/secrets in logs/errors/session.
- Clear denial errors when trust is insufficient.

## Tests

- safe server tool allowed according to policy;
- normal/dangerous server requires appropriate approval;
- malicious annotation cannot bypass trust;
- env secret not logged;
- output limit enforced;
- timeout limit enforced;
- denied tool call does not execute subprocess command beyond required connection state.

## Verification

```bash
bun test tests/core/mcp/security.test.ts
bun test
bun run lint
bunx tsc --noEmit
```

## Mandatory checkpoint after this task

Создать checkpoint: **unified tool layer + trust baseline**.

Include:

- trust source of truth;
- ToolRegistry integration status;
- remaining UX/docs tasks;
- any known security limitations.
