# 00 — Release framing

**ID:** 0.4-REL-00  
**Priority:** P0  
**Estimate:** S  
**Depends on:** —  
**Type:** docs/design guardrail

## Goal

Зафиксировать границы v0.4.0 до начала реализации, чтобы Project Memory, MCP и ops-задачи не расползались.

## Local context

Используй как единственный стартовый контекст:

- roadmap v0.4.0 из `docs/unified-roadmap-1.0.0.md`;
- AGENTS.md project instructions;
- эта папка phase docs.

## Decisions to record

- Где будет лежать MCP config.
- Какой stable MCP protocol baseline считается обязательным.
- Какие MCP capabilities поддерживаются в v0.4.0 и какие дают graceful degradation.
- Какие scripts/package commands являются quality gate.
- Какие P1/P2 задачи можно урезать при рисках без нарушения release goal.

## Deliverables

- Обновлённый `implementation-plan.md`, если появились уточнения.
- Первый checkpoint note, если решения отличаются от roadmap.

## DoD

- Release boundary не противоречит roadmap.
- Есть понятный порядок tasks 01–21.
- Out-of-scope явно зафиксирован.
