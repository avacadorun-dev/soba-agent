# 00 — Release framing

**ID:** 0.4-AL-REL-00  
**Priority:** P0  
**Estimate:** S  
**Depends on:** —  
**Type:** docs/design guardrail

## Goal

Зафиксировать границы Agent Loop hardening внутри v0.4.0 перед началом реализации, чтобы изменения prompt, runtime loop,
skills и verification не расползались.

## Local context

Используй как стартовый контекст:

- [`README.md`](../README.md)
- [`design.md`](../design.md)
- [`technical-spec.md`](../technical-spec.md)
- [`use-cases.md`](../use-cases.md)
- [`implementation-plan.md`](../implementation-plan.md)
- `SYSTEM.md`
- `AGENTS.md`

## Decisions to record

- Какие task kinds считаются non-trivial и требуют Working Narration.
- Какие команды являются default verification gate для SOBA project.
- Какие eval fixtures обязательны для weak profile.
- Какие runtime modules могут меняться в phase 4.5.
- Что остаётся out-of-scope до v0.5+.

## Deliverables

- Обновлённый `implementation-plan.md`, если границы изменились.
- Первый checkpoint note, если решения отличаются от текущих docs.

## DoD

- Release boundary не противоречит unified roadmap.
- Есть понятный порядок tasks 01-18.
- Out-of-scope явно зафиксирован.
- Нет code changes.
